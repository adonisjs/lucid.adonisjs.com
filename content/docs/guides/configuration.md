---
summary: Complete reference for Lucid's database configuration, including drivers, connection strings, replicas, pooling, migrations, seeders, schema generation, and debug output.
---

# Configuration

This guide is the reference for configuring Lucid. You will learn how to:

- Define the default connection and register named connections
- Configure each supported database driver
- Use connection strings and SSL for hosted databases
- Query multiple databases and use read/write replicas
- Tune connection pooling for production workloads
- Configure migrations, seeders, and schema generation
- Protect tables from `db:wipe` and enable debug output

## Overview

Lucid stores its database configuration inside `config/database.ts`. The file exports the result of `defineConfig`, which describes the default connection and every named connection your application can use.

Connections are registered when the application boots, but Lucid opens them lazily when you execute the first query. This keeps boot time low and lets applications define connections that are only used by background jobs, reports, or specific models. AdonisJS also closes every registered connection automatically during application shutdown, so graceful cleanup is handled for you.

## The config file

A Lucid config has two required top-level properties. `connection` is the name of the default connection, and `connections` is the map of named connection configs.

```ts
// title: config/database.ts
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
```

The top-level config accepts the following options.

<dl>

<dt>

connection

</dt>

<dd>

The name of the default connection. Lucid uses this connection whenever you do not select one explicitly. The value must match one of the keys under `connections`.

</dd>

<dt>

connections

</dt>

<dd>

A map of named connection configs. Each entry describes a `client`, a `connection` object or connection string, and optional shared settings such as `migrations`, `seeders`, `pool`, and `schemaGeneration`.

</dd>

<dt>

prettyPrintDebugQueries

</dt>

<dd>

When set to `true`, Lucid attaches a listener to the `db:query` event that pretty-prints every executed SQL statement to the console. See [Debug output](#debug-output) for the details.

</dd>

</dl>

## Drivers

Each connection must specify a `client` value matching a supported database driver. Lucid installs the required driver package when you run the configure command with `--db`, and you can also install it manually.

| Database | Client | Package |
| --- | --- | --- |
| SQLite | `better-sqlite3` | `better-sqlite3` |
| SQLite | `sqlite3` | `sqlite3` |
| LibSQL | `libsql` | `@libsql/sqlite3` |
| MySQL | `mysql2` | `mysql2` |
| PostgreSQL | `pg` | `pg` |
| MSSQL | `mssql` | `tedious` |

For connections that use a network database (MySQL, PostgreSQL, MSSQL), the `connection` object accepts a common set of fields: `host`, `port`, `user`, `password`, and `database`. Each driver adds its own options on top of these, documented in the sections below.

### SQLite

Use SQLite for local development, tests, or lightweight production workloads that do not require a separate database server. SQLite stores data in a single file on disk.

```ts
// title: config/database.ts
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'sqlite',
  connections: {
    sqlite: {
      client: 'better-sqlite3',
      connection: {
        filename: env.get('DB_DATABASE', 'tmp/db.sqlite3'),
      },
      useNullAsDefault: true,
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
```

The connection object accepts the following fields.

<dl>

<dt>

filename

</dt>

<dd>

Path to the SQLite database file. Lucid creates the file automatically the first time a query runs, as long as the parent directory exists. The AdonisJS starter kits ship with a `tmp/` directory, which is where new projects default to.

</dd>

<dt>

flags

</dt>

<dd>

Driver-specific array of flags. Refer to the driver documentation for `sqlite3` or `better-sqlite3` for supported values.

</dd>

<dt>

mode

</dt>

<dd>

Optional driver mode, such as read-only. Refer to the driver documentation for supported values.

</dd>

</dl>

SQLite does not support read/write replicas. The `replicas` property is not available on SQLite connections.

### LibSQL

LibSQL is a drop-in replacement for SQLite, often used with Turso for edge deployments. The config options are the same as SQLite.

```ts
// title: config/database.ts
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'libsql',
  connections: {
    libsql: {
      client: 'libsql',
      connection: {
        filename: env.get('DB_DATABASE', 'tmp/db.sqlite3'),
      },
      useNullAsDefault: true,
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
```

As with SQLite, LibSQL connections do not support read/write replicas through Lucid's `replicas` property.

### MySQL

Use the `mysql2` client for MySQL, MariaDB, or MySQL-compatible services.

```ts
// title: config/database.ts
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'mysql',
  connections: {
    mysql: {
      client: 'mysql2',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
```

The connection object accepts the common `host`, `port`, `user`, `password`, and `database` fields, plus the following driver-specific options.

<dl>

<dt>

socketPath

</dt>

<dd>

Path to a Unix socket for local MySQL connections. When provided, the driver ignores `host` and `port`.

</dd>

<dt>

charset

</dt>

<dd>

Character set used for the connection. Defaults to `utf8mb4_unicode_ci` in modern MySQL setups.

</dd>

<dt>

timezone

</dt>

<dd>

Timezone the driver uses when reading and writing `DATETIME` and `TIMESTAMP` columns. Set to `'Z'` to force UTC, which is the safest default for most applications.

</dd>

<dt>

ssl

</dt>

<dd>

SSL configuration for connections that require encrypted transport. See [SSL and production notes](#ssl-and-production-notes) for the common shapes.

</dd>

<dt>

dateStrings

</dt>

<dd>

When set to `true`, the driver returns date and datetime columns as strings instead of JavaScript `Date` objects. Useful when Lucid models perform their own date parsing through Luxon.

</dd>

<dt>

decimalNumbers

</dt>

<dd>

When set to `true` (the `mysql2`-specific option), the driver casts `DECIMAL` and `NEWDECIMAL` columns to JavaScript numbers instead of strings. Enable this only when the loss of precision is acceptable.

</dd>

</dl>

### PostgreSQL

Use the `pg` client for PostgreSQL and compatible services.

```ts
// title: config/database.ts
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
```

The connection accepts the standard fields plus the following PostgreSQL-specific options.

<dl>

<dt>

ssl

</dt>

<dd>

SSL configuration for connections that require encrypted transport. Set to `true` for a simple encrypted connection, or pass an object with the Node.js `tls.ConnectionOptions` shape to provide certificates and verification rules. See [SSL and production notes](#ssl-and-production-notes).

</dd>

<dt>

connectionString

</dt>

<dd>

A full PostgreSQL connection URL. When set inside the `connection` object, the driver parses the URL and merges it with other fields. This is an alternative to passing the URL as the top-level `connection` value.

</dd>

</dl>

The PostgreSQL config also exposes two options at the connection level, outside the `connection` object.

<dl>

<dt>

searchPath

</dt>

<dd>

Array of PostgreSQL schemas to set on the connection's `search_path`. Use this when your application stores tables across multiple schemas, for example `['public', 'tenant_1']`.

</dd>

<dt>

returning

</dt>

<dd>

Default value for the `RETURNING` clause added by Knex to insert and update queries. The default is `id`. Override this only if you need a different default column for returning rows.

</dd>

</dl>

### MSSQL

Use the `mssql` client for Microsoft SQL Server and Azure SQL.

```ts
// title: config/database.ts
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'mssql',
  connections: {
    mssql: {
      client: 'mssql',
      connection: {
        server: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
        options: {
          encrypt: true,
        },
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
```

Note that MSSQL uses `server` instead of `host` for the hostname. The connection accepts the following driver-specific options.

<dl>

<dt>

server

</dt>

<dd>

Hostname of the SQL Server instance. Required.

</dd>

<dt>

domain

</dt>

<dd>

Domain name for Windows authentication. Leave unset for standard username and password authentication.

</dd>

<dt>

connectionTimeout

</dt>

<dd>

Milliseconds to wait while establishing a new connection before giving up. Defaults to `15000`.

</dd>

<dt>

requestTimeout

</dt>

<dd>

Milliseconds to wait for a single query to complete before aborting. Defaults to `15000`.

</dd>

<dt>

options.encrypt

</dt>

<dd>

Whether to use TLS for the connection. Azure SQL and many managed SQL Server providers require this to be `true`.

</dd>

<dt>

options.trustServerCertificate

</dt>

<dd>

When set to `true`, the driver skips TLS certificate verification. Use this only for development against self-signed certificates, never in production.

</dd>

<dt>

options.isolationLevel

</dt>

<dd>

Default isolation level for transactions. Supported values: `READ_UNCOMMITTED`, `READ_COMMITTED`, `REPEATABLE_READ`, `SERIALIZABLE`, `SNAPSHOT`.

</dd>

<dt>

options.instanceName

</dt>

<dd>

Named instance of SQL Server to connect to when running multiple instances on the same host.

</dd>

</dl>

## Connection strings

Connection strings are convenient when your hosting provider exposes credentials as a single URL. Pass the URL directly as the `connection` value.

```ts
// title: config/database.ts
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: env.get('DATABASE_URL'),
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
```

```dotenv
// title: .env
DATABASE_URL=postgres://username:password@localhost:5432/database_name
```

:::tip
Keep one source of truth for credentials. If production exposes `DATABASE_URL`, use the connection string in both environments rather than splitting the same value into separate `DB_HOST`, `DB_PORT`, and `DB_USER` variables.
:::

For PostgreSQL, you can also pass the URL inside the connection object using the `connectionString` field, which is useful when you need to merge it with additional options like `ssl`.

```ts
// title: config/database.ts
const dbConfig = defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: {
        connectionString: env.get('DATABASE_URL'),
        ssl: { rejectUnauthorized: false },
      },
    },
  },
})
```

## SSL and production notes

Most hosted databases require TLS for production connections. Configuration differs slightly across drivers.

For **PostgreSQL**, pass an `ssl` object with the Node.js `tls.ConnectionOptions` shape. Providers that use Let's Encrypt-style certificates usually work with the default settings. Self-signed certificates require `rejectUnauthorized: false` or an explicit `ca` chain.

```ts
// title: config/database.ts
connection: {
  host: env.get('DB_HOST'),
  port: env.get('DB_PORT'),
  user: env.get('DB_USER'),
  password: env.get('DB_PASSWORD'),
  database: env.get('DB_DATABASE'),
  ssl: {
    rejectUnauthorized: true,
    ca: env.get('DB_CA_CERT'),
  },
}
```

For **MySQL**, pass an `ssl` object with the same shape, or `{ rejectUnauthorized: false }` to skip verification for providers with untrusted certificates.

```ts
// title: config/database.ts
connection: {
  host: env.get('DB_HOST'),
  user: env.get('DB_USER'),
  password: env.get('DB_PASSWORD'),
  database: env.get('DB_DATABASE'),
  ssl: {
    rejectUnauthorized: true,
  },
}
```

For **MSSQL**, TLS is configured inside `options.encrypt`. Set it to `true` for Azure SQL and most managed providers. When connecting to local development SQL Server instances, you may also need `options.trustServerCertificate: true`.

```ts
// title: config/database.ts
connection: {
  server: env.get('DB_HOST'),
  user: env.get('DB_USER'),
  password: env.get('DB_PASSWORD'),
  database: env.get('DB_DATABASE'),
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
}
```

Two more production-relevant options worth calling out:

- For **PostgreSQL**, set `searchPath` when your application uses non-default schemas. Without it, Lucid (and Knex) resolve unqualified table names against `public` only.
- For **MySQL**, set `timezone: 'Z'` so the driver reads and writes timestamps as UTC regardless of the database server's local timezone.

## Multiple connections

Define multiple named connections when one application needs to query different databases. The top-level `connection` value remains the default.

```ts
// title: config/database.ts
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'primary',
  connections: {
    primary: {
      client: 'pg',
      connection: env.get('PRIMARY_DATABASE_URL'),
      migrations: {
        paths: ['database/migrations'],
      },
    },
    analytics: {
      client: 'pg',
      connection: env.get('ANALYTICS_DATABASE_URL'),
      migrations: {
        paths: ['database/analytics_migrations'],
      },
    },
  },
})

export default dbConfig
```

Use `db.connection('name')` to query a named connection from application code.

```ts
// title: app/services/reports_service.ts
import db from '@adonisjs/lucid/services/db'

export async function getSignupTotals() {
  return db
    .connection('analytics')
    .from('daily_signups')
    .select('date', 'total')
    .orderBy('date', 'desc')
}
```

For models that always live on a non-default connection, set `static connection` on the model so every query and relationship uses the correct database.

```ts
// title: app/models/daily_signup.ts
import { DailySignupsSchema } from '#database/schema'

export default class DailySignup extends DailySignupsSchema {
  static connection = 'analytics'
}
```

Each connection has its own migration directory as shown in the `migrations.paths` example above. Lucid's migration commands accept a `--connection` flag so you can target a specific connection. See the [migrations guide](../migrations/introduction.md) for more.

## Read/write replicas

Read/write replicas let you send read queries to one or more read nodes and write queries to a write node. Lucid picks read nodes in round-robin order, but it does not replicate data for you. Database replication must be configured outside Lucid.

```ts
// title: config/database.ts
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: {
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
      },
      replicas: {
        read: {
          connection: [
            { host: env.get('DB_READ_HOST_1'), port: env.get('DB_PORT') },
            { host: env.get('DB_READ_HOST_2'), port: env.get('DB_PORT') },
          ],
        },
        write: {
          connection: {
            host: env.get('DB_WRITE_HOST'),
            port: env.get('DB_PORT'),
          },
        },
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
```

The `replicas` property is available on MySQL, PostgreSQL, and MSSQL connections. SQLite and LibSQL do not support replicas.

Each replica block accepts the same connection shape as the main connection, plus its own optional `pool` block so that read and write pools can be tuned separately.

Select a read or write client explicitly when a workflow needs a specific mode.

```ts
// title: app/services/posts_service.ts
import db from '@adonisjs/lucid/services/db'

export async function listPublishedPosts() {
  return db
    .connection('postgres', { mode: 'read' })
    .from('posts')
    .where('is_published', true)
}

export async function publishPost(id: number) {
  return db
    .connection('postgres', { mode: 'write' })
    .from('posts')
    .where('id', id)
    .update({ is_published: true })
}
```

:::warning
Replica lag can make a newly written row unavailable on a read replica for a short time.

For workflows that read a row immediately after writing it, select the write connection so the query runs against the up-to-date primary.
:::

## Connection pooling

Connection pooling keeps a limited set of open database connections and reuses them across queries. A larger pool is not automatically better: too many concurrent database connections can reduce database performance and starve other applications sharing the same database.

```ts
// title: config/database.ts
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: env.get('DATABASE_URL'),
      pool: {
        min: 2,
        max: 10,
        acquireTimeoutMillis: 60_000,
        afterCreate: (conn, done) => {
          conn.query(`SET timezone='UTC';`, (err: Error) => done(err, conn))
        },
      },
    },
  },
})

export default dbConfig
```

Set `max` based on the database server capacity and the number of application processes. If you run eight Node.js processes and each process has `max: 10`, the application can open up to eighty database connections.

The `pool` block accepts the following options.

<dl>

<dt>

min

</dt>

<dd>

Minimum number of connections kept open in the pool. Defaults to `2`.

</dd>

<dt>

max

</dt>

<dd>

Maximum number of connections the pool will open before queuing new requests. Defaults to `10`.

</dd>

<dt>

acquireTimeoutMillis

</dt>

<dd>

Milliseconds to wait for a connection from the pool before throwing a timeout error. Defaults to `60000`.

</dd>

<dt>

createTimeoutMillis

</dt>

<dd>

Milliseconds to wait while creating a new connection before treating the attempt as failed. Defaults to `30000`.

</dd>

<dt>

idleTimeoutMillis

</dt>

<dd>

Milliseconds an idle connection can sit in the pool before being closed. Defaults to `30000`.

</dd>

<dt>

createRetryIntervalMillis

</dt>

<dd>

Milliseconds to wait between failed attempts to create a new connection. Defaults to `200`.

</dd>

<dt>

reapIntervalMillis

</dt>

<dd>

How often the pool scans for idle connections that are past their `idleTimeoutMillis`. Defaults to `1000`.

</dd>

<dt>

propagateCreateError

</dt>

<dd>

When set to `true`, failed connection creation errors are thrown to the caller that triggered the creation. When `false` (the default), errors are swallowed and the pool keeps retrying.

</dd>

<dt>

afterCreate

</dt>

<dd>

Callback invoked after each new connection is created. Useful for running per-connection setup such as `SET timezone`, `SET search_path`, or `PRAGMA` statements. The callback receives the raw driver connection and a `done` callback that must be called to signal completion.

</dd>

<dt>

log

</dt>

<dd>

Custom logger callback. Called with informational messages from the underlying pool library.

</dd>

<dt>

validate

</dt>

<dd>

Custom validator callback invoked when a connection is checked out of the pool. Returning `false` causes the connection to be destroyed and replaced.

</dd>

</dl>

## Shared connection options

The options in this section apply to every driver and sit alongside `client`, `connection`, and `pool` on a connection.

<dl>

<dt>

useNullAsDefault

</dt>

<dd>

When `true`, Knex uses `NULL` for missing values during inserts rather than the database's default. Required for SQLite to avoid warnings when inserting rows without every column set, and harmless to leave on elsewhere.

</dd>

<dt>

asyncStackTraces

</dt>

<dd>

When `true`, Knex captures the originating call site for every query and includes it in errors. This makes tracing a failing query back to its source much easier during development. The feature has a small runtime cost, so enable it only in development environments.

```ts
// title: config/database.ts
{
  client: 'pg',
  connection: env.get('DATABASE_URL'),
  asyncStackTraces: app.inDev,
}
```

</dd>

<dt>

debug

</dt>

<dd>

When `true`, Knex's internal query logging is routed through the AdonisJS logger at debug level, so executed queries appear in your log output alongside the rest of the application. For richer information such as bindings, duration, and connection name, subscribe to the `db:query` event instead. See [Debug output](#debug-output).

</dd>

</dl>

## Migrations config

Every connection has its own `migrations` block. Lucid's migration commands read this block to discover migration files, apply them, and track state.

```ts
// title: config/database.ts
{
  client: 'pg',
  connection: env.get('DATABASE_URL'),
  migrations: {
    naturalSort: true,
    paths: ['database/migrations'],
    tableName: 'adonis_schema',
    disableTransactions: false,
    disableRollbacksInProduction: true,
  },
}
```

<dl>

<dt>

paths

</dt>

<dd>

Array of directories to scan for migration files. Every `.ts` or `.js` file found in these directories is loaded and executed in sorted order. Defaults to `['database/migrations']`.

</dd>

<dt>

naturalSort

</dt>

<dd>

When `true`, migration files are sorted using natural sort order (so `10_...` comes after `2_...`). Use this for timestamp-prefixed filenames. Defaults to `false`.

</dd>

<dt>

tableName

</dt>

<dd>

Name of the table Lucid uses to track which migrations have run. Defaults to `adonis_schema`. Change this only when integrating with an existing database that already uses a different tracking table.

</dd>

<dt>

disableTransactions

</dt>

<dd>

When `true`, Lucid skips wrapping each migration file in a transaction. By default, every migration runs inside its own transaction so partial failures roll back cleanly. Disable this only when a migration uses statements that cannot run inside a transaction, such as certain PostgreSQL DDL operations.

</dd>

<dt>

disableRollbacksInProduction

</dt>

<dd>

When `true`, the `migration:rollback`, `migration:reset`, and `migration:refresh` commands refuse to run in production. Because rollback actions are usually destructive (dropping tables, removing columns), disabling them in production prevents accidental data loss.

</dd>

</dl>

## Seeders config

Every connection also accepts a `seeders` block for the `db:seed` command.

```ts
// title: config/database.ts
{
  client: 'pg',
  connection: env.get('DATABASE_URL'),
  seeders: {
    paths: ['database/seeders'],
    naturalSort: true,
  },
}
```

<dl>

<dt>

paths

</dt>

<dd>

Array of directories to scan for seeder files. Defaults to `['database/seeders']`.

</dd>

<dt>

naturalSort

</dt>

<dd>

When `true`, seeder files are sorted using natural sort order. Defaults to `false`.

</dd>

</dl>

## Schema generation config

Lucid regenerates `database/schema.ts` automatically after every migration run. The `schemaGeneration` block controls this behavior.

```ts
// title: config/database.ts
{
  client: 'pg',
  connection: env.get('DATABASE_URL'),
  schemaGeneration: {
    enabled: true,
    outputPath: 'database/schema.ts',
    excludeTables: ['knex_migrations', 'adonis_schema_versions'],
    rulesPaths: ['database/schema_rules.ts'],
  },
}
```

<dl>

<dt>

enabled

</dt>

<dd>

When `false`, Lucid skips both the `schema:generate` command and the automatic regeneration that runs after migrations. Use this when you want to commit `database/schema.ts` manually instead of regenerating it on every migration. Defaults to `true`.

</dd>

<dt>

outputPath

</dt>

<dd>

Path where the generated schema file is written. Defaults to `database/schema.ts`.

</dd>

<dt>

excludeTables

</dt>

<dd>

Array of table names that Lucid should skip when generating schema classes. Useful for third-party tables that your application does not query through Lucid models.

</dd>

<dt>

rulesPaths

</dt>

<dd>

Array of paths to schema rules files. These files can override type mappings, column names, and other generator behavior on a per-table or per-column basis. See the [schema classes guide](../models/schema_classes.md) for the rules reference.

</dd>

</dl>

## Protecting tables from db:wipe

The `db:wipe` command drops every table in the database. For workflows that mix Lucid-managed tables with tables maintained by other tools, such as PostGIS or a message queue, set `wipe.ignoreTables` to keep those tables intact.

```ts
// title: config/database.ts
{
  client: 'pg',
  connection: env.get('DATABASE_URL'),
  wipe: {
    ignoreTables: ['spatial_ref_sys', 'pgboss_jobs'],
  },
}
```

PostgreSQL connections already exclude `spatial_ref_sys` from wipe operations by default. Add additional tables here as your setup requires.

## Debug output

Lucid emits a `db:query` event for every executed query. Subscribing to this event is the recommended way to log, profile, or inspect SQL in any environment.

```ts
// title: start/events.ts
import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'

emitter.on('db:query', (query) => {
  logger.debug({ sql: query.sql, bindings: query.bindings, duration: query.duration })
})
```

For local development, Lucid ships with a built-in pretty printer. Enable it by setting `prettyPrintDebugQueries` at the top level of your config.

```ts
// title: config/database.ts
import app from '@adonisjs/core/services/app'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'postgres',
  prettyPrintDebugQueries: app.inDev,
  connections: {
    postgres: {
      client: 'pg',
      connection: env.get('DATABASE_URL'),
    },
  },
})
```

When enabled, every query is printed to the terminal with color, timing, and bindings already interpolated for readability.

A third option is the connection-level `debug: true` flag, which routes Knex's built-in query logging through the AdonisJS logger at debug level. Lucid also emits a one-time notice when this path is used, recommending the `db:query` event for richer logging. The flag is still useful when you want query output to flow through your existing logger pipeline without writing a custom event listener.

## Next steps

- [Database service guide](./database_service.md) for the `db` service entry points, runtime connection selection, and manager APIs.
- [Migrations guide](../migrations/introduction.md) for migration file structure, commands, and multi-connection workflows.
- [Transactions guide](./transactions.md) for isolation levels, managed and manual transaction APIs, and cross-model transactions.
