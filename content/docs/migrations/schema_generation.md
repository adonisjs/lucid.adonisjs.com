---
summary: How Lucid generates database/schema.ts from your live database, when regeneration runs, the schema:generate command, and the workflow for adopting legacy databases.
---

# Schema generation

This guide covers the mechanics of schema generation. You will learn how to:

- Understand when Lucid regenerates `database/schema.ts` automatically
- Run `schema:generate` manually and when to reach for it
- Adopt an existing database that has no migration history
- Exclude tables and PostgreSQL schemas from generation
- Decide whether to commit the generated file
- Disable generation when it does not fit your workflow

## Overview

Lucid takes a database-first approach: you describe the schema in migrations, and Lucid generates a typed `database/schema.ts` file by introspecting the resulting tables. Your models extend the generated classes and inherit the column types automatically. See [the introduction](../guides/introduction.md#the-database-is-the-source-of-truth) for the philosophy behind this design.

This page focuses on the generation pipeline. For consuming the generated classes from your models — column type mappings, model-level overrides, and customizing types with schema rules — see the [schema classes guide](../models/schema_classes.md).

## When generation runs

Lucid regenerates `database/schema.ts` automatically after every command that changes the database schema:

- `migration:run`
- `migration:rollback`
- `migration:refresh`
- `migration:reset`
- `migration:fresh`

This means models stay in sync with the database without manual intervention. After the migration applies, the schema file reflects the new shape, and your models pick up the changes the next time TypeScript compiles.

Pass `--no-schema-generate` on any of those commands to skip regeneration. Use this when you want to apply a migration without touching the schema file (for example, when you intentionally hand-edit the file or commit a custom version of it).

```sh
node ace migration:run --no-schema-generate
```

For the full flag list on each command, see the [commands reference](../guides/commands.md).

## The generated file

By default, the generated file lives at `database/schema.ts`. Each table in the database becomes a schema class, named by converting the table name to PascalCase and appending `Schema`.

```ts
// title: database/schema.ts (excerpt)
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export class UsersSchema extends BaseModel {
  static table = 'users'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare email: string

  @column()
  declare password: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}

export class PostsSchema extends BaseModel {
  static table = 'posts'

  @column({ isPrimary: true })
  declare id: number

  // ...
}
```

A few conventions worth knowing:

- Table names are pluralized in the database and become PascalCase + `Schema` in the generated file (`users` → `UsersSchema`, `blog_posts` → `BlogPostsSchema`).
- Column names are converted from snake_case to camelCase on the model property (`created_at` → `createdAt`).
- The `static table` property records the original database table name so the model resolves back to the correct table at query time.
- The file is overwritten on every generation, so any manual edits to `database/schema.ts` are lost. Customize through schema rules or model-level overrides instead.

## Running schema:generate manually

The `schema:generate` Ace command regenerates the file on demand. Reach for it in three situations:

1. **Adopting an existing database.** When you point Lucid at a database that already has tables (rather than running migrations), `schema:generate` produces the schema classes you need to start building models.
2. **After manual schema changes.** If a colleague applied a schema change directly via psql, or a teammate ran a migration on a shared dev database, run `schema:generate` to pull the changes into your local schema file.
3. **Recovering a missing schema file.** If `database/schema.ts` is deleted or becomes stale (for example, a Git merge conflict), regenerate it from the current database state.

```sh
node ace schema:generate
```

See the [commands reference](../guides/commands.md#schema-generate) for the full flag list (`--connection`, `--compact-output`).

## Adopting an existing database

Schema generation makes Lucid usable against databases that were not created by Lucid migrations. Follow this workflow when you bring an existing database under Lucid's models.

**1. Configure the database connection.** Set up `config/database.ts` with the connection details for your existing database. See the [configuration guide](../guides/configuration.md) for driver-specific options.

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
    },
  },
})

export default dbConfig
```

**2. Decide which tables you want to model.** Most legacy databases include tables your application should not touch through Lucid: framework migration tables from the previous tooling, audit logs, queue or cache tables, and so on. List those under `schemaGeneration.excludeTables` so they are skipped from the generated file.

```ts
// title: config/database.ts
{
  postgres: {
    client: 'pg',
    connection: env.get('DATABASE_URL'),
    schemaGeneration: {
      excludeTables: [
        'knex_migrations',
        'knex_migrations_lock',
        'pgboss_jobs',
        'audit_log',
      ],
    },
  },
}
```

**3. Generate the schema file.** Run `schema:generate` to introspect the database and write `database/schema.ts`.

```sh
node ace schema:generate
```

Open the generated file and review the classes. Each table you did not exclude appears as a `*Schema` class with column declarations.

**4. Create models for the tables you want to use.** You do not need a model for every table — only the ones your application interacts with. For each table, generate a model that extends the corresponding schema class.

```sh
node ace make:model User
node ace make:model Post
```

```ts
// title: app/models/user.ts
import { UsersSchema } from '#database/schema'

export default class User extends UsersSchema {}
```

**5. Decide how the schema will evolve.** Two paths from here:

- **Continue managing schema outside Lucid.** Keep applying schema changes through your existing tooling (raw SQL, an ORM in another service, a DBA workflow). Run `node ace schema:generate` whenever the schema changes to refresh `database/schema.ts`.
- **Move schema management into Lucid migrations.** Write all future schema changes as Lucid migrations. The first `migration:run` will apply your new migration and regenerate the schema file with the result. The historical schema is unchanged because Lucid does not require an existing migration history to work.

The two paths can also be mixed: hand-write the schema for tables managed elsewhere, write migrations for new tables you add through Lucid.

**6. Handle convention mismatches.** Tables and columns that do not follow Lucid's defaults (snake_case columns, plural table names, single-column primary keys, integer or UUID identifiers) need either schema rules or model-level overrides. See [Customizing types with schema rules](../models/schema_classes.md#customizing-types-with-schema-rules) and [Model-level overrides](../models/schema_classes.md#model-level-overrides) for the patterns.

## Customizing the generated output

The `schemaGeneration` config block accepts a `rulesPaths` array pointing at TypeScript modules that customize how columns and tables are emitted. Rules can override TypeScript types for specific columns, change the inferred primary key, customize naming, and more.

```ts
// title: config/database.ts
{
  schemaGeneration: {
    enabled: true,
    outputPath: 'database/schema.ts',
    rulesPaths: ['database/schema_rules.ts'],
  },
}
```

```ts
// title: database/schema_rules.ts
export default {
  // ... rule definitions
}
```

The rule format and the type-customization patterns are covered in detail in the [schema classes guide](../models/schema_classes.md#customizing-types-with-schema-rules), since the choices are fundamentally about the types your models inherit.

## Excluding tables and schemas

Two config options control which tables Lucid considers during generation.

`excludeTables` skips specific tables by name. Use this for tables your application should not access through Lucid (framework metadata, audit tables maintained elsewhere, queue tables managed by a different tool).

```ts
schemaGeneration: {
  excludeTables: ['knex_migrations', 'knex_migrations_lock', 'pgboss_jobs'],
}
```

`schemas` restricts generation to specific PostgreSQL schemas. Without it, the generator scans every schema the connection has access to.

```ts
schemaGeneration: {
  schemas: ['public', 'app'],
}
```

The full `schemaGeneration` config reference is in the [configuration guide](../guides/configuration.md#schema-generation-config).

## Source control

Commit `database/schema.ts` to your repository. Even though the file is regenerated, treating it as source-controlled has several benefits:

- **IDE IntelliSense without a build step.** Editors pick up the typed schema classes the moment the file is on disk. Without committing, every developer must run `schema:generate` (or apply migrations) before they can write models.
- **Schema changes are reviewable in pull requests.** A migration that adds a column produces a corresponding diff in `database/schema.ts`. Reviewers see the schema impact alongside the migration code, which catches mistakes that migrations alone hide.
- **Deterministic CI.** CI workflows can type-check immediately without first running migrations. Production builds work the same way.
- **Drift detection.** When the committed schema and the regenerated schema disagree, you know that someone changed the database outside the migration pipeline. Add a CI step that runs `schema:generate` and fails if it produces a diff to catch this automatically.

Add `database/schema.ts` to your repository as a regular file. The file's auto-generation header makes it clear that the file should not be edited by hand.

## Disabling generation

Set `schemaGeneration.enabled` to `false` to disable both the automatic regeneration after migrations and the `schema:generate` command. This is rare; reach for it only when you maintain `database/schema.ts` entirely by hand or when your project does not use Lucid models at all.

```ts
schemaGeneration: {
  enabled: false,
}
```

When generation is disabled, schema-related commands report a no-op. Models still work as long as a hand-maintained `database/schema.ts` is in place; without one, your models have no schema classes to extend.
