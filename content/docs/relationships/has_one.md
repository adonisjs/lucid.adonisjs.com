---
summary: The HasOne relationship describes the referenced side of a one-to-one relationship, where another model holds a foreign key pointing back at this one.
---

# HasOne

This guide covers the `hasOne` relationship. You will learn how to:

- Declare a `hasOne` relationship and understand its options
- Load the related row eagerly or lazily
- Filter by the presence of the related row
- Persist the related row through `save`, `create`, `firstOrCreate`, and `updateOrCreate`

## Overview

A `hasOne` relationship declares that another model holds a foreign key pointing back at your model's primary key, and that there is at most a single row per parent. A user has one profile, an organization has one billing configuration, a team has one owner.

```ts
// title: app/models/user.ts
import { hasOne } from '@adonisjs/lucid/orm'
import type { HasOne } from '@adonisjs/lucid/types/relations'
import { UsersSchema } from '#database/schema'
import Profile from '#models/profile'

export default class User extends UsersSchema {
  @hasOne(() => Profile)
  declare profile: HasOne<typeof Profile>
}
```

Reach for `hasOne` from the referenced side. The model that holds the foreign key uses [`belongsTo`](./belongs_to.md) to declare the inverse side.

The "one row per parent" guarantee must be enforced by the database. Add a unique index on the foreign key column in the related model's migration so the database rejects attempts to create a second related row. See [relationships introduction](./introduction.md#hasone) for the migration shape.

## Options

The decorator accepts an options object as its second argument.

```ts
@hasOne(() => Profile, {
  foreignKey: 'userId',
  localKey: 'id',
  onQuery: (query) => query.whereNull('deleted_at'),
})
declare profile: HasOne<typeof Profile>
```

<dl>

<dt>

foreignKey

</dt>

<dd>

The property on the related model that holds the foreign key value. Defaults to the camelCase of `{ThisModel}_{primaryKey}`. For `User.hasOne(() => Profile)`, the default is `userId` on `Profile`, backed by the `user_id` column.

</dd>

<dt>

localKey

</dt>

<dd>

The column on this model that the related model's foreign key points at. Defaults to this model's primary key, which is almost always `id`.

</dd>

<dt>

onQuery

</dt>

<dd>

A callback that runs on every read query Lucid generates for the relationship.

```ts
@hasOne(() => Profile, {
  onQuery: (query) => query.whereNull('deleted_at'),
})
declare profile: HasOne<typeof Profile>
```

Fires on `preload`, `related('profile').query()`, and the subqueries used by `has`, `whereHas`, `withCount`, and `withAggregate`. Does not fire on `save`, `create`, `firstOrCreate`, or `updateOrCreate`, which write directly through the foreign key column.

</dd>

<dt>

meta

</dt>

<dd>

Arbitrary metadata attached to the relationship definition. Lucid does not read this field; it is available for your own tooling that inspects relationship definitions at runtime.

</dd>

</dl>

## Loading the related row

### Eager loading with preload

Call `preload('profile')` on the query builder to hydrate the relationship on every returned row. One extra query runs regardless of how many users came back.

```ts
const users = await User.query().preload('profile')

users.forEach((user) => {
  console.log(user.profile?.displayName)
})
```

Pass a callback to filter or select the relationship query.

```ts
await User.query().preload('profile', (profileQuery) => {
  profileQuery.select('id', 'user_id', 'display_name', 'avatar_url')
})
```

When no related row exists, `user.profile` is `null`. Guard with optional chaining or an explicit check before accessing fields.

### Lazy loading from an instance

When you already have a model instance and only need the related row in some code paths, build a query through `related('profile').query()`.

```ts
const user = await User.findOrFail(params.id)
const profile = await user.related('profile').query().first()
```

## Filtering by the relationship

Use `has` and `whereHas` on the parent's query builder to restrict rows based on the presence of the related record.

```ts
// Users that have a profile row
const usersWithProfile = await User.query().has('profile')

// Users whose profile is marked as public
const publicProfiles = await User.query().whereHas('profile', (profileQuery) => {
  profileQuery.where('is_public', true)
})
```

Variants for combining and inverting:

| Method | Description |
| --- | --- |
| `has` / `andHas` | The relationship has a matching row |
| `orHas` | OR-combined presence check |
| `doesntHave` / `andDoesntHave` | The relationship has no matching row |
| `orDoesntHave` | OR-combined absence check |
| `whereHas` / `andWhereHas` | Relationship has a matching row with constraints |
| `orWhereHas` | OR-combined `whereHas` |
| `whereDoesntHave` / `andWhereDoesntHave` | Relationship has no matching row with constraints |
| `orWhereDoesntHave` | OR-combined `whereDoesntHave` |

## Aggregates

Use `withCount` and `withAggregate` to load derived values from the relationship without loading the row itself. Results land on the parent's `$extras` object.

```ts
const users = await User.query().withCount('profile')

users.forEach((user) => {
  // 1 when a profile exists, 0 otherwise
  console.log(user.$extras.profile_count)
})
```

Because `hasOne` returns at most one row per parent, `withCount` is mostly useful as a presence flag that coexists with other data on the row. For richer projections use `withAggregate`.

```ts
const users = await User
  .query()
  .withAggregate('profile', (query) => {
    query.max('updated_at').as('profileUpdatedAt')
  })
```

## Persisting through the relationship

Each method below runs inside a managed transaction. The parent is saved first so its primary key is available, the related row's foreign key is set automatically, and the related row is saved next. If anything fails, both writes roll back.

### save

`save(related)` persists a related model instance as the child of the parent.

```ts
const user = await User.findOrFail(1)

const profile = new Profile()
profile.displayName = 'Harminder'
profile.bio = 'Building AdonisJS'

await user.related('profile').save(profile)
// profile.userId === user.id and the row is persisted
```

`save` does not prevent creating a second profile when the database does not enforce the one-row constraint. Always add a unique index on the foreign key column in the related table's migration so the database rejects duplicates.

### create

`create(values)` builds a new related instance from the values, sets the foreign key from the parent, and persists.

```ts
const profile = await user.related('profile').create({
  displayName: 'Harminder',
  bio: 'Building AdonisJS',
})
```

### firstOrCreate

Search the relationship for a row matching the search payload. Create one when nothing matches. The save payload, if provided, is merged with the search payload on create and ignored when a row already exists.

```ts
const profile = await user.related('profile').firstOrCreate(
  {},                                       // search (empty: match any profile for this user)
  { displayName: 'New user', bio: '' }     // used only when creating
)
```

`firstOrCreate` is the idempotent way to ensure a `hasOne` row exists without risking a duplicate. Call it from a controller that handles the "create the profile if missing" flow.

### updateOrCreate

Update the matching row with the update payload, or create a new row with the combined payload when nothing matches.

```ts
await user.related('profile').updateOrCreate(
  {},                                           // search
  { displayName: 'Harminder', bio: 'Updated' }  // applied on both paths
)
```

## Pagination

`hasOne` relationships cannot be paginated. The relationship resolves to at most one row per parent, so `paginate` has no meaningful shape to produce. Calling `user.related('profile').query().paginate(...)` throws at runtime.

To paginate the parent side of a `hasOne`, use `User.query().paginate(...)` as usual and preload the `profile` on each row.
