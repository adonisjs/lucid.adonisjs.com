---
summary: Group queries atomically with managed and manual transactions, set isolation levels, create savepoints, and attach transactions to query builders and models.
---

# Transactions

This guide covers SQL transactions in Lucid. You will learn how to:

- Group multiple queries into an atomic unit with managed or manual transactions
- Set a transaction's isolation level
- Create savepoints with nested transactions
- Attach a transaction to a query builder or model
- Run post-commit hooks with transaction events

## Overview

Transactions group multiple database operations into a single atomic unit. Every operation inside a transaction either commits together or rolls back together, which is essential when two or more writes must succeed or fail as a single step.

Lucid offers two forms of transactions. **Managed transactions** accept a callback, commit when the callback returns, and rollback when it throws. **Manual transactions** return a transaction client that you commit or rollback yourself. Prefer managed transactions for most use cases, since they eliminate the chance of leaking an open transaction if your code forgets to call `commit` or `rollback`.

## Managed transactions

Call `db.transaction` with an async callback. The callback receives a transaction client (`trx`) that you use to issue every query that should participate in the transaction.

```ts
// title: app/controllers/users_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class UsersController {
  async store({ request, response }: HttpContext) {
    const user = await db.transaction(async (trx) => {
      const [createdUser] = await trx
        .table('users')
        .insert({ email: request.input('email') })
        .returning(['id', 'email'])

      await trx
        .table('profiles')
        .insert({
          user_id: createdUser.id,
          full_name: request.input('full_name'),
        })

      return createdUser
    })

    return response.created(user)
  }
}
```

The value returned from the callback becomes the resolved value of `db.transaction`. When the callback throws, Lucid rolls the transaction back and rethrows the original error so the caller can handle it.

Pass a second argument to set the transaction's isolation level.

```ts
await db.transaction(
  async (trx) => {
    // queries using trx
  },
  { isolationLevel: 'serializable' }
)
```

## Manual transactions

Reach for the manual form when the transaction's lifetime spans multiple function boundaries, or when you need custom control flow around commit and rollback. Call `db.transaction()` without arguments to get a transaction client, then commit or rollback explicitly.

```ts
// title: app/services/users_service.ts
import db from '@adonisjs/lucid/services/db'

export default class UsersService {
  async createWithProfile(email: string, fullName: string) {
    const trx = await db.transaction()

    try {
      const [user] = await trx
        .table('users')
        .insert({ email })
        .returning(['id', 'email'])

      await trx.table('profiles').insert({ user_id: user.id, full_name: fullName })
      await trx.commit()

      return user
    } catch (error) {
      await trx.rollback()
      throw error
    }
  }
}
```

You must always call `commit` or `rollback`. An abandoned transaction holds its database connection open until the pool forcibly reclaims it, which can starve other queries on a busy server. The same isolation option is available when creating the transaction manually.

```ts
const trx = await db.transaction({ isolationLevel: 'serializable' })
```

## Isolation levels

Isolation levels control how changes made in a transaction become visible to other concurrent transactions. Lucid accepts the following values, which map to the corresponding SQL standard levels.

<dl>

<dt>

read uncommitted

</dt>

<dd>

Allows reads of data from other transactions that have not yet committed ("dirty reads"). Rarely useful in application code. PostgreSQL silently promotes this level to `read committed`.

</dd>

<dt>

read committed

</dt>

<dd>

Only committed data is visible, but the same query can return different results at different points within the transaction as other transactions commit. This is PostgreSQL's default isolation level.

</dd>

<dt>

snapshot

</dt>

<dd>

The transaction reads a consistent snapshot of the database taken at the start. Supported on MSSQL only, and requires `ALLOW_SNAPSHOT_ISOLATION ON` at the database level. Use `repeatable read` for similar semantics on PostgreSQL and MySQL.

</dd>

<dt>

repeatable read

</dt>

<dd>

The transaction reads the same committed data throughout. A row read twice returns the same value. This is MySQL's default level. On PostgreSQL, this level additionally detects some write anomalies and raises serialization failure errors that the application must handle by retrying.

</dd>

<dt>

serializable

</dt>

<dd>

The strictest level. The transaction behaves as if it were the only one running against the database. Use for operations that must see a consistent view and prevent concurrent writes from interleaving. On PostgreSQL, this uses Serializable Snapshot Isolation, which can raise serialization failure errors that you must retry.

</dd>

</dl>

SQLite uses a different concurrency model based on file-level locking rather than isolation levels. Setting `isolationLevel` on a SQLite connection has no effect.

## Savepoints

Calling `transaction()` on an existing transaction client creates a **savepoint**, a checkpoint within the outer transaction that can be rolled back without aborting the whole transaction. Lucid uses the same API for both forms.

```ts
const trx = await db.transaction()

const savepoint = await trx.transaction()

try {
  await savepoint.table('audit_logs').insert({ action: 'login' })
  await savepoint.commit()
} catch (error) {
  await savepoint.rollback()
}

await trx.commit()
```

Rolling back the savepoint leaves the outer transaction intact, so any queries issued through `trx` before the savepoint are still pending when you call `trx.commit()`. Savepoints share the outer transaction's database connection, so they do not consume additional connections from the pool.

## Transactions on a named connection

By default, `db.transaction` uses the default connection from `config/database.ts`. When your application uses multiple connections, start the transaction from `db.connection(name)` to target a specific one.

```ts
// title: app/services/snapshot_service.ts
import db from '@adonisjs/lucid/services/db'

export default class SnapshotService {
  async record(total: number) {
    await db.connection('analytics').transaction(async (trx) => {
      await trx.table('signup_snapshots').insert({ total, recorded_at: new Date() })
    })
  }
}
```

The returned transaction client is scoped to that connection, and every query issued through it runs on the same connection.

## Use a transaction with the query builder

The query builder entry points on the `db` service accept an options object with a `client` property. Pass the transaction client to route the query through the transaction.

```ts
const trx = await db.transaction()

await db
  .query({ client: trx })
  .from('users')
  .where('id', 1)
  .update({ is_active: true })

await db
  .insertQuery({ client: trx })
  .table('audit_logs')
  .insert({ user_id: 1, action: 'activated' })

await trx.commit()
```

Use this pattern when you already have a query builder set up (for example, inside a service method that receives an optional `trx` parameter) and want to run the query inside a transaction started by the caller.

## Use transactions with models

Lucid models integrate with transactions through the `useTransaction` method on instances, the `{ client: trx }` option on queries, and automatic inheritance on relationships.

### Attach a transaction to a model instance

Call `useTransaction` on a model instance before saving, deleting, or performing any other write. The model stores the transaction on `$trx` and routes its writes through it.

```ts
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

await db.transaction(async (trx) => {
  const user = new User()
  user.email = 'virk@adonisjs.com'
  user.useTransaction(trx)
  await user.save()
})
```

Once the transaction commits or rolls back, `$trx` resets to `undefined`.

### Attach a transaction to a model query

The same `{ client: trx }` option applies to model queries and finders.

```ts
await db.transaction(async (trx) => {
  const users = await User.query({ client: trx }).where('is_active', true)
  const user = await User.findOrFail(1, { client: trx })
})
```

When a finder like `findOrFail` returns a model instance, Lucid attaches the transaction to the instance automatically. Subsequent `save` or relationship operations on that instance stay inside the transaction without a second `useTransaction` call.

### Start a transaction from a model

`Model.transaction` is a convenience that starts a transaction on the model's connection. Use it when the entire operation is scoped to one model, especially when the model overrides `static connection`.

```ts
import User from '#models/user'

await User.transaction(async (trx) => {
  const user = new User()
  user.email = 'virk@adonisjs.com'
  user.useTransaction(trx)
  await user.save()
})
```

For models on the default connection, this is equivalent to `db.transaction(...)`. For models with a custom `static connection`, `Model.transaction` automatically routes to that connection. The second argument accepts the same `isolationLevel` option as `db.transaction`.

### Relationships inherit the transaction

When you persist a relationship on a model that has `$trx` set, the relationship query inherits the transaction implicitly.

```ts
await db.transaction(async (trx) => {
  const user = new User()
  user.email = 'virk@adonisjs.com'
  user.useTransaction(trx)
  await user.save()

  await user.related('profile').create({
    fullName: 'Harminder Virk',
    avatar: 'some-url.jpg',
  })
})
```

No extra `useTransaction` or `{ client: trx }` call is needed on the `profile` query.

## Transaction hooks

A transaction client exposes `after` hooks that run once the underlying commit or rollback has completed. Use these hooks to register post-commit side effects like cache invalidation, job enqueueing, or logging that should only happen when the transaction is durable.

```ts
const trx = await db.transaction()

trx.after('commit', async () => {
  await cache.invalidate(['users:1'])
})

trx.after('rollback', () => {
  logger.warn({ userId: 1 }, 'user update rolled back')
})
```

`after` hooks support both synchronous and asynchronous handlers and run sequentially in the order they were registered. Because the hooks run after the commit has already been durably written, any error thrown inside a hook is swallowed to avoid surfacing a failure on a transaction the caller already saw succeed. Handle errors inside the hook itself rather than relying on them to propagate.

The transaction client is also a Node `EventEmitter` and emits `commit` and `rollback` events during the commit/rollback lifecycle. The `after` hooks cover the post-commit side effect use case; reach for `trx.on(...)` only when you specifically need the synchronous, pre-hook notification.

## Next steps

- [Database service guide](./database_service.md) for selecting connections and passing transactions to query builders.
- [Configuration guide](./configuration.md) for connection-level defaults.
