---
summary: The HasMany relationship describes the referenced side of a one-to-many relationship, where another model holds a foreign key pointing back at this one.
---

# HasMany

This guide covers the `hasMany` relationship. You will learn how to:

- Declare a `hasMany` relationship and understand its options
- Load the related rows eagerly or lazily
- Limit and order preloaded rows per parent
- Filter by the presence of related rows
- Load counts and aggregates of related rows
- Create, save, and update related rows through the parent

## Overview

A `hasMany` relationship declares that another model holds a foreign key pointing back at your model's primary key, and that there can be many such rows per parent. A user has many posts, a post has many comments, a project has many tasks.

```ts
// title: app/models/user.ts
import { hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { UsersSchema } from '#database/schema'
import Post from '#models/post'

export default class User extends UsersSchema {
  @hasMany(() => Post)
  declare posts: HasMany<typeof Post>
}
```

Reach for `hasMany` from the referenced side. The model that holds the foreign key uses [`belongsTo`](./belongs_to.md) to declare the inverse side.

See [relationships introduction](./introduction.md) for the migration that backs this relationship and the conventions Lucid follows.

## Options

The decorator accepts an options object as its second argument.

```ts
@hasMany(() => Post, {
  foreignKey: 'authorId',
  localKey: 'id',
  onQuery: (query) => query.whereNull('deleted_at'),
})
declare posts: HasMany<typeof Post>
```

<dl>

<dt>

foreignKey

</dt>

<dd>

The property on the related model that holds the foreign key value. Defaults to the camelCase of `{ThisModel}_{primaryKey}`. For `User.hasMany(() => Post)`, the default is `userId` on `Post`, backed by the `user_id` column.

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

A callback that runs on every read query Lucid generates for the relationship. Attach default constraints here so they apply automatically every time the relationship is loaded or queried.

```ts
@hasMany(() => Post, {
  onQuery: (query) => query.whereNull('deleted_at').orderBy('created_at', 'desc'),
})
declare posts: HasMany<typeof Post>
```

Fires on `preload`, `related('posts').query()`, and the subqueries used by `has`, `whereHas`, `withCount`, and `withAggregate`. Does not fire on `save`, `create`, `createMany`, `saveMany`, `firstOrCreate`, `updateOrCreate`, `fetchOrCreateMany`, or `updateOrCreateMany`, which write directly through the foreign key column.

</dd>

<dt>

meta

</dt>

<dd>

Arbitrary metadata attached to the relationship definition. Lucid does not read this field; it is available for your own tooling that inspects relationship definitions at runtime.

</dd>

</dl>

## Loading the related rows

### Eager loading with preload

Call `preload('posts')` on the query builder to hydrate the relationship on every returned row. One extra query runs regardless of how many users came back.

```ts
const users = await User.query().preload('posts')

users.forEach((user) => {
  console.log(user.posts.length)
})
```

Pass a callback to filter or order the relationship query.

```ts
await User.query().preload('posts', (postsQuery) => {
  postsQuery.where('is_published', true).orderBy('created_at', 'desc')
})
```

When no related rows exist, `user.posts` is an empty array.

### Limiting rows per parent with groupLimit

A plain `.limit(5)` inside a preload callback does not produce five rows per parent. It limits the total number of rows returned across all parents combined, which is almost never what you want.

To load the top-N per parent, use `groupLimit` and `groupOrderBy`. These methods use window functions under the hood to partition the results by parent before applying the limit.

```ts
await User.query().preload('posts', (postsQuery) => {
  postsQuery.groupLimit(5).groupOrderBy('created_at', 'desc')
})
// Each user gets their 5 most recent posts, regardless of how many users came back.
```

`groupLimit` and `groupOrderBy` apply only inside a preload. When you are lazy-loading through `related('posts').query()`, plain `.limit(...)` and `.orderBy(...)` work because the query runs against a single parent.

### Lazy loading from an instance

When you already have a model instance and only need the related rows in some code paths, build a query through `related('posts').query()`.

```ts
const user = await User.findOrFail(params.id)
const recentPosts = await user
  .related('posts')
  .query()
  .orderBy('created_at', 'desc')
  .limit(5)
```

## Filtering by the relationship

Use `has` and `whereHas` on the parent's query builder to restrict rows based on the presence of related records. `hasMany` supports count-based filtering with an operator and a value.

```ts
// Users with at least one post
const authors = await User.query().has('posts')

// Users with five or more posts
const prolific = await User.query().has('posts', '>=', 5)

// Users with at least one published post in the last 30 days
const recent = await User.query().whereHas('posts', (postsQuery) => {
  postsQuery
    .where('is_published', true)
    .where('created_at', '>', DateTime.now().minus({ days: 30 }).toSQL())
})
```

Variants for combining and inverting:

| Method | Description |
| --- | --- |
| `has` / `andHas` | The relationship has matching rows |
| `orHas` | OR-combined presence check |
| `doesntHave` / `andDoesntHave` | The relationship has no matching rows |
| `orDoesntHave` | OR-combined absence check |
| `whereHas` / `andWhereHas` | Relationship has matching rows with constraints |
| `orWhereHas` | OR-combined `whereHas` |
| `whereDoesntHave` / `andWhereDoesntHave` | Relationship has no matching rows with constraints |
| `orWhereDoesntHave` | OR-combined `whereDoesntHave` |

## Aggregates

Use `withCount` to load counts and `withAggregate` to load custom aggregates from the relationship without loading the rows themselves. Results land on the parent's `$extras` object.

```ts
const users = await User.query().withCount('posts')

users.forEach((user) => {
  console.log(user.$extras.posts_count)
})
```

The default alias is `{relationName}_count`. Override it through the callback.

```ts
const users = await User
  .query()
  .withCount('posts', (query) => {
    query.where('is_published', true).as('publishedPostsCount')
  })
```

`withAggregate` runs any aggregate function. Define the alias with `.as(...)` inside the callback.

```ts
const users = await User
  .query()
  .withAggregate('posts', (query) => {
    query.max('created_at').as('lastPostAt')
  })
```

## Persisting through the relationship

Every method below runs inside a managed transaction. The parent is saved first so its primary key is available, the related row's foreign key is set automatically, and the related row is saved next. If anything fails, the entire batch rolls back.

### save and saveMany

`save(related)` persists a single unsaved model instance as a child of the parent. `saveMany(related[])` does the same for an array.

```ts
const user = await User.findOrFail(1)

const post = new Post()
post.title = 'Hello'
post.body = 'World'

await user.related('posts').save(post)
// post.userId is now user.id, and the post row is persisted
```

```ts
const drafts = [new Post(), new Post(), new Post()]
// assign title/body on each
await user.related('posts').saveMany(drafts)
```

### create and createMany

`create(values)` builds a model instance from the values, sets the foreign key from the parent, and persists. `createMany(values[])` does the same for an array.

```ts
const post = await user.related('posts').create({
  title: 'Hello',
  body: 'World',
})
```

```ts
const posts = await user.related('posts').createMany([
  { title: 'First', body: '...' },
  { title: 'Second', body: '...' },
])
```

### firstOrCreate

Search the relationship for a row matching the search payload. Create one when nothing matches. The save payload, if provided, is merged with the search payload on create and ignored when a row already exists.

```ts
const post = await user.related('posts').firstOrCreate(
  { slug: 'hello-world' },            // search
  { title: 'Hello, world', body: '' } // used only when creating
)
```

### updateOrCreate

Update the matching row with the update payload, or create a new row with the combined payload when nothing matches.

```ts
await user.related('posts').updateOrCreate(
  { slug: 'hello-world' },
  { title: 'Updated title', body: 'Updated body' }
)
```

### fetchOrCreateMany and updateOrCreateMany

Batch variants that work the same way as their single-row counterparts. Both accept a predicate key (or array of keys) that identifies each row, plus an array of rows to sync.

```ts
// Ensure a tag exists for every slug, inserting missing ones
await project.related('tags').fetchOrCreateMany('slug', [
  { slug: 'alpha', label: 'Alpha' },
  { slug: 'beta', label: 'Beta' },
])

// Update label on existing tags or insert new rows
await project.related('tags').updateOrCreateMany('slug', [
  { slug: 'alpha', label: 'Alpha (updated)' },
  { slug: 'beta', label: 'Beta (updated)' },
])
```

For both batch variants, the predicate is combined with the relationship's foreign key automatically. You do not need to include the foreign key in the payload or the predicate; Lucid sets it from the parent.

## Pagination

`paginate(page, perPage)` works when you lazy-load the relationship through `related('posts').query()`.

```ts
const user = await User.findOrFail(params.id)
const posts = await user
  .related('posts')
  .query()
  .orderBy('created_at', 'desc')
  .paginate(page, 20)
```

`paginate` is not allowed inside a preload callback. Pagination across multiple parents in one query does not have a well-defined shape, because each parent would need its own page boundaries. To work around this, query the parent first, then lazy-load the paginated relationship for the specific parent your endpoint needs.

See the [pagination guide](../guides/pagination.md) for the paginator API, URL customization, and transformer integration.
