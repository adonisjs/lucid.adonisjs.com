---
summary: Lucid ships testing utilities for setting up and tearing down the database, wrapping tests in rollback-on-teardown transactions, and asserting against table state from inside your tests.
---

# Testing utilities

This guide covers Lucid's testing utilities. You will learn how to:

- Set up the database schema for a test run
- Reset data between tests
- Isolate each test inside a transaction that rolls back on teardown
- Assert against table state directly from test bodies
- Scope any of the above to a specific connection

## Overview

Lucid exposes testing utilities through two surfaces:

- **`testUtils.db()`** from `@adonisjs/core/services/test_utils` returns a `DatabaseTestUtils` instance for setting up, tearing down, and isolating the database across a test run.
- **`dbAssertions`** plugin from `@adonisjs/lucid/plugins/japa/db` adds database assertions onto Japa's `TestContext` as the `db` accessor.

The two are independent. You can use `testUtils.db()` in test hooks without registering the Japa plugin, or register the plugin without using the other test utils.

## Setting up the schema

Wire two hooks into your test setup: `migrate()` at the runner level to apply and later roll back every migration, and `truncate()` at the group level to clear data between individual tests.

```ts
// title: tests/bootstrap.ts
import testUtils from '@adonisjs/core/services/test_utils'

export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [
    () => testUtils.db().migrate(),
  ],
  teardown: [],
}
```

`migrate()` runs `migration:run` once when the test runner starts and returns a cleanup that runs `migration:reset` when the runner exits. The schema is ready for every test in the run, and the database is reset to empty when the process finishes.

Inside each test group, register `truncate()` as a `group.each.setup` hook to reset data between individual tests.

```ts
// title: tests/functional/posts.spec.ts
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'

test.group('Posts', (group) => {
  group.each.setup(() => testUtils.db().truncate())
})
```

`truncate()` returns a cleanup that empties every table after the test completes. Each test in the group starts against the schema defined by the runner hook, plus whatever data the group's own setup (seeders, fixtures) has inserted.

## Running seeders

`seed()` runs the configured seeders through the `db:seed` command. Pair it with the truncate hook so seeded data is reset between tests.

```ts
test.group('Subscriptions', (group) => {
  group.each.setup(async () => {
    const cleanup = await testUtils.db().truncate()
    await testUtils.db().seed()
    return cleanup
  })
})
```

The cleanup from `truncate()` still runs after every test, so the seeded data lives only for the duration of one test.

## Wrapping each test in a transaction

`wrapInGlobalTransaction()` is an alternative to `truncate()` at the group level. It begins a global transaction before each test and rolls it back at the end, so nothing the test writes is actually persisted. This is the fastest isolation mechanism because no cleanup is needed beyond the rollback.

```ts
test.group('Users', (group) => {
  group.each.setup(() => testUtils.db().wrapInGlobalTransaction())
})
```

Every query Lucid runs inside the test runs through the same transaction, so writes are visible to subsequent queries in the same test but disappear when the transaction rolls back.

This pattern is suitable for:

- Tests that interact with the database only through Lucid
- Tests that do not spawn subprocesses or external workers that need to see the committed state

It is not suitable for:

- Tests that simulate multiple concurrent transactions, because there is only one transaction open at a time
- Tests that shell out to another process, since the other process cannot see writes inside a not-yet-committed transaction

For those cases, use `truncate()` instead.

`withGlobalTransaction()` is a deprecated alias of `wrapInGlobalTransaction()`. Use the non-deprecated name for new tests.

## Database assertions

The `dbAssertions` Japa plugin adds a `db` property to Japa's `TestContext` with methods for asserting against table state directly.

### Registering the plugin

Add the plugin to your Japa config.

```ts
// title: tests/bootstrap.ts
import app from '@adonisjs/core/services/app'
import { dbAssertions } from '@adonisjs/lucid/plugins/japa/db'

export const plugins: Config['plugins'] = [
  dbAssertions(app),
]
```

Once registered, destructure `db` from the test context to access the assertion methods.

```ts
test('creates a user', async ({ client, db }) => {
  await client.post('/users').json({ email: 'virk@adonisjs.com' })

  await db.assertHas('users', { email: 'virk@adonisjs.com' })
})
```

### Available assertions

<dl>

<dt>

assertHas(table, data, count?)

</dt>

<dd>

Passes when the table has at least one row matching every column-value pair in `data`. When `count` is provided, passes only when exactly that many matching rows exist.

```ts
// At least one row
await db.assertHas('users', { email: 'virk@adonisjs.com' })

// Exactly two matching rows
await db.assertHas('posts', { author_id: 1, is_published: true }, 2)
```

</dd>

<dt>

assertMissing(table, data)

</dt>

<dd>

Passes when no row matches the given column-value pairs.

```ts
await db.assertMissing('users', { email: 'deleted@example.com' })
```

</dd>

<dt>

assertCount(table, expectedCount)

</dt>

<dd>

Passes when the table has exactly `expectedCount` rows total.

```ts
await db.assertCount('users', 3)
```

</dd>

<dt>

assertEmpty(table)

</dt>

<dd>

Shorthand for `assertCount(table, 0)`.

```ts
await db.assertEmpty('sessions')
```

</dd>

<dt>

assertModelExists(model)

</dt>

<dd>

Passes when a row with the model's primary key exists in the database. Takes a model instance and reads its `$primaryKeyValue`.

```ts
const user = await User.findOrFail(1)
await db.assertModelExists(user)
```

Throws if the model has no primary key value set.

</dd>

<dt>

assertModelMissing(model)

</dt>

<dd>

Passes when no row exists for the model's primary key. Useful after a delete to confirm the row is gone.

```ts
const user = await User.findOrFail(1)
await user.delete()
await db.assertModelMissing(user)
```

</dd>

</dl>

## Scoping to a specific connection

Every utility accepts an optional connection name when your application uses multiple connections. Use it to run the same setup, teardown, or assertion against a non-default database.

```ts
// Setup hooks on a specific connection
group.each.setup(() => testUtils.db('analytics').truncate())

// Transactional isolation on a specific connection
group.each.setup(() => testUtils.db('analytics').wrapInGlobalTransaction())

// Assertions on a specific connection
await db.connection('analytics').assertHas('events', { kind: 'signup' })
```

The `db.connection(name)` method on the assertions object returns a new assertion helper scoped to the named connection; it does not modify the default helper.
