---
summary: Write, run, and roll back database migrations using Lucid's BaseSchema API, including data migrations with this.defer, multi-connection workflows, and programmatic execution.
---

# Schema migrations

This guide covers writing and running migrations. You will learn how to:

- Create a migration and understand its structure
- Use the `BaseSchema` API to evolve your database schema
- Perform data migrations safely with `this.defer`
- Run, roll back, and refresh migrations
- Handle production safety with advisory locks, dry runs, and rollback restrictions
- Manage migrations across multiple database connections
- Execute migrations programmatically from application code

## Overview

Schema migrations are version-controlled scripts that evolve your database schema over time. Each migration is a TypeScript file with `up()` and `down()` methods that apply or revert a schema change. AdonisJS tracks which migrations have run inside the `adonis_schema` table, so each migration runs exactly once per database.

Lucid is migrations-first: you write migrations to evolve the database, run them, and Lucid generates typed schema classes from the resulting tables. Models extend those generated classes. See the [introduction](../guides/introduction.md#the-database-is-the-source-of-truth) for the broader philosophy and the [schema generation guide](./schema_generation.md) for the regenerate-after-migration workflow.

## Creating a migration

Use the `make:migration` command to scaffold a new migration file inside `database/migrations`. The filename is timestamp-prefixed so files run in the order they were created.

```sh
// title: terminal
node ace make:migration users --create=users
// CREATE: database/migrations/1720000000000_create_users_table.ts
```

Pass `--alter=table_name` instead of `--create` when you are altering an existing table. See the [commands reference](../guides/commands.md#make-migration) for the full flag list.

You can also generate a migration alongside a model with `node ace make:model User --migration`.

## The migration class

A migration class extends `BaseSchema` and must implement `up` (apply the change) and `down` (revert the change). The class also exposes helpers for raw SQL, deferred operations, and direct query client access.

```ts
// title: database/migrations/1720000000000_create_users_table.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('email').unique().notNullable()
      table.string('password').notNullable()
      table.timestamp('created_at', { useTz: true })
      table.timestamp('updated_at', { useTz: true })
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
```

The `tableName` property is a convention rather than a feature. Set it once at the top of the class so the same value can be reused in `up`, `down`, and any helper methods.

Inside `up` and `down`, the following members are available on the class:

<dl>

<dt>

this.schema

</dt>

<dd>

The Knex schema builder used to define `createTable`, `alterTable`, `renameTable`, `dropTable`, indexes, and other DDL operations. See the [schema builder reference](./schema_builder.md) and the [table builder reference](./table_builder.md) for the full method set.

</dd>

<dt>

this.now(precision?)

</dt>

<dd>

Returns a raw `CURRENT_TIMESTAMP` expression for use as a column default. Pass an optional precision (number of fractional second digits).

```ts
table.timestamp('created_at').defaultTo(this.now())
```

</dd>

<dt>

this.raw(sql, bindings?)

</dt>

<dd>

Returns a raw SQL fragment for use inside schema operations or column defaults. Accepts the same bindings format as the [raw query builder](../query_builders/raw.md).

```ts
table.uuid('id').defaultTo(this.raw('gen_random_uuid()'))
```

</dd>

<dt>

this.knex()

</dt>

<dd>

Returns the underlying Knex query builder for the migration's connection. Useful for advanced operations the schema builder does not expose.

</dd>

<dt>

this.db

</dt>

<dd>

The `QueryClientContract` for the migration's connection. Use it inside `this.defer` callbacks to read and write data. See [Data migrations](#data-migrations).

</dd>

<dt>

this.dryRun

</dt>

<dd>

`true` when the migration is being executed in dry-run mode. Read this flag inside custom logic that should be skipped during dry runs.

</dd>

<dt>

static disableTransactions

</dt>

<dd>

Set to `true` on the class to skip wrapping this migration in a transaction. Use when the migration includes statements that cannot run inside a transaction (such as PostgreSQL's `CREATE INDEX CONCURRENTLY`).

```ts
export default class extends BaseSchema {
  static disableTransactions = true
  // ...
}
```

</dd>

</dl>

## Common schema operations

The schema builder exposes the operations you reach for most often. The examples below show the shape; for the complete API, see the [schema builder](./schema_builder.md) and [table builder](./table_builder.md) references.

```ts
// Create a table
this.schema.createTable('posts', (table) => {
  table.increments('id')
  table.string('title').notNullable()
  table.timestamps(true, true)
})

// Alter an existing table
this.schema.alterTable('users', (table) => {
  table.string('first_name')
  table.string('last_name')
  table.dropColumn('name')
})

// Rename a table
this.schema.renameTable('user', 'users')

// Drop a table
this.schema.dropTable('users')
```

## Data migrations

Schema migrations sometimes need to move or transform data, not just change structure. Common cases include backfilling a new column from an existing one, splitting a column into two, or copying data between tables before dropping the source.

Data operations belong inside `this.defer(callback)`. Deferred callbacks receive the query client and run only when migrations actually execute, so they are skipped during `--dry-run`. They also run in the order they were registered, interleaved with schema operations.

```ts
// title: database/migrations/1720000010000_split_user_name.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.string('first_name')
      table.string('last_name')
    })

    this.defer(async (db) => {
      const users = await db.from('users').select('id', 'name')
      for (const user of users) {
        const [first, ...rest] = user.name.split(' ')
        await db
          .from('users')
          .where('id', user.id)
          .update({ first_name: first, last_name: rest.join(' ') })
      }
    })

    this.schema.alterTable('users', (table) => {
      table.dropColumn('name')
    })
  }

  async down() {
    this.schema.alterTable('users', (table) => {
      table.string('name')
    })

    this.defer(async (db) => {
      const users = await db.from('users').select('id', 'first_name', 'last_name')
      for (const user of users) {
        await db
          .from('users')
          .where('id', user.id)
          .update({ name: `${user.first_name} ${user.last_name}`.trim() })
      }
    })

    this.schema.alterTable('users', (table) => {
      table.dropColumn('first_name')
      table.dropColumn('last_name')
    })
  }
}
```

The `db` argument inside the callback is the same `QueryClientContract` available as `this.db`. You can use the [database query builder](../query_builders/select.md), [insert query builder](../query_builders/insert.md), or [raw queries](../query_builders/raw.md) inside `defer`.

For large data migrations on production tables, batch your work to keep transactions short and avoid long table locks. Consider running the data migration in a separate migration file from the schema change, so each step can be reviewed and deployed independently.

## Running and rolling back migrations

Lucid ships with Ace commands for every stage of the migration lifecycle. The flags for each command are documented in the [commands reference](../guides/commands.md); this section explains when to reach for which command.

`migration:run` applies every pending migration in order, records each one in the `adonis_schema` table, and regenerates `database/schema.ts` so your models inherit the new column types.

```sh
node ace migration:run
```

`migration:rollback` reverts the most recent batch of migrations by calling each migration's `down` method. Pass `--step=N` to revert a specific number of files, or `--batch=N` to revert to a specific batch number.

```sh
node ace migration:rollback
node ace migration:rollback --step=1
node ace migration:rollback --batch=0   # roll back everything
```

`migration:reset` is shorthand for `migration:rollback --batch=0`.

`migration:refresh` rolls back every migration and runs them again, calling `down` then `up` on each file. Useful in development when you want a clean rebuild while preserving the migration history. Pass `--seed` to also run seeders after the refresh.

`migration:fresh` drops every table in the database and re-runs migrations from scratch. It does not call `down`, so it is faster than `refresh` and works even when some `down` methods are broken. Pass `--seed` to run seeders too.

For projects with long migration histories, replaying every file in CI or on a new contributor's machine becomes a bottleneck. See the [schema dumps guide](./schema_dumps.md) for bootstrapping fresh databases from a SQL snapshot and for squashing old migrations into a single baseline.

`migration:status` lists every migration file and its current state.

```sh
node ace migration:status
```

The output groups migrations by batch and marks each as `completed`, `pending`, or `error`.

### How tracking works

Lucid records every applied migration in the `adonis_schema` table:

| Column | Description |
| --- | --- |
| `name` | Path to the migration file relative to the project root |
| `batch` | Batch number, incremented by one for every `migration:run` invocation |
| `migration_time` | Timestamp when the migration was applied |

The batch number is what `migration:rollback` uses to pick which files to revert. A single `migration:run` invocation produces one batch, regardless of how many files run.

## Production safety

Migrations on production databases are higher-stakes than local development. Lucid offers several mechanisms to make them safer.

### Advisory locks

Before running migrations, Lucid acquires an advisory lock on the database to prevent concurrent migration runs from racing against each other (for example, two CI deployments rolling out at the same time). Advisory locks are supported on PostgreSQL and MySQL.

```
acquired migration lock
```

If you need to skip the lock (for example, when running migrations against a database that does not support advisory locks, or when an earlier crashed run left a stale lock), pass `--disable-locks`.

```sh
node ace migration:run --disable-locks
```

### Disable rollback in production

Set `disableRollbacksInProduction: true` on the connection's `migrations` config to refuse rollback commands when `NODE_ENV=production`. This prevents accidental destructive operations on a production database. See the [configuration guide](../guides/configuration.md#migrations-config) for the full migrations config reference.

```ts
// title: config/database.ts
{
  migrations: {
    disableRollbacksInProduction: true,
  }
}
```

The corollary is that production schema changes should always move forward. When you need to undo a previous migration, write a new migration that reverses it explicitly rather than rolling back. This keeps the migration history aligned across every environment.

### Dry runs

Pass `--dry-run` to `migration:run` or `migration:rollback` to print the SQL without executing it. Use this in code review or before applying a high-risk migration to verify the generated SQL matches your intent.

```sh
node ace migration:run --dry-run
```

Operations defined inside `this.defer` are skipped during a dry run, since they execute their own queries that the dry-run pipeline cannot inspect. Plan around this when reviewing migrations that include data backfills.

### Per-migration transactions

By default, Lucid wraps every migration file in a transaction so partial failures roll back cleanly. Some operations cannot run inside a transaction — PostgreSQL's `CREATE INDEX CONCURRENTLY` is the most common example. Disable transactions for those migrations by setting `static disableTransactions = true` on the class.

```ts
export default class extends BaseSchema {
  static disableTransactions = true

  async up() {
    this.schema.raw('CREATE INDEX CONCURRENTLY posts_title_idx ON posts (title)')
  }
}
```

To disable transactions for every migration globally, set `disableTransactions: true` in the connection's `migrations` config.

## Multiple connections

Applications that use more than one database connection can either keep separate migrations per connection or share migrations across them.

### Separate migrations per connection

Each connection points to its own migration directory. Use this when each database has different tables.

```ts
// title: config/database.ts
{
  users: {
    client: 'pg',
    migrations: {
      paths: ['./database/users/migrations'],
    },
  },
  products: {
    client: 'pg',
    migrations: {
      paths: ['./database/products/migrations'],
    },
  },
}
```

Pass `--connection=name` to scaffold and run migrations against a specific connection.

```sh
node ace make:migration --connection=products
node ace migration:run --connection=products
```

### Shared migrations across connections

When the same schema is replicated across connections (for example, a multi-tenant setup with one database per tenant), share a single migration directory and switch the connection at runtime.

```sh
node ace migration:run --connection=tenant_a
node ace migration:run --connection=tenant_b
```

The migration files run against the selected connection's database, using its own `adonis_schema` table to track state.

## Running migrations programmatically

For tools that need to run migrations from outside the CLI (an admin panel, a setup wizard, a custom deployment script), use the `MigrationRunner` class directly.

```ts
// title: app/controllers/migrations_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import { MigrationRunner } from '@adonisjs/lucid/migration'

export default class MigrationsController {
  async run({ response }: HttpContext) {
    const migrator = new MigrationRunner(db, app, {
      direction: 'up',
      dryRun: false,
    })

    await migrator.run()

    return response.ok({
      status: migrator.status,
      files: migrator.migratedFiles,
      error: migrator.error?.message,
    })
  }
}
```

The runner accepts the following options:

<dl>

<dt>

direction

</dt>

<dd>

`'up'` to apply pending migrations or `'down'` to roll back. Required.

</dd>

<dt>

dryRun

</dt>

<dd>

When `true`, the SQL is collected without executing. The collected queries appear in `migratedFiles[name].queries`.

</dd>

<dt>

connectionName

</dt>

<dd>

Run against a non-default connection.

</dd>

<dt>

disableLocks

</dt>

<dd>

Skip the advisory lock acquired around the migration run.

</dd>

</dl>

After `run()` resolves, inspect the runner's properties to see what happened.

<dl>

<dt>

migrator.status

</dt>

<dd>

One of `'pending'`, `'completed'`, `'error'`, or `'skipped'`. `pending` means `run()` has not been called yet, `completed` means migrations applied successfully, `error` means a migration threw, and `skipped` means there was nothing to do.

</dd>

<dt>

migrator.migratedFiles

</dt>

<dd>

An object keyed by migration file name with each value containing `status` (`'pending'`, `'completed'`, or `'error'`), `batch`, `file` metadata, and `queries` (populated only in dry-run mode).

</dd>

<dt>

migrator.error

</dt>

<dd>

The error thrown by the failing migration, when `status === 'error'`.

</dd>

<dt>

migrator.getList()

</dt>

<dd>

Returns the same list of migrations and statuses that `migration:status` shows. Useful for building a status UI.

</dd>

</dl>

The runner is an `EventEmitter` and emits `migration:start` and `migration:completed` events for each file, which lets you stream progress to a UI.
