---
summary: Investigate SQL queries at runtime using the db:query event, pretty-printed output, per-query debug, stack tracing, and query plans.
---

# Debugging

This guide covers the techniques you reach for when something about a SQL query is unclear. You will learn how to:

- Subscribe to the `db:query` event and read its payload
- Pretty-print queries during development
- Pipe queries to your application logger with optional slow-query filtering
- Debug a single query without touching connection-level config
- Trace where a query was issued from in application code
- Inspect a query's execution plan
- Forward queries to observability systems

## Overview

Debugging in Lucid centers on the `db:query` event. Every other technique in this guide either emits on that event or listens to it. The mental model is short:

- Lucid emits `db:query` for every executed query when query debugging is enabled.
- The built-in pretty printer, your application logger, and any observability integration are listeners on that event.
- Two flags control whether events fire: a connection-level `debug` flag to enable emission, and a listener subscription to receive the events.

The flags themselves are documented in the [configuration guide](./configuration.md). This guide shows how to use them.

## The `db:query` event

Lucid emits the `db:query` event for every query, migration, and raw SQL statement that runs through the framework. Subscribe to it from `start/events.ts` to receive notifications as queries execute.

```ts
// title: start/events.ts
import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'

emitter.on('db:query', (query) => {
  logger.debug(query)
})
```

The event only fires when both conditions hold: at least one listener is subscribed, and debug output is enabled at the connection or per-query level. Subscribing to `db:query` without also setting `debug: true` on the connection (or using `.debug(true)` on a specific query) produces silence. For a typical development setup, enable both together.

```ts
// title: config/database.ts
import app from '@adonisjs/core/services/app'

const dbConfig = defineConfig({
  prettyPrintDebugQueries: app.inDev,
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: env.get('DATABASE_URL'),
      debug: app.inDev,
    },
  },
})
```

Each event carries a structured payload with the details of the query.

<dl>

<dt>

sql

</dt>

<dd>

The SQL statement as a string, with placeholders for bound values.

</dd>

<dt>

bindings

</dt>

<dd>

Array of values that were bound to the placeholders in `sql`. Log this alongside `sql` to reproduce the query manually.

</dd>

<dt>

method

</dt>

<dd>

Query method as reported by Knex, such as `select`, `insert`, `update`, `del`, or `raw`.

</dd>

<dt>

duration

</dt>

<dd>

How long the query took to execute, expressed as the `[seconds, nanoseconds]` tuple returned by `process.hrtime`. Convert to milliseconds with `seconds * 1000 + nanoseconds / 1e6`.

</dd>

<dt>

connection

</dt>

<dd>

Name of the connection the query ran on. Helpful when your application uses multiple connections.

</dd>

<dt>

model

</dt>

<dd>

Name of the Lucid model class that issued the query, if the query came through a model. Undefined for queries made directly with the `db` service.

</dd>

<dt>

ddl

</dt>

<dd>

`true` for data definition statements (migrations, schema changes). `false` or absent for regular queries.

</dd>

<dt>

inTransaction

</dt>

<dd>

`true` when the query ran inside a transaction client created with `db.transaction()` or `client.transaction()`.

</dd>

</dl>

## Pretty-print queries during development

Lucid ships a pretty printer that formats queries for terminal output, with color, timing, and bindings already interpolated. Enable it by setting `prettyPrintDebugQueries` at the top level of your config.

```ts
// title: config/database.ts
import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  prettyPrintDebugQueries: app.inDev,
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: env.get('DATABASE_URL'),
      debug: app.inDev,
    },
  },
})
```

The flag registers Lucid's built-in pretty printer as a listener on the `db:query` event. Combined with `debug: app.inDev` on the connection, every query executed in development is printed to the terminal.

You can also invoke the formatter programmatically through `db.prettyPrint`, for example inside a custom listener that formats some queries and routes others to a log file.

```ts
// title: start/events.ts
import emitter from '@adonisjs/core/services/emitter'
import db from '@adonisjs/lucid/services/db'

emitter.on('db:query', (query) => {
  if (query.ddl) {
    return
  }
  db.prettyPrint(query)
})
```

## Log queries through your application logger

Subscribe to `db:query` from `start/events.ts` and forward each event to the AdonisJS logger. This is the recommended path for production environments, where terminal pretty-printing is not useful but structured logs are.

```ts
// title: start/events.ts
import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'

emitter.on('db:query', (query) => {
  logger.debug({
    sql: query.sql,
    bindings: query.bindings,
    duration: query.duration,
    connection: query.connection,
  }, 'database query')
})
```

Forwarding every query to the logger can be noisy. A common pattern is to log only queries that exceed a duration threshold, which surfaces slow queries without drowning the logs.

```ts
// title: start/events.ts
import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'

emitter.on('db:query', (query) => {
  const [seconds, nanoseconds] = query.duration ?? [0, 0]
  const ms = seconds * 1000 + nanoseconds / 1e6

  if (ms > 100) {
    logger.warn({ sql: query.sql, bindings: query.bindings, ms }, 'slow query')
  }
})
```

## Debug a single query

When you want to inspect one query without turning on debug at the connection level, call `.debug(true)` on the query builder. The flag overrides the connection setting for that query and triggers a `db:query` event when listeners are attached.

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

In practice, this is most useful when you already have `prettyPrintDebugQueries` or a manual listener enabled in development but have kept the connection-level `debug` flag off to reduce noise. The `.debug(true)` call lets you opt a specific query back into the logging stream.

## Trace where a query came from

When a query fails or behaves unexpectedly, the stack trace usually points into Knex internals rather than the application code that issued the query. The `asyncStackTraces` flag tells Knex to capture the originating call site when the query is built and to attach it to any error thrown during execution.

```ts
// title: config/database.ts
import app from '@adonisjs/core/services/app'

const dbConfig = defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: env.get('DATABASE_URL'),
      asyncStackTraces: app.inDev,
    },
  },
})
```

With the flag enabled, a failing query's stack trace now points at the controller, service, or command that originated the query, which makes tracing much faster. The feature carries a small runtime cost from capturing stacks at query creation time, so enable it in development only.

## Inspect a query's execution plan

Neither Knex nor Lucid expose a `.explain()` method on the query builder. To see a query's execution plan, build the query with the query builder, extract its SQL with `.toSQL()`, then run it through `db.rawQuery` prefixed with `EXPLAIN`.

```ts
// title: app/services/posts_service.ts
import db from '@adonisjs/lucid/services/db'

export default class PostsService {
  async explainPublishedPosts() {
    const query = db
      .from('posts')
      .where('is_published', true)
      .orderBy('created_at', 'desc')
      .limit(10)
      .toSQL()

    const plan = await db.rawQuery(`EXPLAIN ANALYZE ${query.sql}`, query.bindings)
    return plan.rows
  }
}
```

The `.toSQL()` call returns an object of the shape `{ sql, bindings }`. Pass both to `rawQuery` so the prepared statement runs with the same parameters as the original query.

Each dialect exposes a slightly different syntax.

| Dialect | Plan-only | Plan with real timings |
| --- | --- | --- |
| PostgreSQL | `EXPLAIN <sql>` | `EXPLAIN ANALYZE <sql>` |
| MySQL | `EXPLAIN <sql>` | `EXPLAIN ANALYZE <sql>` (MySQL 8.0.18+) |
| SQLite | `EXPLAIN QUERY PLAN <sql>` | not available |

MSSQL uses a different workflow. Plan capture is toggled by session-level commands like `SET SHOWPLAN_XML ON`, which changes what subsequent queries return rather than prefixing a single statement. The `.toSQL()` + prefix approach shown above does not apply. See the SQL Server documentation for the right pattern.

## Forward queries to observability systems

The `db:query` event is the integration point for observability platforms. Hook up an OpenTelemetry span, a Datadog trace, or any other collector inside a listener in `start/events.ts`, using the event payload's `sql`, `duration`, and `connection` fields for dimensions. Apply sampling or a duration threshold inside the listener to keep ingestion volume manageable on busy services.

## Next steps

- [Configuration guide](./configuration.md) for the `debug`, `prettyPrintDebugQueries`, and `asyncStackTraces` flags as reference.
- [Database service guide](./database_service.md#debug-individual-queries) for per-query `.debug(true)` in context.
