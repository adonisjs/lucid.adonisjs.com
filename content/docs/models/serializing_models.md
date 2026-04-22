---
summary: Serialize Lucid models into JSON responses using AdonisJS transformers, including preload coordination, pagination, $extras aggregates, many-to-many pivots, and sideloaded data.
---

# Serializing models

This guide covers the Lucid-specific patterns for serializing models with AdonisJS transformers. You will learn how to:

- Generate a transformer alongside a Lucid model
- Preload relationships before handing a model to a transformer
- Paginate Lucid queries and serialize the paginator result
- Surface `$extras` populated by `withCount` and `withAggregate`
- Include pivot attributes on many-to-many relationships
- Include model accessors and sideloaded context in the transformer output
- Shape list vs detail responses with variants

## Overview

AdonisJS transformers are the recommended way to serialize Lucid models into JSON responses. They give you explicit control over the output shape, integrate with Inertia and JSON APIs through the same `serialize()` helper, and generate TypeScript types your frontend can consume directly.

This guide focuses on Lucid-specific patterns. The [AdonisJS transformers guide](https://docs.adonisjs.com/guides/frontend/transformers) covers the transformer API itself: creating transformers, `toObject` / `pick`, variants, dependency injection, custom constructor data, `.depth()`, and the generated TypeScript types. Read that guide first if you are new to transformers.

## Generating a transformer alongside the model

When you generate a model with `--transformer`, Lucid creates a matching transformer in `app/transformers` at the same time.

```sh
node ace make:model Post --transformer
// CREATE: app/models/post.ts
// CREATE: app/transformers/post_transformer.ts
```

The generated transformer uses your model's class name, imports it from `#models/...`, and declares the typed resource.

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import Post from '#models/post'

export default class PostTransformer extends BaseTransformer<Post> {
  toObject() {
    return this.pick(this.resource, ['id'])
  }
}
```

From here, add the fields you want in the output and wire it up in a controller. The rest of this guide covers the patterns you will reach for when the transformer needs to work with real Lucid queries.

## Preload before you transform

Transformers do not issue their own queries. They only read from the model instance you pass to `transform`. If the transformer accesses a relationship that was not preloaded, it reads `undefined` on `hasOne` and `belongsTo` relationships (or an empty array on `hasMany` and `manyToMany`) and skips it silently at best, or throws when you forget to guard the access.

The rule is: whatever the transformer reads, the query must have preloaded.

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import Post from '#models/post'
import PostTransformer from '#transformers/post_transformer'

export default class PostsController {
  async index({ serialize }: HttpContext) {
    const posts = await Post.query()
      .preload('author')
      .preload('tags')
      .orderBy('created_at', 'desc')

    return serialize(PostTransformer.transform(posts))
  }
}
```

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import Post from '#models/post'
import UserTransformer from '#transformers/user_transformer'
import TagTransformer from '#transformers/tag_transformer'

export default class PostTransformer extends BaseTransformer<Post> {
  toObject() {
    return {
      ...this.pick(this.resource, ['id', 'title', 'body', 'createdAt']),
      author: UserTransformer.transform(this.resource.author),
      tags: TagTransformer.transform(this.resource.tags),
    }
  }
}
```

Nested preloads follow the same shape: the query preloads a path like `posts.comments.author`, and the transformer at each level hands its relation to the corresponding transformer.

```ts
const users = await User
  .query()
  .preload('posts', (postsQuery) => {
    postsQuery.preload('comments', (commentsQuery) => {
      commentsQuery.preload('author')
    })
  })

return serialize(UserTransformer.transform(users))
```

When the transformer tries to read a relationship that might not be loaded, use `this.whenLoaded(...)` to skip rendering gracefully. This is the canonical pattern for relationships that only some endpoints preload.

```ts
author: UserTransformer.transform(this.whenLoaded(this.resource.author))
```

## Date and time formatting

Every `@column.date` and `@column.dateTime` column is a Luxon `DateTime` instance. `DateTime.toJSON()` emits an ISO 8601 string by default, so including a date column through `pick` produces a standard machine-readable date on the wire.

```ts
return this.pick(this.resource, ['createdAt'])
// { createdAt: "2026-03-15T10:45:00.000Z" }
```

When you want a specific format (date-only, localized, or truncated), format the date explicitly in the transformer.

```ts
return {
  ...this.pick(this.resource, ['id', 'title']),
  publishedOn: this.resource.publishedOn?.toFormat('yyyy-MM-dd'),
  publishedRelative: this.resource.publishedAt?.toRelative(),
}
```

`?.` handles nullable columns. For columns that are guaranteed non-null (primary keys with date types, `autoCreate` timestamps after save), the optional chain is unnecessary.

## Paginating models

`Post.query().paginate(page, perPage)` returns a `ModelPaginator` that exposes the page's rows on `all()` and the pagination metadata on `getMeta()`. Pass both to the transformer's static `paginate` method.

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import Post from '#models/post'
import PostTransformer from '#transformers/post_transformer'

export default class PostsController {
  async index({ request, serialize }: HttpContext) {
    const page = request.input('page', 1)
    const posts = await Post.query()
      .preload('author')
      .orderBy('created_at', 'desc')
      .paginate(page, 20)

    return serialize(
      PostTransformer.paginate(posts.all(), posts.getMeta())
    )
  }
}
```

The response body includes the transformed rows under `data` and the pagination metadata under `metadata`. For Inertia, pass the paginator result directly to `inertia.render` without wrapping in `serialize` (the Inertia adapter handles the resolution).

```ts
return inertia.render('posts/index', {
  posts: PostTransformer.paginate(posts.all(), posts.getMeta()),
})
```

For the full pagination workflow including URL customization, see the [pagination guide](../guides/pagination.md).

## Surfacing `$extras`

Aggregates loaded through `withCount` and `withAggregate` do not become columns on the model. They land on the model instance's `$extras` object, so the transformer needs to read them from there.

```ts
// title: app/controllers/authors_controller.ts
const authors = await User.query()
  .withCount('posts')
  .withAggregate('posts', (query) => {
    query.max('created_at').as('lastPostAt')
  })
  .orderBy('id', 'asc')

return serialize(UserTransformer.transform(authors))
```

```ts
// title: app/transformers/user_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import User from '#models/user'

export default class UserTransformer extends BaseTransformer<User> {
  toObject() {
    return {
      ...this.pick(this.resource, ['id', 'email', 'fullName']),
      postsCount: Number(this.resource.$extras.posts_count ?? 0),
      lastPostAt: this.resource.$extras.lastPostAt ?? null,
    }
  }
}
```

A few things to know about aggregates and `$extras`:

- `withCount` stores the result under `{relationName}_count` (snake_case), so `withCount('posts')` populates `$extras.posts_count`. Override the alias with the callback form (`.as('publishedPostsCount')`) to get a friendlier key.
- Aggregate results come back as strings on some drivers (MySQL and SQLite return strings for integer aggregates; PostgreSQL returns numbers). Coerce with `Number(...)` if the frontend expects a numeric type regardless of the driver.
- `$extras` is untyped. If a field is missing because the query did not request it, reading `$extras.foo` returns `undefined`. Default with `?? 0` (for counts) or `?? null` (for values) so transformers stay robust across endpoints that use different queries.

Joined columns from raw SQL land in `$extras` too.

```ts
await User.query()
  .select('users.*', 'subscriptions.plan as subscription_plan')
  .leftJoin('subscriptions', 'subscriptions.user_id', 'users.id')

// In the transformer:
subscriptionPlan: this.resource.$extras.subscription_plan ?? null
```

## Many-to-many and pivot attributes

When a model comes back through a `manyToMany` relationship, its pivot columns are merged into `$extras` with a `pivot_` prefix. A `User.belongsToMany(Skill)` that pivots on a `user_skills` table with `proficiency` and `last_used_at` columns exposes them as `$extras.pivot_proficiency` and `$extras.pivot_last_used_at` on each loaded `Skill` instance.

Declare the pivot columns on the relationship, preload them from the query side, and read them from `$extras` in the transformer.

```ts
// title: app/models/user.ts
import { manyToMany } from '@adonisjs/lucid/orm'
import type { ManyToMany } from '@adonisjs/lucid/types/relations'
import Skill from '#models/skill'

export default class User extends UsersSchema {
  @manyToMany(() => Skill, {
    pivotTable: 'user_skills',
    pivotColumns: ['proficiency', 'last_used_at'],
  })
  declare skills: ManyToMany<typeof Skill>
}
```

```ts
// title: app/controllers/users_controller.ts
const users = await User.query().preload('skills')
return serialize(UserTransformer.transform(users))
```

```ts
// title: app/transformers/skill_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import Skill from '#models/skill'

export default class SkillTransformer extends BaseTransformer<Skill> {
  toObject() {
    return {
      ...this.pick(this.resource, ['id', 'name']),
      pivot: {
        proficiency: this.resource.$extras.pivot_proficiency,
        lastUsedAt: this.resource.$extras.pivot_last_used_at,
      },
    }
  }
}
```

Grouping pivot data under a `pivot` key in the output is a common convention that keeps it visually separate from the related model's own fields. For more on pivot columns, pivot timestamps, and `pivotQuery` patterns, see the [many-to-many relationships guide](../relationships/many_to_many.md).

## Model accessors and derived properties

TypeScript getters on the model surface as regular readable properties. They are available inside the transformer through `this.resource.<name>` and work with `this.pick(...)`.

```ts
// title: app/models/user.ts
export default class User extends UsersSchema {
  get fullName(): string {
    return `${this.firstName} ${this.lastName}`.trim()
  }

  get initials(): string {
    return `${this.firstName?.[0] ?? ''}${this.lastName?.[0] ?? ''}`.toUpperCase()
  }
}
```

```ts
// title: app/transformers/user_transformer.ts
toObject() {
  return this.pick(this.resource, [
    'id',
    'email',
    'firstName',
    'lastName',
    'fullName',
    'initials',
  ])
}
```

Getters that need async work (fetching a signed URL, calling an external service) cannot be used through `pick`. Perform the async work inside an async `toObject` and spread the picked fields alongside the computed values.

```ts
async toObject() {
  return {
    ...this.pick(this.resource, ['id', 'avatarPath']),
    avatarUrl: await this.resource.buildSignedAvatarUrl(),
  }
}
```

## Sideloaded context

The model query builder's `sideload(value)` attaches arbitrary key-value pairs to every returned model instance under `$sideloaded`. The attached values propagate to preloaded relationships as well, so you can pass request-scoped context (the current user, a tenant ID, a feature flag) through a query tree without modifying every controller downstream.

```ts
// title: app/controllers/posts_controller.ts
const posts = await Post
  .query()
  .preload('author')
  .sideload({ currentUser: auth.user })
```

Read the value from `$sideloaded` in the transformer that needs it. Because the object is shared across every loaded model in the tree, both `Post` and the preloaded `author` see the same `currentUser`.

```ts
// title: app/transformers/post_transformer.ts
toObject() {
  const currentUser = this.resource.$sideloaded.currentUser as User | undefined

  return {
    ...this.pick(this.resource, ['id', 'title', 'body']),
    isOwnPost: currentUser?.id === this.resource.authorId,
  }
}
```

`$sideloaded` is untyped, so cast it to the expected shape in the transformer. If the value may be absent (some endpoints do not call `sideload`), handle the undefined case explicitly.

`$sideloaded` is most useful when the same context is needed across many nested transformers. When the context is only relevant to one transformer, dependency injection of `HttpContext` in the transformer method is usually cleaner.

## List vs detail with variants

Pair your query's preload depth with a transformer variant to produce different shapes for list and detail endpoints. The list endpoint preloads only what the list view needs, and the detail endpoint preloads more and uses a richer variant.

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import Post from '#models/post'
import UserTransformer from '#transformers/user_transformer'
import CommentTransformer from '#transformers/comment_transformer'

export default class PostTransformer extends BaseTransformer<Post> {
  toObject() {
    return {
      ...this.pick(this.resource, ['id', 'title', 'createdAt']),
      author: UserTransformer.transform(this.resource.author),
    }
  }

  async forDetailedView() {
    return {
      ...(await this.toObject()),
      body: this.resource.body,
      comments: CommentTransformer.transform(this.resource.comments),
    }
  }
}
```

```ts
// title: app/controllers/posts_controller.ts
async index({ request, serialize }: HttpContext) {
  const page = request.input('page', 1)
  const posts = await Post
    .query()
    .preload('author')
    .orderBy('created_at', 'desc')
    .paginate(page, 20)

  return serialize(PostTransformer.paginate(posts.all(), posts.getMeta()))
}

async show({ params, serialize }: HttpContext) {
  const post = await Post
    .query()
    .where('id', params.id)
    .preload('author')
    .preload('comments', (q) => q.preload('author'))
    .firstOrFail()

  return serialize(
    PostTransformer.transform(post).useVariant('forDetailedView')
  )
}
```

The detail variant reuses the base shape through `this.toObject()` and layers on fields specific to the detail view. Because the query preloads `comments` only for the detail endpoint, the comments appear only in `forDetailedView`. See the [transformers variants guide](https://docs.adonisjs.com/guides/frontend/transformers#using-variants) for the full variant API including type generation.

## Where to learn more

- The [AdonisJS transformers guide](https://docs.adonisjs.com/guides/frontend/transformers) covers the transformer API foundations: `toObject`, `pick`, `serialize`, variants, dependency injection, custom constructor data, depth control, and the generated TypeScript types that flow through to your frontend.
- The [pagination guide](../guides/pagination.md) covers pagination end to end, including URL customization and API-versus-Inertia response shapes.
- The [many-to-many relationships guide](../relationships/many_to_many.md) covers pivot columns, pivot timestamps, and query-time pivot operations in depth.
