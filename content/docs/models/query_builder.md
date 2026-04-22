---
summary: The model query builder covers preloading, relationship aggregates and filters, query scopes, result transformation, and pagination.
---

# Model query builder

This guide covers the methods exclusive to the model query builder. You will learn how to:

- Preload relationships eagerly in one, two, or many levels
- Load relationship aggregates with `withCount` and `withAggregate`
- Filter rows by relationship presence with `has` and `whereHas`
- Compose reusable queries with model scopes
- Shape the returned rows with `pojo`, `sideload`, and `rowTransformer`
- Paginate model queries for API responses and templates

## Overview

The model query builder returned by `Model.query()` extends the [database query builder](../query_builders/select.md) documented in the query builders section. Every method on the database query builder is available here, including `where`, `whereIn`, `orderBy`, `join`, aggregates, locks, CTEs, and the conditional helpers. This guide covers only the methods that are exclusive to the model query builder or behave differently because they are model-aware.

Two things make the model query builder different from the database query builder:

- Every row it returns is a typed model instance, not a plain object.
- It can query relationships, aggregate them, filter by their existence, and hydrate them onto parent rows in a single chain.

```ts
const posts = await Post
  .query()
  .where('is_published', true)
  .preload('author')
  .withCount('comments')
  .orderBy('created_at', 'desc')
```

## Preloading relationships

### preload

Load a relationship and attach it to every returned model instance. Preloading issues one extra query per relationship regardless of how many parents were returned, which avoids N+1 issues.

```ts
const users = await User.query().preload('posts')

for (const user of users) {
  console.log(user.posts.length)
}
```

Pass a callback to constrain the relationship query. The callback receives the related model's query builder, so every filtering and ordering method is available.

```ts
await User.query().preload('posts', (postsQuery) => {
  postsQuery.where('status', 'published').orderBy('published_at', 'desc')
})
```

Preload multiple relationships by chaining the call.

```ts
await User.query().preload('posts').preload('profile').preload('roles')
```

Nested preloads work by calling `preload` again inside the callback. Every relationship at every depth still makes one extra query, not one per parent.

```ts
await User
  .query()
  .preload('posts', (postsQuery) => {
    postsQuery.preload('comments', (commentsQuery) => {
      commentsQuery.preload('author')
    })
  })
```

### preloadOnce

Preload a relationship only if it has not already been preloaded on this query. Useful in shared helpers or scopes where multiple callers may request the same relationship but you want to load it exactly once.

```ts
Post.query().preloadOnce('author')
```

Calling `preload('author')` twice on the same query runs two queries and overwrites the first result. `preloadOnce('author')` guarantees the relationship loads at most once.

## Relationship aggregates

### withCount

Run a correlated subquery that counts a relationship and attach the result to each parent's `$extras`.

```ts
const users = await User.query().withCount('posts')

users.forEach((user) => {
  console.log(user.$extras.posts_count)
})
```

The default alias is `{relationName}_count`. Override it with the callback.

```ts
const user = await User
  .query()
  .withCount('posts', (query) => {
    query.where('status', 'published').as('publishedPostsCount')
  })
  .firstOrFail()

console.log(user.$extras.publishedPostsCount)
```

`withCount` and `preload` are independent. Call both when you need both the full list and the count.

```ts
await User.query().preload('posts').withCount('posts')
```

### withAggregate

Run a relationship subquery with a custom aggregate (`sum`, `min`, `max`, `avg`). Define the alias inside the callback using `.as(...)`.

```ts
const user = await User
  .query()
  .withAggregate('accounts', (query) => {
    query.sum('balance').as('accountsBalance')
  })
  .firstOrFail()

console.log(user.$extras.accountsBalance)
```

The callback must call exactly one aggregate and must set an alias. The aggregate result lands on `$extras` under the alias.

## Filtering by relationships

### has

Filter parent rows by whether a relationship returns any rows. "Users who have at least one post", "products that belong to a category", and so on.

```ts
const authors = await User.query().has('posts')
```

Pass an operator and a count to filter by relationship size.

```ts
const prolificAuthors = await User.query().has('posts', '>=', 5)
```

The family covers the combining and inverting variants:

| Method | Description |
| --- | --- |
| `has` / `andHas` | `WHERE` the relationship has rows |
| `orHas` | `OR WHERE` the relationship has rows |
| `doesntHave` / `andDoesntHave` | `WHERE` the relationship has no rows |
| `orDoesntHave` | `OR WHERE` the relationship has no rows |

### whereHas

Filter by relationship presence with additional constraints on the relationship query. The second argument is a callback that refines the relationship subquery.

```ts
const activeCommenters = await User.query().whereHas('comments', (commentsQuery) => {
  commentsQuery.where('created_at', '>', lastWeek)
})
```

Combine with an operator and count to require a specific number of matching related rows.

```ts
const veteranCommenters = await User.query().whereHas(
  'comments',
  (commentsQuery) => commentsQuery.where('is_approved', true),
  '>',
  10
)
```

Variants mirror the `has` family:

| Method | Description |
| --- | --- |
| `whereHas` / `andWhereHas` | `WHERE` the relationship has matching rows |
| `orWhereHas` | `OR WHERE` the relationship has matching rows |
| `whereDoesntHave` / `andWhereDoesntHave` | `WHERE` the relationship has no matching rows |
| `orWhereDoesntHave` | `OR WHERE` the relationship has no matching rows |

## Query scopes

Query scopes are reusable query fragments defined on the model class. The [query scopes guide](./query_scopes.md) covers how to define them; the query builder applies them through `withScopes` or its alias `apply`.

```ts
import { scope } from '@adonisjs/lucid/orm'
import { TeamsSchema } from '#database/schema'

export default class Team extends TeamsSchema {
  static forUser = scope((query, user: User) => {
    query.whereIn(
      'id',
      db.from('user_teams').select('team_id').where('user_teams.user_id', user.id),
    )
  })
}
```

Apply the scope with `withScopes`. The callback receives a scopes wrapper that exposes every scope defined on the model as a typed method.

```ts
const teams = await Team
  .query()
  .withScopes((scopes) => scopes.forUser(auth.user))
```

`apply(callback)` is an alias for `withScopes(callback)` and reads better when you combine multiple scopes in one chain.

```ts
const teams = await Team
  .query()
  .apply((scopes) => {
    scopes.forUser(auth.user)
    scopes.active()
  })
```

## Transforming results

### pojo

Return plain JavaScript objects instead of model instances. The query becomes a typed equivalent of a `db.from(...)` read, which is useful for read-heavy endpoints where the overhead of hydrating model instances is not justified.

```ts
const posts = await Post.query().pojo()

console.log(posts[0] instanceof Post)  // false
console.log(posts[0].title)             // still typed
```

Lifecycle hooks (`beforeFind`, `afterFind`, `beforeFetch`, `afterFetch`) do not run when the query uses `pojo`, because hooks operate on model instances.

### sideload

Attach arbitrary key-value pairs to every model instance returned by the query. The values land on each instance's `$sideloaded` property and propagate to preloaded relationships.

```ts
const posts = await Post
  .query()
  .sideload({ currentUser: auth.user })
  .preload('comments')

posts.forEach((post) => {
  console.log(post.$sideloaded.currentUser)      // the auth user
  post.comments.forEach((comment) => {
    console.log(comment.$sideloaded.currentUser) // also set
  })
})
```

By default `sideload` replaces the object completely. Pass `true` as the second argument to merge into the existing sideloaded values.

```ts
Post.query().sideload({ a: 1 }).sideload({ b: 2 }, true)
// result: $sideloaded = { a: 1, b: 2 }
```

### rowTransformer

Register a callback that runs for every model instance after loading, before the query resolves. Useful for decorating rows with computed values without going through a hook or a model accessor.

```ts
const users = await User
  .query()
  .preload('subscription')
  .rowTransformer((user) => {
    user.$extras.daysRemaining = user.subscription
      ? user.subscription.expiresAt.diff(DateTime.now(), 'days').days
      : 0
  })
```

The callback receives the model instance and can mutate it in place. Prefer a hook when the transformation should apply to every load; prefer `rowTransformer` when the transformation is specific to the shape of a single query.

## Paginating

`paginate(page, perPage)` runs the query with a `LIMIT` and `OFFSET`, executes a separate `COUNT` query, and returns a paginator. The return value is a `ModelPaginator`: it is an array of model instances plus the same meta properties and methods as the database query builder's `SimplePaginator`.

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import Post from '#models/post'
import PostTransformer from '#transformers/post_transformer'

export default class PostsController {
  async index({ request, inertia }: HttpContext) {
    const page = request.input('page', 1)
    const posts = await Post.query()
      .orderBy('created_at', 'desc')
      .paginate(page, 20)

    return inertia.render('posts/index', {
      posts: PostTransformer.paginate(posts.all(), posts.getMeta()),
    })
  }
}
```

See the [pagination guide](../guides/pagination.md) for the complete paginator reference, URL customization, transformer integration for API and Inertia responses, and performance considerations.

## Hooks fired during queries

The model query builder invokes the following hooks on the model:

| Hook | When it fires |
| --- | --- |
| `beforeFind` / `afterFind` | `first()`, `firstOrFail()`, and the static `find`/`findBy` family that uses them |
| `beforeFetch` / `afterFetch` | When the query resolves to multiple rows via `await` or `.exec()` |
| `beforePaginate` / `afterPaginate` | Around `paginate()`, before and after the pagination result resolves |

Hooks do not fire when `pojo()` is used, since hooks operate on model instances. See the [hooks guide](./hooks.md) for how to define and use them.

## The model property

Every model query builder exposes its originating model class on the `model` property. Useful inside helpers that operate generically on any model.

```ts
const query = User.query()
console.log(query.model === User)  // true
```
