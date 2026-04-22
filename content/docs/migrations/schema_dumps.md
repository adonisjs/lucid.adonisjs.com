---
summary: Dump the current database schema to a SQL file and bootstrap fresh databases from the dump instead of replaying long migration histories. Includes the squash workflow for collapsing old migrations into a single baseline.
---

# Schema dumps

This guide covers schema dumps. You will learn how to:

- Write the current database schema to a SQL file with `schema:dump`
- Understand the sidecar manifest Lucid writes next to the dump
- Bootstrap a fresh database from a dump with `migration:run --schema-path`
- Squash a long migration history into a single baseline with `--prune`
- Pick when to use schema dumps and when to stick with replaying migrations

## Overview

A schema dump is a single SQL file that recreates the current state of the database. It contains the structural DDL for every table, index, and view, plus the contents of Lucid's migration bookkeeping tables (`adonis_schema` and `adonis_schema_versions`).

Replaying a long migration history takes time. In a fresh CI environment or when a new contributor clones the repo, running 300 migrations in sequence is pure overhead when a single SQL file can reproduce the same end state. A schema dump is that file.

Dumps do not replace migrations. You still write migrations to evolve the schema forward. The dump is a snapshot used to bootstrap a fresh database faster, after which Lucid resumes running any pending migrations created since the snapshot.

## Generating a dump

Run `schema:dump` to write the current schema to disk. Lucid introspects the connection and emits two files: the SQL dump and a sidecar JSON manifest.

```sh
// title: terminal
node ace schema:dump
```

By default the dump lands at `database/schema/{connection}-schema.sql` and the manifest at `database/schema/{connection}-schema.meta.json`. Override the location with `--path`.

```sh
node ace schema:dump --path=./database/snapshots/schema.sql
```

Pass `--connection` to dump a non-default connection.

```sh
node ace schema:dump --connection=tenant_a
```

Commit both files to version control. They describe the schema that matches your migrations at the moment of the dump, and they should evolve together.

## The sidecar manifest

Alongside every SQL dump, Lucid writes a `.meta.json` file. The manifest records which migrations are embedded in the dump, so that the migration runner can distinguish deliberately squashed migrations from genuinely missing files.

```json
// title: database/schema/postgres-schema.meta.json
{
  "version": 1,
  "connection": "postgres",
  "dumpPath": "database/schema/postgres-schema.sql",
  "generatedAt": "2026-04-21T10:15:00.000Z",
  "schemaTableName": "adonis_schema",
  "schemaVersionsTableName": "adonis_schema_versions",
  "squashedMigrationNames": [
    "database/migrations/1700000000000_create_users_table",
    "database/migrations/1700000100000_create_posts_table"
  ]
}
```

Lucid validates the manifest against the current connection before trusting it. A manifest that was generated for a different connection or different schema table names is ignored, so a stale file never masks a real problem.

## Bootstrapping from a dump

`migration:run` loads the schema dump automatically when two conditions hold:

- The target database has no applied migrations yet (the `adonis_schema` table is empty or does not exist).
- A dump file exists at the default path or at the path passed via `--schema-path`.

```sh
// title: terminal
node ace migration:run
```

When both conditions match, Lucid loads the SQL dump in place of replaying the migration history, then runs any pending migrations that postdate the dump. For example, if the dump was generated when 300 migrations existed and 5 new migrations have been added since, a fresh `migration:run` executes the SQL dump once and then runs those 5 files.

If migrations have already been applied, Lucid ignores the dump and runs pending migrations normally. The dump only bootstraps empty databases.

Pass `--schema-path` to load a dump from a custom location.

```sh
node ace migration:run --schema-path=./database/snapshots/schema.sql
```

`migration:fresh --schema-path` applies the same behavior: it drops every table and then uses the dump to rebuild the database, rather than replaying every migration file.

```sh
node ace migration:fresh --schema-path=./database/snapshots/schema.sql
```

## Squashing a long migration history

Once a project accumulates hundreds of migrations, the early files stop earning their keep. They never run again in practice, but they still take disk space, show up in diffs, and slow down CI. The `--prune` flag collapses that history into a single baseline.

```sh
node ace schema:dump --prune
```

`--prune` runs the dump and then deletes every file from the configured migration directories. The migration folder is recreated empty so the structure remains. Going forward:

- Fresh databases bootstrap from the dump directly.
- Existing databases already have every pruned migration recorded in `adonis_schema`; the manifest's `squashedMigrationNames` list tells Lucid those names are intentionally absent, so rollbacks and status checks do not flag them as missing.
- New migrations you write go into the empty directory and run on top of the dump.

Treat pruning as a one-time cleanup operation:

- Commit the dump, the manifest, and the migration deletions in the same commit. The three changes describe a single baseline and must stay in sync.
- Do it when everyone is at the same migration state. If one environment still has pending migrations, apply them first. A rollback past the dump is not possible; the `down` methods have been deleted.
- Avoid pruning right before a release cut. Give the new baseline some time in development before it hits production deployments.

## When to use schema dumps

Reach for a dump when:

- CI spends significant time replaying migrations on every run.
- New contributors wait long enough during initial setup that it becomes friction.
- The migration directory has grown past the point where early files carry real information.
- You operate many short-lived databases (per-branch test databases, ephemeral review environments) and the boot cost is paid repeatedly.

Stick with replaying migrations when:

- The migration history is short enough that replay is not a bottleneck.
- You rely on replaying the history to verify each migration still applies correctly.
- Your deploys roll back to older states regularly and need the `down` methods for recent migrations.

Pruning and dumping do not change production behavior. Production databases already have the old migrations recorded in `adonis_schema`; pruning only removes the files from your repo.

## Multiple connections

Each connection gets its own dump file and manifest. Generate one per connection when your app uses more than one database.

```sh
node ace schema:dump --connection=postgres
node ace schema:dump --connection=analytics
```

The default paths do not collide: `database/schema/postgres-schema.sql` and `database/schema/analytics-schema.sql`. Keep them alongside each connection's migration directory in version control.

## Programmatic use

The Ace command is a thin wrapper around the `SchemaDumper` class. Use the class directly when you need to dump the schema from application code (a deployment pipeline, a custom CLI, a setup wizard).

```ts
// title: scripts/dump_schema.ts
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { SchemaDumper } from '@adonisjs/lucid/migration'

const dumper = new SchemaDumper(db, app, {
  connectionName: 'postgres',
  prune: false,
})

await dumper.run()

if (dumper.error) {
  console.error(dumper.error)
} else {
  console.log(`Schema written to ${dumper.result!.dumpLabel}`)
  console.log(`Manifest written to ${dumper.result!.metaLabel}`)
}

await dumper.close()
```

The constructor accepts the same three options the command exposes: `connectionName`, `outputPath`, and `prune`. After `run()` resolves, inspect `dumper.error` and `dumper.result` to see what happened.
