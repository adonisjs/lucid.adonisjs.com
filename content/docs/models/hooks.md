---
summary: Lucid model hooks let you attach behavior to persistence and query lifecycle events, including save, create, update, delete, find, fetch, and paginate.
---

# Hooks

This guide covers Lucid model hooks. You will learn how to:

- Define hooks with decorators on your model classes
- Understand the firing order of every hook
- Write persistence hooks for save, create, update, and delete
- Write query hooks for find, fetch, and paginate
- Register hooks dynamically from application code
- Skip hooks when the operation should not trigger them

## Overview

A hook is a static method on a model that Lucid invokes before or after a specific lifecycle event. Hooks keep model-owned behavior on the model, so actions like password hashing, audit logging, cache invalidation, and soft-delete filtering stay next to the model instead of scattered across controllers and services.

```ts
// title: app/models/user.ts
import hash from '@adonisjs/core/services/hash'
import { beforeSave } from '@adonisjs/lucid/orm'
import { UsersSchema } from '#database/schema'

export default class User extends UsersSchema {
  @beforeSave()
  static async hashPassword(user: User) {
    if (user.$dirty.password) {
      user.password = await hash.make(user.password)
    }
  }
}
```

The `beforeSave` hook runs every time a `User` instance is saved, whether the save translates to an `INSERT` or an `UPDATE`. The `$dirty.password` check ensures the hash only runs when the password actually changed; otherwise the hook would rehash the stored hash on every update.

Every hook can be async. Throwing from a `before` hook cancels the operation and propagates the error to the caller. Hooks run in the order they were registered.

## Available hooks

| Hook | Receives | Fires |
| --- | --- | --- |
| `beforeSave` | Model instance | Before `INSERT` and `UPDATE` |
| `afterSave` | Model instance | After `INSERT` and `UPDATE` |
| `beforeCreate` | Model instance | Before `INSERT` only |
| `afterCreate` | Model instance | After `INSERT` only |
| `beforeUpdate` | Model instance | Before `UPDATE` only |
| `afterUpdate` | Model instance | After `UPDATE` only |
| `beforeDelete` | Model instance | Before `DELETE` |
| `afterDelete` | Model instance | After `DELETE` |
| `beforeFind` | Query builder | Before `first`, `findOrFail`, `find`, `findBy` and related finders |
| `afterFind` | Model instance | After the same set of finders |
| `beforeFetch` | Query builder | Before fetching multiple rows through `exec` or `await` |
| `afterFetch` | Array of model instances | After fetching multiple rows |
| `beforePaginate` | `[countQuery, query]` tuple | Before `paginate` runs |
| `afterPaginate` | `ModelPaginator` instance | After `paginate` returns |

## Writing a hook

Register a hook by decorating a static method on the model class with the matching decorator from `@adonisjs/lucid/orm`. The method receives the model instance (for persistence and `find` hooks) or the query builder (for `beforeFind`, `beforeFetch`, and `beforePaginate`).

```ts
// title: app/models/project.ts
import { afterSave } from '@adonisjs/lucid/orm'
import { ProjectsSchema } from '#database/schema'

export default class Project extends ProjectsSchema {
  @afterSave()
  static async syncToAlgolia(project: Project) {
    const syncService = await app.container.make(AlgoliaSyncService)
    await syncService.syncProject(project)
  }
}
```

You can register multiple hooks of the same type on one model. They run in registration order, which for decorator-registered hooks follows the order the decorators appear in the class body.

## Lifecycle order

When a save runs, both the specific `beforeCreate`/`beforeUpdate` hook and the shared `beforeSave` hook fire. The order is always: the specific `before` hook first, then `beforeSave`, then the database write, then the specific `after` hook, then `afterSave`.

**Creating a new row:**

```
beforeCreate → beforeSave → INSERT → afterCreate → afterSave
```

**Updating an existing row:**

```
beforeUpdate → beforeSave → UPDATE → afterUpdate → afterSave
```

**Deleting a row:**

```
beforeDelete → DELETE → afterDelete
```

If a `before` hook throws, the database operation is not executed and the `after` hooks do not run. The error propagates to the caller, which can let you treat the throw as a validation failure.

## Persistence hooks

### beforeSave

Fires before both `INSERT` and `UPDATE`. Use it for invariants that apply to both code paths, like password hashing and value normalization.

```ts
import hash from '@adonisjs/core/services/hash'
import { beforeSave } from '@adonisjs/lucid/orm'
import { UsersSchema } from '#database/schema'

export default class User extends UsersSchema {
  @beforeSave()
  static async hashPassword(user: User) {
    if (user.$dirty.password) {
      user.password = await hash.make(user.password)
    }
  }
}
```

Check `user.$dirty` before mutating a column, so the hook only runs when the relevant property actually changed.

### afterSave

Fires after both `INSERT` and `UPDATE`. Use it for side effects that follow a successful persist, such as search index updates, cache warm-up, or domain events.

```ts
import { afterSave } from '@adonisjs/lucid/orm'
import { ProjectsSchema } from '#database/schema'

export default class Project extends ProjectsSchema {
  @afterSave()
  static async syncToAlgolia(project: Project) {
    const syncService = await app.container.make(AlgoliaSyncService)
    await syncService.syncProject(project)
  }
}
```

### beforeCreate

Fires before the `INSERT` only. Use it to assign server-generated defaults that exist on the model (not as a column default in the database).

```ts
import { beforeCreate } from '@adonisjs/lucid/orm'
import { UsersSchema } from '#database/schema'

export default class User extends UsersSchema {
  @beforeCreate()
  static assignAvatar(user: User) {
    user.avatarUrl = getRandomAvatar()
  }
}
```

### afterCreate

Fires after the `INSERT` succeeds. Use it for side effects that only make sense on first insert, like sending a welcome email or creating a default set of related records.

```ts
import { afterCreate } from '@adonisjs/lucid/orm'
import { UsersSchema } from '#database/schema'

export default class User extends UsersSchema {
  @afterCreate()
  static async sendWelcomeEmail(user: User) {
    await mail.send((message) => {
      message.to(user.email).subject('Welcome')
    })
  }
}
```

### beforeUpdate

Fires before the `UPDATE`. Use it to enforce invariants that apply to updates only, like preventing changes to immutable fields.

```ts
import { beforeUpdate } from '@adonisjs/lucid/orm'
import { ProjectsSchema } from '#database/schema'

export default class Project extends ProjectsSchema {
  @beforeUpdate()
  static lockTenantId(project: Project) {
    if (project.$dirty.tenantId) {
      throw new Error('tenantId cannot be changed after creation')
    }
  }
}
```

### afterUpdate

Fires after the `UPDATE` succeeds. Use it for side effects that follow a change to an existing row.

### beforeDelete

Fires before the `DELETE`. Use it for validations or cleanup that must happen before the row goes away, such as refusing to delete a record that still has dependents.

```ts
import { beforeDelete } from '@adonisjs/lucid/orm'
import { ProjectsSchema } from '#database/schema'

export default class Project extends ProjectsSchema {
  @beforeDelete()
  static async guardActiveProjects(project: Project) {
    if (project.status === 'active') {
      throw new Error('Active projects cannot be deleted')
    }
  }
}
```

### afterDelete

Fires after the row is deleted. Common uses include removing cached copies, notifying downstream systems, and cleaning up files.

```ts
import { afterDelete } from '@adonisjs/lucid/orm'
import { PostsSchema } from '#database/schema'

export default class Post extends PostsSchema {
  @afterDelete()
  static async removeFromCache(post: Post) {
    await cache.delete(`post-${post.id}`)
  }
}
```

## Query hooks

Query hooks attach behavior to read paths. They fire when the model is loaded through the model query builder, including the static finders that build queries under the hood.

### beforeFind

Fires before any query that resolves to a single row. The hook receives the query builder, so you can attach filters that apply to every find.

Find-style queries include `Model.find`, `Model.findBy`, `Model.first`, `Model.findOrFail`, `Model.firstOrFail`, and any `.first()` / `.firstOrFail()` call on the model query builder.

```ts
import { beforeFind } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import { UsersSchema } from '#database/schema'

export default class User extends UsersSchema {
  @beforeFind()
  static filterDeleted(query: ModelQueryBuilderContract<typeof User>) {
    query.whereNull('deleted_at')
  }
}
```

### afterFind

Fires after a find-style query returns. Receives the model instance. Use it to decorate the row with derived values or to record an access event.

```ts
import { afterFind } from '@adonisjs/lucid/orm'
import { UsersSchema } from '#database/schema'

export default class User extends UsersSchema {
  @afterFind()
  static async trackAccess(user: User) {
    await accessLog.record(user.id)
  }
}
```

### beforeFetch

Fires before any query that resolves to multiple rows (executed with `await` or `.exec()` on the model query builder). Receives the query builder, same as `beforeFind`.

```ts
import { beforeFetch } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import { UsersSchema } from '#database/schema'

export default class User extends UsersSchema {
  @beforeFetch()
  static filterDeleted(query: ModelQueryBuilderContract<typeof User>) {
    query.whereNull('deleted_at')
  }
}
```

Most soft-delete implementations register the same filter on both `beforeFind` and `beforeFetch` so every read path is covered.

### afterFetch

Fires after a multi-row query returns. Receives an array of model instances.

```ts
import { afterFetch } from '@adonisjs/lucid/orm'
import { UsersSchema } from '#database/schema'

export default class User extends UsersSchema {
  @afterFetch()
  static warmCache(users: User[]) {
    for (const user of users) {
      cache.set(`user:${user.id}`, user, '1 hour')
    }
  }
}
```

## Paginate hooks

`paginate` fires both the fetch hooks and the paginate hooks in this order:

```
beforePaginate → beforeFetch → (count + data queries) → afterPaginate → afterFetch
```

### beforePaginate

Receives a tuple of two query builders: the count query (used to compute `total`) and the main query (used to fetch the page). Mutate both to keep counts and results in sync.

```ts
import { beforePaginate } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import { UsersSchema } from '#database/schema'

export default class User extends UsersSchema {
  @beforePaginate()
  static filterDeleted([countQuery, query]: [
    ModelQueryBuilderContract<typeof User>,
    ModelQueryBuilderContract<typeof User>,
  ]) {
    countQuery.whereNull('deleted_at')
    query.whereNull('deleted_at')
  }
}
```

### afterPaginate

Receives the `ModelPaginator` instance that `paginate` will resolve to. Use it for inspection or logging; mutating the paginator in place is unusual.

```ts
import { afterPaginate } from '@adonisjs/lucid/orm'
import type { ModelPaginatorContract } from '@adonisjs/lucid/types/model'
import { UsersSchema } from '#database/schema'

export default class User extends UsersSchema {
  @afterPaginate()
  static logUsage(paginator: ModelPaginatorContract<User>) {
    logger.debug({ count: paginator.all().length, page: paginator.currentPage }, 'users paginated')
  }
}
```

## Hooks and transactions

When a model is saved or deleted inside a transaction, its `after` hooks fire **before** the transaction commits. If the transaction later rolls back, the row never actually ends up in the database, but the hook has already executed. Side effects the hook performed (sending emails, enqueueing background jobs, calling webhooks, invalidating caches) will be stranded against a database state that never happened.

To guarantee a side effect only runs after the transaction commits, check whether the model is bound to a transaction through `$trx` and attach the work to the transaction's `after('commit', ...)` hook when it is. Outside a transaction, run the side effect directly.

```ts
// title: app/models/project.ts
import { afterSave } from '@adonisjs/lucid/orm'
import queue from '@adonisjs/queue/services/queue'
import { ProjectsSchema } from '#database/schema'

export default class Project extends ProjectsSchema {
  @afterSave()
  static async enqueueIndexJob(project: Project) {
    const indexProject = () => queue.dispatch('projects.index', { id: project.id })

    if (project.$trx) {
      project.$trx.after('commit', indexProject)
    } else {
      await indexProject()
    }
  }
}
```

When the save runs outside a transaction, `project.$trx` is `undefined` and the job is dispatched immediately. When the save runs inside a transaction, the dispatch is deferred until the transaction commits and is never triggered if the transaction rolls back. See [transaction hooks](../guides/transactions.md#transaction-hooks) for the full behavior of `trx.after('commit', ...)`, including the silent error handling applied to registered callbacks.

## Registering hooks dynamically

In addition to the decorators, you can register hooks at runtime through `Model.before(event, handler)` and `Model.after(event, handler)`. Use this pattern when hooks need to be registered from a service provider, a plugin, or a test setup rather than declared inline on the model.

```ts
// title: providers/app_provider.ts
import User from '#models/user'
import hash from '@adonisjs/core/services/hash'

export default class AppProvider {
  async boot() {
    User.before('save', async (user) => {
      if (user.$dirty.password) {
        user.password = await hash.make(user.password)
      }
    })
  }
}
```

The event name is the lifecycle name without the `before`/`after` prefix, for example `save`, `create`, `update`, `delete`, `find`, `fetch`, or `paginate`. Dynamic and decorator-registered hooks share the same queue and fire in the order they were added.

## Skipping hooks

Three paths bypass hooks. Use them when the side effects hooks perform are not appropriate for the operation:

- **`*Quietly` variants** (`createQuietly`, `createManyQuietly`, `saveQuietly`, `deleteQuietly`) run the same persistence but skip every hook for that operation. Useful inside seeders, migrations, and backup restores. See the [CRUD operations guide](./crud_operations.md#createquietly-and-createmanyquietly).
- **`pojo()` on the query builder** returns plain JavaScript objects instead of model instances. No `afterFind` or `afterFetch` hook runs, since hooks operate on model instances. See the [model query builder guide](./query_builder.md#pojo).
- **Bulk updates and deletes via the query builder** (`Model.query().update(...)`, `Model.query().delete()`) bypass instance-level hooks entirely, since no model instance is loaded. See [Updating in bulk with the query builder](./crud_operations.md#updating-in-bulk-with-the-query-builder).
