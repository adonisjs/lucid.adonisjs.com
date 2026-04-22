---
summary: Construct INSERT queries with the insert query builder, including bulk inserts, upserts via onConflict, CTEs, and execution helpers.
---

# Insert query builder

This guide covers the INSERT query builder. You will learn how to:

- Insert one or many rows into a table
- Read back generated columns with `returning`
- Resolve unique-constraint conflicts with `onConflict().ignore()` and `.merge()`
- Compose inserts with common table expressions
- Execute inserts inside transactions and against alternate schemas
- Annotate queries for logs and observability
- Inspect and debug the generated SQL

## Overview

The insert query builder is Lucid's fluent interface for building INSERT statements. For SELECT, UPDATE, and DELETE, see the [select query builder](./select.md) and [update and delete queries](./update_and_delete.md). For raw SQL, see the [raw query builder](./raw.md). For model-based inserts, prefer `Model.create()` and `model.save()`, which run through this builder under the hood and return typed model instances.

Get a builder instance through the `db` service.

```ts
import db from '@adonisjs/lucid/services/db'

const query = db.insertQuery()  // builder without a table selected
const usersQuery = db.table('users')  // shortcut: builder with the table selected
```

Both forms return the same `InsertQueryBuilder` instance. `db.table(table)` is the shortcut you will reach for most often.

## Inserting rows

### insert

Insert a single row by passing an object of column-value pairs.

```ts
// title: app/controllers/users_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'

export default class UsersController {
  async store({ request }: HttpContext) {
    const [user] = await db
      .table('users')
      .returning(['id', 'email'])
      .insert({
        email: request.input('email'),
        password: await hash.make(request.input('password')),
      })

    return user
  }
}
```

The return value of `insert` depends on the dialect, which is why most production code uses `returning` to make the result portable.

| Dialect | Default return value |
| --- | --- |
| PostgreSQL | `[]` unless `returning` is set |
| MSSQL | `[]` unless `returning` is set |
| MySQL / MariaDB | `[insertId]` (the last inserted auto-increment ID) |
| SQLite (better-sqlite3, SQLite 3.35+) | `[insertId]` by default; supports `returning` natively |
| Oracle | `[]` unless `returning` is set |

### multiInsert

Insert several rows in a single statement by passing an array of objects.

```ts
// title: app/services/imports_service.ts
import db from '@adonisjs/lucid/services/db'

await db.table('users').multiInsert([
  { email: 'virk@adonisjs.com', password_hash: '...' },
  { email: 'romain@adonisjs.com', password_hash: '...' },
])
```

The emitted SQL is one `INSERT INTO ... VALUES (...), (...), ...` statement, which is faster and atomically committed compared with looping `insert` calls. Different rows can include different keys; missing keys are filled with `NULL` (or the column's default when `useNullAsDefault` is off).

`returning` works with `multiInsert` and yields one row per inserted record.

```ts
const inserted = await db
  .table('users')
  .returning(['id', 'email'])
  .multiInsert([
    { email: 'virk@adonisjs.com' },
    { email: 'romain@adonisjs.com' },
  ])

inserted.forEach((row) => console.log(row.id, row.email))
```

### returning

Set the `RETURNING` clause to read back generated columns from the inserted row(s). Supported on PostgreSQL, MSSQL, Oracle, and SQLite 3.35+ via `better-sqlite3`. MySQL does not support `RETURNING` and ignores the call; use the returned auto-increment ID or perform a follow-up SELECT.

```ts
// Single column
const [{ id }] = await db
  .table('posts')
  .returning('id')
  .insert({ title: 'Hello', body: 'World' })

// Multiple columns
const [post] = await db
  .table('posts')
  .returning(['id', 'created_at'])
  .insert({ title: 'Hello', body: 'World' })

// All columns
const [post] = await db
  .table('posts')
  .returning('*')
  .insert({ title: 'Hello', body: 'World' })
```

## Upserts with onConflict

`onConflict` lets you choose what happens when an insert violates a unique constraint. It is supported on PostgreSQL, MySQL, MariaDB, and SQLite. After calling `onConflict`, chain either `.ignore()` to silently discard the conflicting row or `.merge()` to update the existing row (an upsert).

Pass a column name, an array of column names, or no arguments at all (which applies to any unique constraint).

```ts
db.table('users').insert({ email }).onConflict('email').ignore()

db.table('users').insert({ email }).onConflict(['email', 'tenant_id']).ignore()

db.table('users').insert({ email }).onConflict().ignore()
```

### onConflict().ignore()

Silently skip the insert when a conflict occurs. Emits `ON CONFLICT ... DO NOTHING` (or the dialect equivalent).

```ts
await db
  .table('users')
  .insert({ email: 'virk@adonisjs.com', name: 'Harminder' })
  .onConflict('email')
  .ignore()

// SQL:
// INSERT INTO "users" ("email", "name") VALUES (?, ?)
// ON CONFLICT ("email") DO NOTHING
```

The query resolves successfully whether or not the insert actually happened. Pair with `returning` if you need to detect which case occurred — only newly inserted rows appear in the result.

### onConflict().merge()

Upsert the row when a conflict occurs. Emits `ON CONFLICT ... DO UPDATE SET` (or the dialect equivalent).

Without arguments, every column from the insert payload is updated.

```ts
await db
  .table('users')
  .insert({ email: 'virk@adonisjs.com', name: 'Harminder' })
  .onConflict('email')
  .merge()

// SQL:
// INSERT INTO "users" ("email", "name") VALUES (?, ?)
// ON CONFLICT ("email")
// DO UPDATE SET "email" = EXCLUDED."email", "name" = EXCLUDED."name"
```

Pass an array of column names to update only a subset of columns on conflict.

```ts
await db
  .table('users')
  .insert({ email: 'virk@adonisjs.com', name: 'Harminder', last_seen_at: now })
  .onConflict('email')
  .merge(['last_seen_at'])
```

Pass an object to set explicit values on conflict that differ from the insert payload.

```ts
await db
  .table('users')
  .insert({ email: 'virk@adonisjs.com', login_count: 1 })
  .onConflict('email')
  .merge({ login_count: db.raw('users.login_count + 1') })
```

## Common table expressions

CTEs let you compose subqueries with the insert. Useful when the rows you want to insert depend on data computed elsewhere.

### with

Define a CTE that the insert can reference.

```ts
db
  .table('user_audit_log')
  .with('latest_login', (query) => {
    query
      .from('user_logins')
      .select('user_id', db.raw('max(created_at) as logged_in_at'))
      .groupBy('user_id')
  })
  .insert(/* ... */)
```

### withRecursive

Define a recursive CTE. Supported on PostgreSQL, MySQL 8+, SQLite 3.8+, MSSQL, and Oracle. See the [select query builder's withRecursive](./select.md#withrecursive) for a full walkthrough; the API on the insert builder is identical.

### withMaterialized and withNotMaterialized

PostgreSQL-specific hints that force the planner to materialize (or refuse to materialize) the CTE result.

```ts
db
  .table('archive')
  .withMaterialized('inactive_users', (query) => {
    query.from('users').select('*').where('is_active', false)
  })
  .insert(/* ... */)
```

## Executing the query

The query builder is a `Promise`. `await` it to send the insert.

```ts
await db.table('users').insert({ email })
```

### Inside a transaction

To run an insert inside a transaction, build the query directly off the transaction client. The `trx` object exposes the same `.table`, `.insertQuery`, and other entry points as the `db` service. See the [transactions guide](../guides/transactions.md) for the full pattern.

```ts
await db.transaction(async (trx) => {
  const [user] = await trx
    .table('users')
    .returning(['id'])
    .insert({ email: 'virk@adonisjs.com' })

  await trx
    .table('profiles')
    .insert({ user_id: user.id, full_name: 'Harminder Virk' })
})
```

## Annotating queries

These helpers attach identifying information to the query, which is useful when reading slow query logs or processing `db:query` events in observability pipelines.

### comment

Adds an SQL comment to the emitted query. The comment appears in the database's slow query log alongside the SQL, which makes it easy to grep for queries originating in a specific code path.

```ts
db
  .table('users')
  .comment('signup endpoint')
  .insert({ email: 'virk@adonisjs.com' })

// SQL: /* signup endpoint */ INSERT INTO "users" ("email") VALUES (?)
```

### reporterData

Attach arbitrary metadata to the `db:query` event payload, accessible to listeners. Useful for tagging queries with request IDs, user IDs, or feature flags for observability.

```ts
await db
  .table('users')
  .reporterData({ userId: auth.user.id, source: 'signup' })
  .insert({ email: 'virk@adonisjs.com' })
```

```ts
// title: start/events.ts
import emitter from '@adonisjs/core/services/emitter'

emitter.on('db:query', (query) => {
  console.log(query.userId, query.source)
})
```

See the [debugging guide](../guides/debugging.md) for the full `db:query` event payload.

## Inspecting and debugging

### toSQL

Return a `{ sql, bindings }` object describing the SQL the query will execute, without running it. Call `.toNative()` on the result to see the SQL formatted for the current dialect (with the actual placeholder syntax that dialect uses).

```ts
const { sql, bindings } = db
  .table('users')
  .insert({ email: 'virk@adonisjs.com' })
  .toSQL()

const native = db
  .table('users')
  .insert({ email: 'virk@adonisjs.com' })
  .toSQL()
  .toNative()
```

### toQuery

Return the query as a single interpolated string with bindings substituted. Convenient for ad-hoc inspection. Prefer `toSQL` + bindings when forwarding to logs to avoid quoting issues.

```ts
const sql = db.table('users').insert({ email: 'virk@adonisjs.com' }).toQuery()
```

### debug

Enable debug output for this query only. The query is emitted on the `db:query` event when at least one listener is attached. See the [debugging guide](../guides/debugging.md) for the full debug workflow.

```ts
db.table('users').debug(true).insert({ email: 'virk@adonisjs.com' })
```

### timeout

Abort the query if it runs longer than the given number of milliseconds. Pass `{ cancel: true }` on PostgreSQL and MySQL to cancel the underlying query rather than leaving it running on the server after the client times out.

```ts
db.table('users').timeout(5000).insert({ email })
db.table('users').timeout(5000, { cancel: true }).insert({ email })
```

## Schema and escape hatches

### withSchema

Set a non-default schema for the insert (PostgreSQL, MSSQL).

```ts
db.table('users').withSchema('analytics').insert({ event: 'signup' })
```

### knexQuery

Return the underlying Knex query builder. Use this when you need a Knex method that Lucid does not expose. The result is shaped by Knex rather than Lucid, so you lose Lucid's typed result. See [Drop to Knex](../guides/database_service.md#drop-to-knex) in the database service guide for the broader discussion.
