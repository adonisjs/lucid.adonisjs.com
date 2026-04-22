---
summary: The BelongsTo relationship covers the owning side of one-to-one and many-to-one relationships, where your model holds the foreign key pointing at another model.
---

# BelongsTo

This guide covers the `belongsTo` relationship. You will learn how to:

- Declare a `belongsTo` relationship and understand its options
- Load the related row eagerly or lazily
- Filter by the presence of the relationship
- Load counts and aggregates of the relationship
- Associate and dissociate the parent at runtime

## Overview

A `belongsTo` relationship declares that your model holds a foreign key column pointing at another model's primary key. Every row either points at exactly one parent or has the foreign key set to `NULL`.

```ts
// title: app/models/post.ts
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { PostsSchema } from '#database/schema'
import User from '#models/user'

export default class Post extends PostsSchema {
  @belongsTo(() => User)
  declare author: BelongsTo<typeof User>
}
```

Reach for `belongsTo` whenever your model is the side that carries the foreign key. A post that belongs to an author, an order that belongs to a customer, a comment that belongs to a post and to a user all fit this shape.

See [relationships introduction](./introduction.md) for the migration that backs this relationship and the conventions Lucid follows.

## Options

The decorator accepts an options object as its second argument.

```ts
@belongsTo(() => User, {
  foreignKey: 'authorId',
  localKey: 'id',
  onQuery: (query) => query.whereNull('deleted_at'),
})
declare author: BelongsTo<typeof User>
```

<dl>

<dt>

foreignKey

</dt>

<dd>

The property on this model that holds the foreign key value. Defaults to the camelCase of `{RelatedModel}_{primaryKey}`. For `belongsTo(() => User)`, the default is `userId`.

</dd>

<dt>

localKey

</dt>

<dd>

The column on the related model that the foreign key points at. Defaults to the related model's primary key, which is almost always `id`.

</dd>

<dt>

onQuery

</dt>

<dd>

A callback that runs on every read query Lucid generates for the relationship. Attach default constraints here so they apply automatically every time the relationship is loaded or queried.

```ts
@belongsTo(() => User, {
  onQuery: (query) => query.whereNull('deactivated_at'),
})
declare author: BelongsTo<typeof User>
```

Fires on `preload`, `related('author').query()`, and the subqueries used by `has`, `whereHas`, `withCount`, and `withAggregate`. Does not fire on `associate` or `dissociate`, which update the foreign key directly without running a read query.

</dd>

<dt>

meta

</dt>

<dd>

Arbitrary metadata attached to the relationship definition. Lucid does not read this field; it is available for your own tooling that inspects relationship definitions at runtime.

</dd>

</dl>

## Loading the related model

### Eager loading with preload

Call `preload('author')` on the query builder to hydrate the relationship on every returned row. One extra query runs regardless of how many posts came back.

```ts
const posts = await Post.query().preload('author').orderBy('created_at', 'desc')

posts.forEach((post) => {
  console.log(post.author.email)
})
```

Pass a callback to filter or order the relationship query.

```ts
await Post.query().preload('author', (authorsQuery) => {
  authorsQuery.select('id', 'email', 'first_name', 'last_name')
})
```

When the foreign key is nullable and the row has no author, `post.author` is `null` after preloading.

### Lazy loading from an instance

When you already have a model instance and only need the related row in some code paths, build a query through `related('author').query()`.

```ts
const post = await Post.findOrFail(params.id)

if (someCondition) {
  const author = await post.related('author').query().firstOrFail()
}
```

## Filtering by the relationship

Use `has` and `whereHas` on the parent's query builder to restrict rows based on the presence of the related record. `belongsTo` supports both, but the most common case is checking that the foreign key actually resolves to a row.

```ts
// Posts whose author still exists in the users table
const posts = await Post.query().has('author')

// Posts whose author's subscription is active
const posts = await Post
  .query()
  .whereHas('author', (authorQuery) => {
    authorQuery.where('subscription_status', 'active')
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

Use `withCount` and `withAggregate` to load derived values from the relationship without loading the rows themselves. Results land on the parent's `$extras` object.

```ts
const posts = await Post.query().withCount('author')

posts.forEach((post) => {
  // 1 when the author exists, 0 when the FK is null or the row is missing
  console.log(post.$extras.author_count)
})
```

Because `belongsTo` returns at most one row per parent, `withCount('author')` is useful primarily as a presence check that coexists with other data on the row. Custom aggregates through `withAggregate` follow the same pattern.

```ts
const posts = await Post
  .query()
  .withAggregate('author', (query) => {
    query.max('last_login_at').as('authorLastLoginAt')
  })
```

## Associating and dissociating

### associate(related)

`associate` links a related instance to the parent. Lucid saves the related model (so its primary key is populated), sets the parent's foreign key to the related model's primary key, and saves the parent. Both writes run inside a managed transaction, so either both commit or both roll back.

```ts
const post = new Post()
post.title = 'Hello'
post.body = 'World'

const user = await User.findOrFail(authorId)
await post.related('author').associate(user)

// post is now persisted with post.authorId === user.id
```

The related model does not need to be persisted before calling `associate`. Lucid saves it inside the transaction.

### dissociate()

`dissociate` sets the parent's foreign key column to `null` and saves the parent. The foreign key column must be nullable for this to work at the database level.

```ts
const post = await Post.findOrFail(params.id)
await post.related('author').dissociate()

// post.authorId is now null; the user row still exists
```

`dissociate` never deletes the related row. It only breaks the link by nulling the foreign key.

## Pagination

`belongsTo` relationships cannot be paginated. The relationship resolves to at most one row per parent, so `paginate` has no meaningful shape to produce. Calling `post.related('author').query().paginate(...)` throws at runtime.

To paginate the parent side of a `belongsTo`, use `Post.query().paginate(...)` as usual and preload the `author` on each row.
