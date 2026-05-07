---
summary: Use the Lucid db service to create queries, select connections, run raw SQL, start transactions, and manage connection lifecycle.
---

# Database service

This guide covers the `db` service. You will learn how to:

- Create queries against tables and models
- Select connections and read/write modes at runtime
- Run raw SQL safely
- Truncate tables and coordinate with advisory locks
- Manage connection lifecycle in scripts and workers

## Overview

The `db` service is Lucid's entry point for database operations. It is not itself a query builder. Instead, it returns query clients that create the builders documented in the [select](../query_builders/select.md), [insert](../query_builders/insert.md), and [raw](../query_builders/raw.md) query builder guides.

Reach for the `db` service when you want to query tables directly, run raw SQL, start a transaction, select a connection at runtime, or write code that does not go through a model.

## Import the service

Import the service from `@adonisjs/lucid/services/db`.

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class PostsController {
  async index({ response }: HttpContext) {
    const posts = await db.from('posts').select('id', 'title')
    return response.ok(posts)
  }
}
```

## Query entry points

The `db` service exposes four entry points for creating query builders. `from` and `table` are the shortcuts you will use most of the time, and `query` and `insertQuery` are available for cases where you want to set a type parameter or choose a mode without naming a connection.

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class PostsController {
  async index() {
    return db
      .from('posts')
      .select('id', 'title')
      .orderBy('id', 'desc')
  }

  async store({ request, response }: HttpContext) {
    const [post] = await db
      .table('posts')
      .insert({ title: request.input('title') })
      .returning(['id', 'title'])

    return response.created(post)
  }
}
```

Use `db.query()` or `db.insertQuery()` when you want a builder without a table pre-selected. This is useful for typing the result shape explicitly, or for picking the connection mode without going through `db.connection()`.

```ts
// title: app/services/posts_service.ts
import db from '@adonisjs/lucid/services/db'

export default class PostsService {
  async listPublished() {
    return db
      .query<{ id: number; title: string }>({ mode: 'read' })
      .from('posts')
      .where('is_published', true)
      .select('id', 'title')
  }
}
```

## Run raw SQL

Use `db.rawQuery` when the entire SQL statement is raw and should be executed. Bind dynamic values as the second argument instead of interpolating them into the SQL string.

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class PostsController {
  async showByTitle({ params, response }: HttpContext) {
    const result = await db.rawQuery(
      'select * from posts where title = ?',
      [params.title]
    )
    return response.ok(result.rows)
  }
}
```

Use `db.raw` to embed a raw fragment inside another query builder, and `db.ref` when the value is a column reference rather than user-provided data.

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class PostsController {
  async index({ response }: HttpContext) {
    const posts = await db
      .from('posts')
      .select('posts.id', 'posts.title')
      .select(
        db.raw(
          '(select count(*) from comments where comments.post_id = posts.id) as comments_count'
        )
      )
      .orderBy(db.ref('posts.created_at'), 'desc')

    return response.ok(posts)
  }
}
```

:::warning
Never build raw SQL by concatenating user input into the query string, since this can introduce SQL injection vulnerabilities.

Pass user input as bindings, as shown with `rawQuery('... where title = ?', [title])`.
:::

## Start transactions

Use `db.transaction` when several database operations must succeed or fail together. Managed transactions commit when the callback succeeds and rollback when the callback throws.

```ts
// title: app/controllers/users_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class UsersController {
  async store({ request, response }: HttpContext) {
    const user = await db.transaction(async (trx) => {
      const [createdUser] = await trx
        .table('users')
        .insert({ email: request.input('email') })
        .returning(['id', 'email'])

      await trx
        .table('profiles')
        .insert({
          user_id: createdUser.id,
          full_name: request.input('full_name'),
        })

      return createdUser
    })

    return response.created(user)
  }
}
```

See the [transactions guide](./transactions.md) for manual transactions, isolation levels, savepoints, and using transactions with models.

## Select a connection

Call `db.connection` to query a connection other than the default. The returned query client exposes the same entry points as the `db` service itself, so you can chain `.from`, `.table`, `.query`, or `.rawQuery` from there.

```ts
// title: app/controllers/analytics_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class AnalyticsController {
  async signups({ response }: HttpContext) {
    const signups = await db
      .connection('analytics')
      .from('daily_signups')
      .select('date', 'total')
      .orderBy('date', 'desc')

    return response.ok(signups)
  }
}
```

When a connection has read/write replicas configured, pass a `mode` option to pick a specific replica set. Use `read` for queries that can go to read replicas, and `write` for mutations or read-after-write workflows that must hit the primary.

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class PostsController {
  async index() {
    return db
      .connection('postgres', { mode: 'read' })
      .from('posts')
      .where('is_published', true)
  }

  async publish({ params, response }: HttpContext) {
    await db
      .connection('postgres', { mode: 'write' })
      .from('posts')
      .where('id', params.id)
      .update({ is_published: true })

    return response.noContent()
  }
}
```

Omit the options object to get a dual-mode client, which routes reads to the read replicas and writes to the primary automatically.

## Query models dynamically

Most model queries should use `User.query()` or another model's static query method directly. Use `db.modelQuery` when infrastructure code receives a model class dynamically and needs to build a query against it.

```ts
// title: app/services/model_search_service.ts
import db from '@adonisjs/lucid/services/db'
import type { LucidModel } from '@adonisjs/lucid/types/model'

export default class ModelSearchService {
  search(model: LucidModel, term: string) {
    return db
      .modelQuery(model)
      .whereLike('title', `%${term}%`)
      .limit(20)
  }
}
```

For normal application code, prefer `Model.query()`.

## Truncate tables

Every query client exposes `truncate` and `truncateAllTables` helpers. These are most useful in test setup and teardown, or in seed scripts that need to start from a clean state.

```ts
// title: tests/bootstrap.ts
import db from '@adonisjs/lucid/services/db'

export async function resetDatabase() {
  await db.connection().truncateAllTables(['adonis_schema', 'adonis_schema_versions'])
}
```

Pass a table name to `truncate` to truncate a single table. The optional second argument enables cascade truncation on databases that support it.

```ts
await db.connection().truncate('posts')
await db.connection('postgres').truncate('comments', true)
```

## Advisory locks

Advisory locks coordinate work across processes without creating row locks. A common use case is de-duplicating scheduled jobs: only the first process that acquires the lock runs the work.

```ts
// title: app/services/report_scheduler.ts
import db from '@adonisjs/lucid/services/db'

export async function runDailyReport() {
  const client = db.connection()
  const acquired = await client.getAdvisoryLock('daily-report')

  if (!acquired) {
    return
  }

  try {
    // Run the work only once across all processes
  } finally {
    await client.releaseAdvisoryLock('daily-report')
  }
}
```

Advisory locks are supported on PostgreSQL and MySQL. Calling `getAdvisoryLock` on SQLite, MSSQL, Oracle, or Redshift throws an error.

## Manage connections in scripts

Lucid registers every configured connection when the application boots, but it opens the underlying database connection lazily. The first query against a connection creates it, and subsequent queries reuse it through the pool. AdonisJS closes every open connection automatically during application shutdown.

For ordinary HTTP and job workloads you never need to touch connection lifecycle manually. Scripts, workers, and one-off commands are the exception: they own a process that exits when the work completes, so they sometimes need to close connections explicitly.

```ts
// title: commands/reports.ts
import { BaseCommand } from '@adonisjs/core/ace'
import db from '@adonisjs/lucid/services/db'

export default class Reports extends BaseCommand {
  static commandName = 'reports:run'

  async run() {
    try {
      await db.connection('analytics').from('daily_reports').select('*')
    } finally {
      await db.manager.closeAll()
    }
  }
}
```

`db.manager.close(name)` closes a specific connection, and `db.manager.closeAll()` closes every open connection at once. Call `db.manager.isConnected(name)` when a diagnostic command or health check needs to know whether a named connection has been opened yet.

See the [connection manager guide](./connection_manager.md) for the full `db.manager` API, including runtime registration, config patching, and lifecycle events.

:::warning
Do not close connections from ordinary HTTP request handlers. Later code in the same process can try to reuse the connection and fail.

Close connections only from isolated scripts, tests, workers, or application shutdown flows where you own the full lifecycle.
:::

## Debug individual queries

Every query builder created by the `db` service can enable debug output for a single query. This is useful when you want to inspect one query without enabling debug mode at the connection level.

```ts
// title: app/controllers/posts_controller.ts
import db from '@adonisjs/lucid/services/db'

export default class PostsController {
  async index() {
    return db
      .from('posts')
      .where('is_published', true)
      .debug(true)
  }
}
```

Lucid emits the `db:query` event for every executed query. Subscribe to it when you want to log queries or forward them to an observability system.

```ts
// title: start/events.ts
import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'

emitter.on('db:query', (query) => {
  logger.debug(query)
})
```

See the [debugging guide](./debugging.md) for connection-level debug mode and the pretty-printed SQL output.

## Use health checks

Lucid exports two health checks that integrate with the AdonisJS health checks system. `DbCheck` verifies that a connection can execute a simple query, and `DbConnectionCountCheck` reports active connection counts on supported dialects.

Register the checks inside `start/health.ts` alongside the other AdonisJS checks.

```ts
// title: start/health.ts
import db from '@adonisjs/lucid/services/db'
import { DbCheck, DbConnectionCountCheck } from '@adonisjs/lucid/database'
import { HealthChecks, DiskSpaceCheck, MemoryHeapCheck } from '@adonisjs/core/health'

export const healthChecks = new HealthChecks().register([
  new DiskSpaceCheck().cacheFor('1 hour'),
  new MemoryHeapCheck(),
  new DbCheck(db.connection()),
  new DbConnectionCountCheck(db.connection())
    .warnWhenExceeds(20)
    .failWhenExceeds(30),
])
```

See the [AdonisJS health checks guide](https://docs.adonisjs.com/guides/digging-deeper/health-checks) for wiring the registered checks to an endpoint.

## Drop to Knex

Lucid's query builder wraps Knex but does not expose every Knex method. When you need an API that Lucid does not surface (for example Knex's `rowNumber` or `rank` analytic helpers), reach for `db.knexQuery()` or `db.knexRawQuery()` to get the underlying Knex builder directly.

```ts
// title: app/services/leaderboard_service.ts
import db from '@adonisjs/lucid/services/db'

const rankings = await db
  .knexQuery()
  .from('scores')
  .select('user_id', 'game_id', 'points')
  .rowNumber('rank', { column: 'points', order: 'desc' }, 'game_id')
```

The result shape comes from Knex rather than Lucid's typed builder, so you lose Lucid's result typing for that query. Use this escape hatch sparingly and prefer `db.raw` for one-off SQL fragments inside an otherwise Lucid-built query.

## Next steps

- [Select query builder guide](../query_builders/select.md) for select, update, delete, pagination, and conditional query APIs.
- [Insert query builder guide](../query_builders/insert.md) for insert and upsert APIs.
- [Raw query builder guide](../query_builders/raw.md) for raw SQL fragments and bindings.
- [Transactions guide](./transactions.md) for managed transactions, isolation levels, and savepoints.
- [Debugging guide](./debugging.md) for connection-level debug mode and pretty-printed SQL.
- [Connection manager guide](./connection_manager.md) for inspecting, opening, closing, and patching connections through `db.manager`.
