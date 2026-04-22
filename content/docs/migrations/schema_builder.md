---
summary: The schema builder API for creating and altering tables, schemas, views, and other DDL operations inside migration files.
---

# Schema builder

This guide is the reference for the schema builder API exposed inside migration files. You will learn how to:

- Create, alter, rename, and drop tables
- Check whether a table or column exists at runtime
- Create and drop PostgreSQL schemas
- Create and manage views (including materialized views)
- Run raw DDL statements when the builder cannot express what you need

## Overview

The schema builder is the API for issuing DDL statements (CREATE, ALTER, DROP) inside migrations. Access it through `this.schema` on a class extending `BaseSchema`.

```ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'users'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('email').unique().notNullable()
      table.timestamps(true, true)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
```

For column-level configuration (column types, constraints, indexes, foreign keys), see the [table builder reference](./table_builder.md). For the full migration class API including `this.defer`, `this.now()`, and other helpers, see the [migrations introduction](./introduction.md#the-migration-class).

## Tables

### createTable

Create a new table. Pass the table name and a callback that receives the table builder.

```ts
this.schema.createTable('posts', (table) => {
  table.increments('id')
  table.string('title').notNullable()
  table.text('body')
  table.timestamps(true, true)
})
```

### createTableIfNotExists

Create the table only when it does not already exist. Useful when the same migration may run against environments where the table was already created out-of-band.

```ts
this.schema.createTableIfNotExists('posts', (table) => {
  table.increments('id')
  table.string('title').notNullable()
})
```

### createTableLike

Copy the structure of an existing table into a new one. Optionally pass a callback to add columns to the new table.

```ts
this.schema.createTableLike('posts_archive', 'posts')

this.schema.createTableLike('posts_archive', 'posts', (table) => {
  table.timestamp('archived_at')
})
```

Support varies by dialect; PostgreSQL and MySQL implement it natively, while other dialects emulate it.

### alterTable

Alter an existing table. The same callback receives the table builder, but only methods that modify (add, drop, rename, alter columns) take effect.

```ts
this.schema.alterTable('users', (table) => {
  table.string('first_name')
  table.string('last_name')
  table.dropColumn('name')
})
```

`this.schema.table(name, callback)` is an alias for `alterTable`.

### renameTable

Rename a table. Returns a `Promise<void>` rather than the schema builder, so it cannot be chained.

```ts
await this.schema.renameTable('user', 'users')
```

### dropTable

Drop an existing table. Use this in your migration's `down` method to undo a `createTable`.

```ts
this.schema.dropTable('users')
```

### dropTableIfExists

Drop the table only when it exists. Useful for cleanup migrations where the table may already have been removed.

```ts
this.schema.dropTableIfExists('legacy_audit')
```

## Existence checks

The schema builder exposes async helpers that return a boolean for table or column existence. Use them to write conditional migrations that adapt to the current database state.

### hasTable

```ts
async up() {
  const exists = await this.schema.hasTable('legacy_audit')
  if (!exists) {
    return
  }

  this.defer(async (db) => {
    await db.from('legacy_audit').delete()
  })

  this.schema.dropTable('legacy_audit')
}
```

### hasColumn

```ts
async up() {
  const hasOldName = await this.schema.hasColumn('users', 'name')
  if (!hasOldName) {
    return
  }

  this.schema.alterTable('users', (table) => {
    table.renameColumn('name', 'full_name')
  })
}
```

Wrap conditional schema operations in `await`-ed checks like these when the same migration must work across environments with diverging history.

## Schemas

PostgreSQL groups tables into schemas (logical namespaces inside a database). The schema builder exposes helpers for creating and dropping schemas, and for targeting a specific schema with subsequent operations.

### createSchema

Create a schema.

```ts
this.schema.createSchema('analytics')
```

### createSchemaIfNotExists

Create the schema only if it does not exist.

```ts
this.schema.createSchemaIfNotExists('analytics')
```

### dropSchema

Drop a schema. Pass `true` as the second argument to cascade-drop every object inside the schema.

```ts
this.schema.dropSchema('analytics')
this.schema.dropSchema('analytics', true)
```

### dropSchemaIfExists

Drop the schema only if it exists. Accepts the same `cascade` argument.

```ts
this.schema.dropSchemaIfExists('analytics', true)
```

### withSchema

Target a non-default schema for the next DDL operation.

```ts
this.schema
  .withSchema('analytics')
  .createTable('events', (table) => {
    table.increments('id')
    table.string('name').notNullable()
    table.timestamp('occurred_at', { useTz: true })
  })
```

## Views

Views are saved query definitions exposed as virtual tables. The schema builder exposes the standard set of view operations and, on PostgreSQL, the materialized view family.

### createView

Create a view from a callback that receives the view builder. Use the view builder's `as(query)` method to define the underlying query.

```ts
this.schema.createView('active_users', (view) => {
  view.columns(['id', 'email'])
  view.as(this.knex().select('id', 'email').from('users').where('is_active', true))
})
```

### createViewOrReplace

Create or replace an existing view in a single statement. Supported on PostgreSQL and MySQL.

```ts
this.schema.createViewOrReplace('active_users', (view) => {
  view.as(this.knex().select('id', 'email').from('users').where('is_active', true))
})
```

### alterView

Alter an existing view. Note that some dialects do not support altering view definitions in place; in those cases, drop and re-create the view.

```ts
this.schema.alterView('active_users', (view) => {
  view.column('id').rename('user_id')
})
```

`this.schema.view(name, callback)` is an alias for `alterView`.

### renameView

Rename a view. Supported on PostgreSQL.

```ts
this.schema.renameView('active_users', 'enabled_users')
```

### dropView and dropViewIfExists

Drop a view. The `IfExists` variant only drops the view when it is present.

```ts
this.schema.dropView('active_users')
this.schema.dropViewIfExists('active_users')
```

### createMaterializedView

Create a materialized view, which stores the query result on disk and is refreshed on demand. PostgreSQL only.

```ts
this.schema.createMaterializedView('user_stats', (view) => {
  view.columns(['user_id', 'post_count'])
  view.as(
    this.knex()
      .select('user_id', this.raw('count(*) as post_count'))
      .from('posts')
      .groupBy('user_id')
  )
})
```

### refreshMaterializedView

Refresh the data inside a materialized view. Pass `true` for the `concurrently` argument to refresh without blocking concurrent reads (PostgreSQL).

```ts
this.schema.refreshMaterializedView('user_stats')
this.schema.refreshMaterializedView('user_stats', true)
```

### dropMaterializedView and dropMaterializedViewIfExists

Drop a materialized view. The `IfExists` variant only drops it when present.

```ts
this.schema.dropMaterializedView('user_stats')
this.schema.dropMaterializedViewIfExists('user_stats')
```

## Raw SQL

When the builder cannot express the DDL you need (vendor-specific options, custom triggers, extension management), drop down to raw SQL.

```ts
this.schema.raw("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")

this.schema
  .raw("SET sql_mode='TRADITIONAL'")
  .alterTable('users', (table) => {
    table.dropColumn('name')
    table.string('first_name')
    table.string('last_name')
  })
```

The schema builder's `raw` method takes a SQL string only and does not accept bindings. When you need parameterized SQL, use `this.raw(sql, bindings?)` from `BaseSchema` instead, which returns a Knex `Raw` instance you can pass into a column default or other builder methods.

```ts
this.schema.alterTable('users', (table) => {
  table.uuid('uuid').defaultTo(this.raw('gen_random_uuid()'))
})
```

See the [migrations introduction](./introduction.md#the-migration-class) for the full `BaseSchema` API including `this.now()`, `this.knex()`, and `this.defer()`.
