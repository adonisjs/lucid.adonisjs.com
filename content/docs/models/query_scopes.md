---
summary: Query scopes let you define reusable query fragments on a model class and apply them to any query through the model query builder.
---

# Query scopes

This guide covers query scopes on Lucid models. You will learn how to:

- Define a reusable query fragment as a scope on a model
- Apply scopes through `withScopes` or `apply`
- Pass arguments to scopes at call time
- Compose scopes from within other scopes
- Reuse scopes inside preload callbacks

## Overview

A query scope is a reusable piece of query logic attached to a model. Scopes keep commonly repeated `where` clauses and joins out of controllers and services and name them once on the model. A few examples of scopes you might define:

- `published` on a `Post` model to add `where published_at <= now()`
- `visibleTo(user)` on a `Project` model to filter by the current user's team
- `active` on a `Subscription` model to check both status and expiry

Scopes are defined as static properties on the model class, wrapped with the `scope()` helper. The query builder exposes them through a typed accessor so every call stays type-safe.

## Defining a scope

Use the `scope()` helper to wrap a callback and assign it to a static property on your model. The callback receives the model's query builder as its first argument and can apply any query builder method.

```ts
// title: app/models/post.ts
import { DateTime } from 'luxon'
import { scope } from '@adonisjs/lucid/orm'
import { PostsSchema } from '#database/schema'

export default class Post extends PostsSchema {
  static published = scope((query) => {
    query.where('publishedOn', '<=', DateTime.utc().toSQLDate())
  })
}
```

The `scope()` helper exists purely for TypeScript. It is a no-op at runtime and adds a type brand that the scopes accessor uses for autocomplete and argument checking. Without `scope()`, any function-valued static property is still callable through the runtime scopes wrapper, but TypeScript will not list it on the typed accessor or check its argument types.

## Applying scopes

Apply scopes through `withScopes(callback)` or its alias `apply(callback)`. The callback receives a scopes wrapper that exposes every scope on the model as a typed method.

```ts
const posts = await Post.query().withScopes((scopes) => scopes.published())
```

`apply` reads better when you combine several scopes in one chain.

```ts
const posts = await Post
  .query()
  .apply((scopes) => {
    scopes.published()
    scopes.popular()
  })
  .orderBy('published_on', 'desc')
```

Both methods return the query builder, so they chain with every other query method.

## Scopes with arguments

Scope callbacks accept additional arguments after the query. Pass them through when applying the scope.

```ts
// title: app/models/project.ts
import User from '#models/user'
import { scope } from '@adonisjs/lucid/orm'
import { ProjectsSchema } from '#database/schema'

export default class Project extends ProjectsSchema {
  static visibleTo = scope((query, user: User) => {
    if (user.isAdmin) {
      return
    }

    query.where('teamId', user.teamId)
  })
}
```

Apply with the required arguments.

```ts
const projects = await Project
  .query()
  .withScopes((scopes) => scopes.visibleTo(auth.user))
```

The scopes wrapper is typed against the scope's signature, so the argument types are enforced at the call site.

## Composing scopes

One scope can call another through the same query builder, which keeps composition transparent. The callback already receives the model's query builder, so `query.withScopes(...)` works inside a scope definition.

Because `scope` is a static property on an arbitrary model class, TypeScript cannot automatically infer which model's query builder it receives. Declare a local `Builder` alias and annotate the callback's query parameter to get proper autocomplete and type checking.

```ts
// title: app/models/post.ts
import { DateTime } from 'luxon'
import { scope } from '@adonisjs/lucid/orm'
import { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import { PostsSchema } from '#database/schema'

type Builder = ModelQueryBuilderContract<typeof Post>

export default class Post extends PostsSchema {
  static notDeleted = scope((query) => {
    query.whereNull('deletedAt')
  })

  static publishedAndLive = scope((query: Builder) => {
    query
      .withScopes((scopes) => scopes.notDeleted())
      .where('publishedOn', '<=', DateTime.utc().toSQLDate())
  })
}
```

When a composed scope also accepts arguments, cast the `query` parameter inside the callback. The scope callback signature ties the `query` type to the rest of the arguments, so an explicit cast on the first line keeps the call site clean.

```ts
export default class Project extends ProjectsSchema {
  static notArchived = scope((query) => {
    query.whereNull('archivedAt')
  })

  static visibleTo = scope((scopeQuery, user: User) => {
    const query = scopeQuery as Builder

    query
      .withScopes((scopes) => scopes.notArchived())
      .where('teamId', user.teamId)
  })
}
```

## Scopes inside preloads

The callback passed to `preload` receives the related model's query builder, which exposes the same `withScopes` and `apply` methods. Reuse scopes to constrain preloaded relationships without duplicating their filter logic.

```ts
const users = await User
  .query()
  .preload('posts', (postsQuery) => {
    postsQuery.withScopes((scopes) => scopes.published())
  })
```

This is how you keep a preload consistent with the filters the rest of the application already uses for the related model.
