---
summary: Create, read, update, and delete records with Lucid models, including find-or-create and update-or-create helpers, bulk variants, and the hooks-skipping Quietly family.
---

# CRUD operations

This guide covers the CRUD API on Lucid models. You will learn how to:

- Create records individually or in bulk
- Read records with `find`, `findBy`, `first`, and their `orFail` variants
- Update records through the fetch-then-save pattern or with the query builder
- Delete records one at a time or in bulk
- Use find-or-create and update-or-create helpers
- Skip lifecycle hooks with the `Quietly` variants

## Overview

A Lucid model exposes CRUD operations as both static methods on the class and instance methods on a loaded model. Static methods cover the common cases (`Model.create`, `Model.findOrFail`, `Model.updateOrCreate`); instance methods operate on an already-loaded row (`user.save`, `user.delete`). The model query builder, reached through `Model.query()`, handles every query that does not fit a single-method call. See the [model query builder](./query_builder.md) for the full reference.

## Creating records

### create

Persist a new record by passing an object of column values. The method inserts a row, runs every configured hook, and returns the model instance.

```ts
// title: app/controllers/users_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'

export default class UsersController {
  async store({ request }: HttpContext) {
    const user = await User.create({
      email: request.input('email'),
      password: request.input('password'),
    })

    return user
  }
}
```

### Building an instance first

Create the instance, assign columns one at a time, and persist with `save`. The first `save` call runs the `INSERT`; subsequent `save` calls run `UPDATE`.

```ts
const user = new User()
user.email = 'virk@adonisjs.com'
user.password = 'secret'
await user.save()
```

`fill` and `merge` set multiple attributes at once on an unsaved or loaded instance. They behave differently: `fill` **replaces** the model's attributes entirely before setting the new values, while `merge` updates only the keys you pass and leaves everything else untouched.

```ts
const user = new User()

// Equivalent ways to set multiple attributes before saving
await user.fill({ email, password }).save()
await user.merge({ email, password }).save()

// On a loaded instance, merge is usually what you want
const existing = await User.findOrFail(1)
existing.merge({ email: newEmail }).save()
```

Reach for `fill` when you want to completely reset an instance before assigning new values. Reach for `merge` when you want to update a subset of columns and keep the rest of the instance's state.

### createMany

Persist an array of records. `createMany` opens a managed transaction, inserts each row individually (so every model's hooks and timestamps run), and commits the whole batch together. If any insert fails, the transaction rolls back.

```ts
const users = await User.createMany([
  { email: 'virk@adonisjs.com', password: 'secret' },
  { email: 'romain@adonisjs.com', password: 'secret' },
])
```

Because each row is inserted separately, the total number of queries scales with the batch size. For large imports where hooks are not required, use `db.table('users').multiInsert(...)` from the [insert query builder](../query_builders/insert.md) instead, which produces a single statement.

### allowExtraProperties

By default, passing a key that is not declared on the model throws an error. Set `allowExtraProperties: true` to silently drop unknown keys instead. Useful when forwarding an HTTP request payload that may include client-side fields that do not map to the database.

```ts
await User.create(request.all(), { allowExtraProperties: true })

// Or on an instance
user.fill(request.all(), true).save()
```

### createQuietly and createManyQuietly

The `Quietly` variants insert records **without running hooks**. Use them when hooks must be skipped, such as inside seeders that pre-compute the values hooks would otherwise generate, or during test fixture setup.

```ts
await User.createQuietly({ email, password })

await User.createManyQuietly([
  { email: 'a@example.com', password: 'secret' },
  { email: 'b@example.com', password: 'secret' },
])
```

Hooks-skipping applies only to the insert itself. Related model operations you kick off inside the callback still run their own hooks.

## Reading records

### all

Fetch every row from the table.

```ts
const users = await User.all()
// SQL: SELECT * FROM "users" ORDER BY "id" DESC
```

### find and findOrFail

Look up a row by primary key. `find` returns `null` when no row matches; `findOrFail` throws `E_ROW_NOT_FOUND` (which AdonisJS surfaces as a 404 response).

```ts
const user = await User.find(1)              // User | null
const user = await User.findOrFail(1)        // User, or 404
```

### findBy and findByOrFail

Look up a row by any column. Two call shapes are supported: column + value, or a single object of column-value pairs for compound lookups.

```ts
const user = await User.findBy('email', 'virk@adonisjs.com')

const user = await User.findBy({
  email: 'virk@adonisjs.com',
  is_active: true,
})
```

`findByOrFail` has the same two signatures and throws when no row matches.

```ts
const user = await User.findByOrFail('email', 'virk@adonisjs.com')
```

### findMany and findManyBy

`findMany` loads multiple rows by primary key. `findManyBy` loads multiple rows that match one or more columns (same two signatures as `findBy`).

```ts
const users = await User.findMany([1, 2, 3])

const activeUsers = await User.findManyBy('is_active', true)

const activeAdmins = await User.findManyBy({
  is_active: true,
  role: 'admin',
})
```

:::warning
`findMany` does not preserve the order of the input array. Rows come back sorted by primary key (descending). Do not assume `findMany([2, 1])` returns the row with `id = 2` first. When order matters, build the query with `Model.query().whereIn(...).orderBy(...)` or sort the result in application code.
:::

### first and firstOrFail

Fetch the first row from the table. Without a query constraint, this returns the row with the lowest primary key on most dialects.

```ts
const user = await User.first()          // User | null
const user = await User.firstOrFail()    // User, or throws
```

### Using the query builder

The static finders cover the common shapes. For anything beyond (ordering, joins, scopes, preloads, conditional filters), reach for the model query builder.

```ts
const users = await User
  .query()
  .where('is_active', true)
  .orWhereNotNull('subscription_plan')
  .orderBy('created_at', 'desc')

const user = await User
  .query()
  .where('email', email)
  .firstOrFail()
```

See the [model query builder guide](./query_builder.md) for the full API, including preloads, aggregates, and query scopes.

## Updating records

### Fetch, mutate, save

The standard pattern is to load the row, change the attributes you want to update, and call `save`. Lucid tracks which columns changed through `$dirty` and only writes those columns.

```ts
const user = await User.findOrFail(params.id)
user.email = request.input('email')
await user.save()
```

Use `merge + save` when you want to apply several changes at once.

```ts
await user.merge({
  email: request.input('email'),
  lastLoginAt: DateTime.now(),
}).save()
```

### saveQuietly

Save without running `beforeSave`, `afterSave`, `beforeUpdate`, or `afterUpdate` hooks. Use when seeding, restoring backups, or updating columns that should not trigger the side effects hooks perform.

```ts
user.lastSyncedAt = DateTime.now()
await user.saveQuietly()
```

### Updating in bulk with the query builder

When you need to touch many rows at once (marking expired sessions, archiving old rows, resetting a flag), use the model query builder's `update`. It issues a single `UPDATE` statement and skips model hooks and auto-timestamps.

```ts
await User.query().where('is_active', false).update({
  status: 'archived',
  archived_at: DateTime.now().toSQL(),
})
```

Because this path bypasses model hooks, any invariants your hooks enforce (password hashing, audit log inserts, computed columns) will not run. Reach for the instance pattern when each row needs the full model pipeline; use the query builder path when the rows are managed by the SQL alone.

## Deleting records

### Instance delete

Load the row and call `delete`. The instance's `$isDeleted` flag flips to `true`.

```ts
const user = await User.findOrFail(params.id)
await user.delete()
```

### deleteQuietly

Delete without running `beforeDelete` or `afterDelete` hooks.

```ts
await user.deleteQuietly()
```

### Deleting in bulk with the query builder

For deletes that should not run hooks on every row, issue the delete through the query builder.

```ts
await User.query().where('is_verified', false).delete()
```

The same caveat as bulk updates applies: hooks and automatic timestamp columns are skipped.

## Upsert and find-or-create helpers

These static methods combine a lookup with a conditional create or update. All of them accept a separate **search payload** (the keys used to find an existing row) and an optional **save payload** (the values written when a new row is created or an existing one is updated).

### firstOrCreate

Find a row that matches the search payload. Create one with the merged search and save payload when no row matches. Returns the existing or newly created model.

```ts
const user = await User.firstOrCreate(
  { email: 'virk@adonisjs.com' },  // search
  { password: 'secret' }           // additional values if creating
)
```

If a user with that email exists, it is returned as-is and `password` is ignored. If no match exists, Lucid inserts a row with both the email and the password.

### firstOrNew

Same lookup as `firstOrCreate`, but when no row matches, Lucid returns a new **unsaved** instance with the combined payload. Useful when you want to make more changes before persisting, or decide whether to save at all.

```ts
const user = await User.firstOrNew(
  { email: 'virk@adonisjs.com' },
  { password: 'secret' }
)

if (user.$isNew) {
  user.source = 'invitation'
  await user.save()
}
```

### updateOrCreate

Find a row matching the search payload and update it with the save payload, or insert a new row with the combined payload when no match exists.

```ts
await User.updateOrCreate(
  { email: 'virk@adonisjs.com' },
  { lastLoginAt: DateTime.now() }
)
```

Unlike `firstOrCreate`, `updateOrCreate` always writes to the database, either as an `INSERT` or an `UPDATE` statement.

### fetchOrCreateMany

Batch version of `firstOrCreate`. Pass a unique key (or array of keys) that identifies a row, plus an array of objects. For each object, Lucid looks up an existing row by the key and inserts when no row matches. Existing rows are returned unchanged.

```ts
await User.fetchOrCreateMany('email', [
  { email: 'foo@example.com', name: 'Foo' },
  { email: 'bar@example.com', name: 'Bar' },
])
```

Compound keys work with an array:

```ts
await Post.fetchOrCreateMany(['tenant_id', 'slug'], [
  { tenant_id: 1, slug: 'hello', body: '...' },
  { tenant_id: 1, slug: 'world', body: '...' },
])
```

### fetchOrNewUpMany

Same as `fetchOrCreateMany`, but rows that do not exist are returned as unsaved instances rather than inserted. Useful for preview flows or for deferring persistence until after an explicit confirmation.

```ts
const users = await User.fetchOrNewUpMany('email', [
  { email: 'foo@example.com', name: 'Foo' },
  { email: 'bar@example.com', name: 'Bar' },
])

// Some of the items may be unsaved instances
users.filter((user) => user.$isNew)
```

### updateOrCreateMany

Batch version of `updateOrCreate`. Each object is matched by the given key. Existing rows are updated; missing rows are inserted.

```ts
await User.updateOrCreateMany('email', [
  { email: 'foo@example.com', name: 'Foo' },
  { email: 'bar@example.com', name: 'Bar' },
])
```

Compound keys work here too, and are typically how you sync parent + child combinations.

```ts
await SubscriptionDay.updateOrCreateMany(['subscription_id', 'day'], days)
```

All four batch helpers (`fetchOrCreateMany`, `fetchOrNewUpMany`, `updateOrCreateMany`, `createMany`) wrap their writes in a managed transaction, so the batch is all-or-nothing.

## Truncate

`Model.truncate` empties the underlying table. Use it in test setup and teardown to reset to a clean state. Pass `true` to cascade-truncate related tables on dialects that support it (PostgreSQL, MSSQL).

```ts
await User.truncate()
await User.truncate(true)  // cascade
```

Truncate bypasses model hooks and does not fire `beforeDelete` or `afterDelete`. It is faster than `DELETE FROM users` because most databases reset the auto-increment counter and skip per-row logging, but the two are not equivalent in every dialect.
