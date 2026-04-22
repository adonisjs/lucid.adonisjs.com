---
summary: Reference for every Lucid Ace command, including scaffolding, migrations, database operations, and schema tools.
---

# Commands

This guide is the reference for every Ace command Lucid ships with. Commands fall into four families: `make:*` for scaffolding files, `migration:*` for applying and rolling back schema changes, `db:*` for seeding and clearing data, and `schema:*` for working with the generated `database/schema.ts` file and schema dumps.

Every command accepts the flags documented below alongside AdonisJS's standard command flags (like `--help`).

## make\:migration

Creates a new migration file inside `database/migrations` with a timestamped filename.

```sh
// title: terminal
node ace make:migration posts --create=posts
```

<dl>

<dt>

name (argument)

</dt>

<dd>

Name of the migration file. Lucid prefixes the file with a timestamp automatically.

</dd>

<dt>

--connection, -c &lt;name&gt;

</dt>

<dd>

Select the database connection the migration belongs to. The file is created inside that connection's first configured migration path.

</dd>

<dt>

--folder &lt;path&gt;

</dt>

<dd>

Select the migration directory when the connection has multiple migration paths configured.

</dd>

<dt>

--create &lt;table&gt;

</dt>

<dd>

Scaffold a migration that creates the given table. This is the default action.

</dd>

<dt>

--alter &lt;table&gt;

</dt>

<dd>

Scaffold a migration that alters the given table instead of creating one.

</dd>

<dt>

--contents-from &lt;path&gt;

</dt>

<dd>

Use the contents of the given file as the generated migration source, bypassing the default template.

</dd>

<dt>

--force, -f

</dt>

<dd>

Overwrite the file if it already exists.

</dd>

</dl>

## make\:model

Creates a new Lucid model file inside `app/models`. The generated class extends the schema class for the corresponding table by default.

```sh
// title: terminal
node ace make:model Post
```

<dl>

<dt>

name (argument)

</dt>

<dd>

Name of the model class. Lucid converts it to snake_case for the filename.

</dd>

<dt>

--migration

</dt>

<dd>

Generate a matching migration file alongside the model.

</dd>

<dt>

--controller

</dt>

<dd>

Generate a matching resourceful controller for the model.

</dd>

<dt>

--transformer

</dt>

<dd>

Generate a matching transformer file for the model.

</dd>

<dt>

--factory

</dt>

<dd>

Generate a matching factory file for the model.

</dd>

<dt>

--contents-from &lt;path&gt;

</dt>

<dd>

Use the contents of the given file as the generated model source.

</dd>

<dt>

--force

</dt>

<dd>

Overwrite the file if it already exists.

</dd>

</dl>

## make\:factory

Creates a new model factory inside `database/factories`.

```sh
// title: terminal
node ace make:factory Post
```

<dl>

<dt>

model (argument)

</dt>

<dd>

Name of the model the factory produces. Lucid imports the model into the factory file.

</dd>

<dt>

--contents-from &lt;path&gt;

</dt>

<dd>

Use the contents of the given file as the generated factory source.

</dd>

<dt>

--force, -f

</dt>

<dd>

Overwrite the file if it already exists.

</dd>

</dl>

## make\:seeder

Creates a new seeder file inside `database/seeders`.

```sh
// title: terminal
node ace make:seeder User
```

<dl>

<dt>

name (argument)

</dt>

<dd>

Name of the seeder class. The filename is derived from this name.

</dd>

<dt>

--contents-from &lt;path&gt;

</dt>

<dd>

Use the contents of the given file as the generated seeder source.

</dd>

<dt>

--force, -f

</dt>

<dd>

Overwrite the file if it already exists.

</dd>

</dl>

## migration\:run

Applies every pending migration in order, records each one in the `adonis_schema` table, and regenerates `database/schema.ts` when finished.

```sh
// title: terminal
node ace migration:run
```

```
❯ migrated database/migrations/1720000000000_create_posts_table
❯ migrated database/migrations/1720000000001_create_comments_table

Migrated in 42 ms
```

<dl>

<dt>

--connection, -c &lt;name&gt;

</dt>

<dd>

Run migrations for the given connection instead of the default.

</dd>

<dt>

--force

</dt>

<dd>

Explicitly allow the command to run in production. Migration commands refuse to run in production unless this flag is present.

</dd>

<dt>

--dry-run

</dt>

<dd>

Print the SQL that would run without executing it. Useful for reviewing generated SQL in code review.

</dd>

<dt>

--compact-output

</dt>

<dd>

Emit a single-line summary instead of per-file progress lines.

</dd>

<dt>

--disable-locks

</dt>

<dd>

Skip the advisory lock that serializes concurrent migration runs. Only disable when you are certain no other process is migrating the same database.

</dd>

<dt>

--schema-path &lt;path&gt;

</dt>

<dd>

Load a schema dump file before running pending migrations. Used to bootstrap a fresh database from a schema dump without replaying the entire migration history. See the [schema dumps guide](../migrations/schema_dumps.md#bootstrapping-from-a-dump).

</dd>

<dt>

--no-schema-generate

</dt>

<dd>

Skip regenerating `database/schema.ts` after the migrations apply. Default is to regenerate.

</dd>

</dl>

## migration\:rollback

Reverts the most recent batch of migrations. Pass `--step` to roll back a specific number of files, or `--batch` to roll back to a specific batch number.

```sh
// title: terminal
node ace migration:rollback
node ace migration:rollback --step=2
node ace migration:rollback --batch=0
```

<dl>

<dt>

--connection, -c &lt;name&gt;

</dt>

<dd>

Roll back migrations on the given connection.

</dd>

<dt>

--force

</dt>

<dd>

Explicitly allow the command to run in production.

</dd>

<dt>

--dry-run

</dt>

<dd>

Print the SQL that would run without executing it.

</dd>

<dt>

--batch &lt;number&gt;

</dt>

<dd>

Roll back to the given batch number. Pass `0` to roll back every migration.

</dd>

<dt>

--step &lt;number&gt;

</dt>

<dd>

Roll back the given number of migration files regardless of batch.

</dd>

<dt>

--compact-output

</dt>

<dd>

Emit a single-line summary instead of per-file progress lines.

</dd>

<dt>

--disable-locks

</dt>

<dd>

Skip the advisory lock that serializes concurrent migration runs.

</dd>

<dt>

--no-schema-generate

</dt>

<dd>

Skip regenerating `database/schema.ts` after the rollback. Default is to regenerate.

</dd>

</dl>

## migration\:refresh

Rolls back every migration, then re-runs all migrations from scratch. Optionally runs seeders after the refresh when `--seed` is provided.

```sh
// title: terminal
node ace migration:refresh
node ace migration:refresh --seed
```

<dl>

<dt>

--connection, -c &lt;name&gt;

</dt>

<dd>

Refresh migrations on the given connection.

</dd>

<dt>

--force

</dt>

<dd>

Explicitly allow the command to run in production.

</dd>

<dt>

--dry-run

</dt>

<dd>

Print the SQL that would run without executing it.

</dd>

<dt>

--seed

</dt>

<dd>

Run database seeders after the refresh completes.

</dd>

<dt>

--compact-output

</dt>

<dd>

Emit a single-line summary instead of per-file progress lines.

</dd>

<dt>

--disable-locks

</dt>

<dd>

Skip the advisory lock that serializes concurrent migration runs.

</dd>

<dt>

--no-schema-generate

</dt>

<dd>

Skip regenerating `database/schema.ts` after the refresh. Default is to regenerate.

</dd>

</dl>

## migration\:reset

Rolls back every migration without re-running them. Leaves the database with an empty migration history.

```sh
// title: terminal
node ace migration:reset
```

<dl>

<dt>

--connection, -c &lt;name&gt;

</dt>

<dd>

Reset migrations on the given connection.

</dd>

<dt>

--force

</dt>

<dd>

Explicitly allow the command to run in production.

</dd>

<dt>

--dry-run

</dt>

<dd>

Print the SQL that would run without executing it.

</dd>

<dt>

--compact-output

</dt>

<dd>

Emit a single-line summary instead of per-file progress lines.

</dd>

<dt>

--disable-locks

</dt>

<dd>

Skip the advisory lock that serializes concurrent migration runs.

</dd>

<dt>

--no-schema-generate

</dt>

<dd>

Skip regenerating `database/schema.ts` after reset. Default is to regenerate.

</dd>

</dl>

## migration\:fresh

Drops every table in the database (plus views, types, and domains when flagged) and re-runs all migrations from scratch. Functionally similar to `migration:refresh`, but skips the rollback path in favor of dropping everything directly.

```sh
// title: terminal
node ace migration:fresh
node ace migration:fresh --seed
```

<dl>

<dt>

--connection, -c &lt;name&gt;

</dt>

<dd>

Run on the given connection.

</dd>

<dt>

--force

</dt>

<dd>

Explicitly allow the command to run in production.

</dd>

<dt>

--seed

</dt>

<dd>

Run database seeders after migrations complete.

</dd>

<dt>

--drop-views

</dt>

<dd>

Drop all views before running migrations.

</dd>

<dt>

--drop-types

</dt>

<dd>

Drop all custom PostgreSQL types before running migrations. PostgreSQL only.

</dd>

<dt>

--drop-domains

</dt>

<dd>

Drop all PostgreSQL domains before running migrations. PostgreSQL only.

</dd>

<dt>

--disable-locks

</dt>

<dd>

Skip the advisory lock that serializes concurrent migration runs.

</dd>

<dt>

--schema-path &lt;path&gt;

</dt>

<dd>

Load a schema dump file before dropping and recreating the database. See the [schema dumps guide](../migrations/schema_dumps.md#bootstrapping-from-a-dump).

</dd>

</dl>

## migration\:status

Lists every migration file and its status (pending, completed, or errored), grouped by batch.

```sh
// title: terminal
node ace migration:status
```

```
┌───────────────────────────────────────────────┬───────────┬───────┬─────────┐
│ Name                                          │ Status    │ Batch │ Message │
├───────────────────────────────────────────────┼───────────┼───────┼─────────┤
│ 1720000000000_create_posts_table              │ completed │ 1     │         │
│ 1720000000001_create_comments_table           │ completed │ 1     │         │
│ 1720000000002_add_published_at_to_posts_table │ pending   │       │         │
└───────────────────────────────────────────────┴───────────┴───────┴─────────┘
```

<dl>

<dt>

--connection, -c &lt;name&gt;

</dt>

<dd>

List status for the given connection.

</dd>

</dl>

## db\:seed

Runs every seeder inside `database/seeders`. Pass `--files` to run a specific subset, or `--interactive` to pick seeders interactively.

```sh
// title: terminal
node ace db:seed
node ace db:seed --interactive
node ace db:seed --files=./database/seeders/user_seeder.ts
```

<dl>

<dt>

--connection, -c &lt;name&gt;

</dt>

<dd>

Run seeders against the given connection.

</dd>

<dt>

--interactive, -i

</dt>

<dd>

Select seeders to run interactively instead of running every file.

</dd>

<dt>

--files &lt;paths...&gt;

</dt>

<dd>

Run only the listed seeder files. Pass the flag multiple times or use a comma-separated list.

</dd>

<dt>

--compact-output

</dt>

<dd>

Emit a single-line summary instead of per-seeder progress lines.

</dd>

</dl>

## db\:wipe

Drops every table in the database, along with optionally all views, custom types, and domains. Combine with `migration:run` or use `migration:fresh` when you want to rebuild.

```sh
// title: terminal
node ace db:wipe
```

<dl>

<dt>

--connection, -c &lt;name&gt;

</dt>

<dd>

Target the given connection.

</dd>

<dt>

--drop-views

</dt>

<dd>

Drop all views.

</dd>

<dt>

--drop-types

</dt>

<dd>

Drop all custom PostgreSQL types. PostgreSQL only.

</dd>

<dt>

--drop-domains

</dt>

<dd>

Drop all PostgreSQL domains. PostgreSQL only.

</dd>

<dt>

--force

</dt>

<dd>

Explicitly allow the command to run in production.

</dd>

</dl>

Tables listed in `wipe.ignoreTables` inside your connection config are preserved. See the [configuration guide](./configuration.md#protecting-tables-from-dbwipe).

## db\:truncate

Truncates every table in the database, preserving schema. Useful when you want to reset data between tests or dev runs without dropping tables.

```sh
// title: terminal
node ace db:truncate
```

<dl>

<dt>

--connection, -c &lt;name&gt;

</dt>

<dd>

Target the given connection.

</dd>

<dt>

--force

</dt>

<dd>

Explicitly allow the command to run in production.

</dd>

</dl>

## schema\:dump

Writes the current database schema to a single SQL file, alongside a sidecar JSON manifest. The dump is used by `migration:run --schema-path` and `migration:fresh --schema-path` to bootstrap a database without replaying the full migration history, which is useful for applications with long migration histories. See the [schema dumps guide](../migrations/schema_dumps.md) for the end-to-end workflow.

```sh
// title: terminal
node ace schema:dump
node ace schema:dump --path=./database/schema.sql
```

<dl>

<dt>

--connection, -c &lt;name&gt;

</dt>

<dd>

Dump the schema for the given connection.

</dd>

<dt>

--path &lt;path&gt;

</dt>

<dd>

Write the dump to a custom location. Defaults to `database/schema/{connection}-schema.sql`.

</dd>

<dt>

--prune

</dt>

<dd>

Delete every migration file from the configured migration paths after dumping. Use this when collapsing a long migration history into a single schema dump. See [squashing a long migration history](../migrations/schema_dumps.md#squashing-a-long-migration-history).

</dd>

</dl>

## schema\:generate

Regenerates `database/schema.ts` by introspecting the database. Migration commands run this automatically when they finish, so this command is mainly useful when adopting a legacy database for the first time or after manual schema changes.

```sh
// title: terminal
node ace schema:generate
```

```
❯ Generated database/schema.ts
```

<dl>

<dt>

--connection, -c &lt;name&gt;

</dt>

<dd>

Generate schema classes from the given connection.

</dd>

<dt>

--compact-output

</dt>

<dd>

Emit a single-line summary instead of detailed progress.

</dd>

</dl>
