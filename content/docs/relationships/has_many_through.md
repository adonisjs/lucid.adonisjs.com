---
summary: The HasManyThrough relationship traverses an intermediate model to reach a related model, letting you read across a chain of foreign keys in a single query.
---

# HasManyThrough

This guide covers the `hasManyThrough` relationship. You will learn how to:

- Declare a `hasManyThrough` relationship and understand its four key options
- Load the related rows eagerly or lazily
- Filter by the presence of related rows
- Load counts and aggregates of related rows
- Understand why `hasManyThrough` has no persistence methods

## Overview

A `hasManyThrough` relationship reaches a related model through an intermediate model. A country has many posts through its users; an organization has many invoices through its accounts.

```ts
// title: app/models/country.ts
import { hasManyThrough } from '@adonisjs/lucid/orm'
import type { HasManyThrough } from '@adonisjs/lucid/types/relations'
import { CountriesSchema } from '#database/schema'
import Post from '#models/post'
import User from '#models/user'

export default class Country extends CountriesSchema {
  @hasManyThrough([() => Post, () => User])
  declare posts: HasManyThrough<typeof Post>
}
```

The decorator takes a tuple of two model references. The first element is the target model you want to reach; the second is the intermediate model Lucid traverses through. In the example above, Lucid joins `countries` to `users` through `users.country_id`, then joins `users` to `posts` through `posts.user_id`.

See [relationships introduction](./introduction.md#hasmanythrough) for the migration shape that backs this relationship.

## Options

The decorator accepts an options object as its second argument. Four keys describe the chain between the three tables.

```ts
@hasManyThrough([() => Post, () => User], {
  foreignKey: 'countryId',      // users.country_id points at countries.id
  localKey: 'id',                // countries.id
  throughForeignKey: 'userId',   // posts.user_id points at users.id
  throughLocalKey: 'id',         // users.id
})
declare posts: HasManyThrough<typeof Post>
```

<dl>

<dt>

foreignKey

</dt>

<dd>

The property on the through model that holds the foreign key pointing at this model. Defaults to the camelCase of `{ThisModel}_{primaryKey}`. For `Country.hasManyThrough([Post, User])`, the default is `countryId` on `User`, backed by the `country_id` column.

</dd>

<dt>

localKey

</dt>

<dd>

The column on this model that the through model's `foreignKey` points at. Defaults to this model's primary key.

</dd>

<dt>

throughForeignKey

</dt>

<dd>

The property on the related model that holds the foreign key pointing at the through model. Defaults to the camelCase of `{ThroughModel}_{primaryKey}`. For the `User` through model with primary key `id`, the default is `userId` on `Post`, backed by the `user_id` column.

</dd>

<dt>

throughLocalKey

</dt>

<dd>

The column on the through model that the related model's `throughForeignKey` points at. Defaults to the through model's primary key.

</dd>

<dt>

onQuery

</dt>

<dd>

A callback that runs on every read query Lucid generates for the relationship.

```ts
@hasManyThrough([() => Post, () => User], {
  onQuery: (query) => query.where('posts.is_published', true),
})
declare posts: HasManyThrough<typeof Post>
```

Fires on `preload`, `related('posts').query()`, and the subqueries used by `has`, `whereHas`, `withCount`, and `withAggregate`.

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

Call `preload('posts')` on the query builder to hydrate the relationship on every returned country. One extra query runs regardless of how many countries came back, even though the query joins through the intermediate users table.

```ts
const countries = await Country.query().preload('posts')

countries.forEach((country) => {
  console.log(country.posts.length)
})
```

Pass a callback to filter or order the relationship query. The callback receives the related model's query builder, so filtering and ordering target the `Post` columns.

```ts
await Country.query().preload('posts', (postsQuery) => {
  postsQuery.where('is_published', true).orderBy('created_at', 'desc')
})
```

When no related rows exist, `country.posts` is an empty array.

### Lazy loading from an instance

When you already have a parent instance, build a query through `related('posts').query()`.

```ts
const country = await Country.findOrFail(params.id)
const recentPosts = await country
  .related('posts')
  .query()
  .orderBy('created_at', 'desc')
  .limit(10)
```

## Filtering by the relationship

Use `has` and `whereHas` on the parent's query builder to restrict rows based on the presence of related records.

```ts
// Countries with at least one post (through their users)
const active = await Country.query().has('posts')

// Countries with at least one published post in the last 30 days
const recent = await Country.query().whereHas('posts', (postsQuery) => {
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

Use `withCount` and `withAggregate` to load derived values from the relationship. Results land on the parent's `$extras` object.

```ts
const countries = await Country.query().withCount('posts')

countries.forEach((country) => {
  console.log(country.$extras.posts_count)
})
```

Override the alias through the callback when the default `{relation}_count` is not what you want.

```ts
const countries = await Country
  .query()
  .withCount('posts', (query) => {
    query.where('is_published', true).as('publishedPostsCount')
  })
```

`withAggregate` runs any aggregate function.

```ts
const countries = await Country
  .query()
  .withAggregate('posts', (query) => {
    query.max('created_at').as('latestPostAt')
  })
```

## No persistence through hasManyThrough

`hasManyThrough` is read-only. Unlike `hasMany` or `manyToMany`, there is no `save`, `create`, `attach`, or `sync` on `country.related('posts')`.

The reason is that creating a post for a country implicitly requires a user, and Lucid cannot infer which user the new post should belong to. Persist through the intermediate relationship directly.

```ts
// Wrong: hasManyThrough has no write methods
// country.related('posts').create({ ... })

// Right: persist through the intermediate relationship
const user = await country.related('users').query().firstOrFail()
await user.related('posts').create({ title: 'Hello' })
```

## Pagination

`paginate(page, perPage)` works when you lazy-load the relationship through `related('posts').query()`.

```ts
const country = await Country.findOrFail(params.id)
const posts = await country
  .related('posts')
  .query()
  .orderBy('created_at', 'desc')
  .paginate(page, 20)
```

Paginating inside a preload callback throws, because a single paginator cannot express per-parent page boundaries. Query the parent first, then lazy-load the paginated relationship for the specific parent your endpoint needs.

See the [pagination guide](../guides/pagination.md) for the paginator API, URL customization, and transformer integration.
