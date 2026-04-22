---
summary: The table builder API for defining columns, indexes, constraints, and foreign keys inside createTable and alterTable callbacks.
---

# Table builder

This guide is the reference for the table builder API used inside `createTable` and `alterTable` callbacks. You will learn how to:

- Add columns of every supported type
- Apply column modifiers like `notNullable`, `defaultTo`, `unsigned`, and indexes
- Define foreign keys, with cascade rules and deferrable constraints
- Add check constraints for value validation at the database layer
- Create composite indexes and constraints at the table level
- Alter, drop, and rename columns
- Apply table-level options like engine and charset

## Overview

The table builder is the API for defining column-level and table-level structure inside a `createTable` or `alterTable` callback on the schema builder.

```ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('posts', (table) => {
      table.increments('id')
      table.string('title').notNullable()
      table.text('body')
      table.integer('user_id').unsigned().references('users.id').onDelete('CASCADE')
      table.timestamps(true, true)
    })
  }
}
```

For the operations on the schema itself (`createTable`, `alterTable`, `dropTable`, etc.), see the [schema builder reference](./schema_builder.md). For migration-class concerns like `this.defer`, `this.now()`, and transaction control, see the [migrations introduction](./introduction.md).

## Column types

### increments

Auto-incrementing integer column. Marked as the primary key by default.

```ts
table.increments('id')
table.increments('id', { primaryKey: false }) // skip auto primary key
```

PostgreSQL uses `serial`; MySQL uses `int unsigned auto_increment`; Redshift uses `integer identity (1,1)`.

### bigIncrements

Auto-incrementing `bigint` column. Marked as the primary key by default.

```ts
table.bigIncrements('id')
```

### integer

Standard integer column.

```ts
table.integer('view_count')
```

### tinyint, smallint, mediumint, bigInteger

Smaller and larger integer types. `bigInteger` is `bigint` on PostgreSQL and MySQL; on dialects without a native bigint it falls back to a regular integer. `bigint` is an alias for `bigInteger`.

```ts
table.tinyint('flag_byte')
table.smallint('priority')
table.mediumint('view_bucket')   // MySQL-only
table.bigInteger('snowflake_id')
```

Bigint values are returned as strings in query results to avoid JavaScript precision loss.

### float

Floating-point column with optional precision (default 8) and scale (default 2).

```ts
table.float('rating')
table.float('price', 8, 2)
```

### double

Double-precision floating-point column. Same precision and scale arguments as `float`.

```ts
table.double('balance', 14, 4)
```

### decimal

Fixed-precision decimal column. Pass `null` as precision to allow arbitrary precision (PostgreSQL, SQLite, Oracle).

```ts
table.decimal('price')
table.decimal('price', 8, 2)
table.decimal('amount', null)   // arbitrary precision
```

### boolean

Boolean column. Many dialects represent booleans as `0`/`1` and return them as such.

```ts
table.boolean('is_published')
```

### string

Variable-length string column with optional length (defaults to 255).

```ts
table.string('title')
table.string('title', 100)
```

### text

Long-form text column. Pass `'mediumtext'` or `'longtext'` as the second argument on MySQL; ignored on other dialects.

```ts
table.text('body')
table.text('body', 'longtext')
```

### date

Date column (no time component).

```ts
table.date('dob')
```

### time

Time column (no date). MySQL accepts a precision option.

```ts
table.time('starts_at')
table.time('starts_at', { precision: 6 })
```

### dateTime

DateTime column with optional timezone and precision. `dateTime` and `datetime` are aliases.

```ts
table.dateTime('starts_at', { useTz: true })
table.dateTime('starts_at', { precision: 6 }).defaultTo(this.now(6))
```

`useTz: true` produces `timestamptz` on PostgreSQL and `DATETIME2` on MSSQL.

### timestamp

Timestamp column. Same options object as `dateTime`.

```ts
table.timestamp('created_at')
table.timestamp('created_at', { useTz: true })
table.timestamp('created_at', { precision: 6 })
```

### timestamps

Convenience method that adds `created_at` and `updated_at` columns. The signature is `timestamps(useTimestamps, defaultToNow)`.

```ts
table.timestamps()                // DATETIME columns, no defaults
table.timestamps(true)            // TIMESTAMP columns, no defaults
table.timestamps(true, true)      // TIMESTAMP columns, default CURRENT_TIMESTAMP
```

:::tip
For applications that need indexes, custom precision, or timezone-aware columns, prefer two `table.timestamp(...)` calls over `timestamps`. The `timestamps` shortcut returns void, so you cannot chain modifiers on the columns it creates.
:::

### binary

Binary blob column with an optional length argument (MySQL only).

```ts
table.binary('document')
table.binary('document', 1024)
```

### uuid

UUID column. Uses the native `uuid` type on PostgreSQL and `char(36)` elsewhere.

```ts
table.uuid('id').primary().defaultTo(this.raw('gen_random_uuid()'))
```

On older PostgreSQL versions, install the `uuid-ossp` extension in a separate migration before using `uuid` columns:

```ts
this.schema.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
```

### json

JSON column. Uses the native `json` type on PostgreSQL, MySQL, and SQLite, and falls back to a text column on dialects without JSON support.

```ts
table.json('settings')
```

### jsonb

JSON column stored in a binary representation that supports indexed access. PostgreSQL only; falls back to `json` elsewhere.

```ts
table.jsonb('preferences')
```

### enum / enu

Enumerated column. Pass the column name, the array of allowed values, and an options object.

```ts
table.enu('status', ['draft', 'published', 'archived'])
```

PostgreSQL supports a native enum type when you opt in with `useNative` and provide a unique `enumName`. Set `existingType: true` when the type already exists in the database.

```ts
table.enu('status', ['draft', 'published', 'archived'], {
  useNative: true,
  enumName: 'post_status',
  existingType: false,
  schemaName: 'public',
})
```

When dropping a table that uses a native enum type, drop the type as well to avoid leaving an orphan:

```ts
this.schema.raw('DROP TYPE IF EXISTS "post_status"')
this.schema.dropTable('posts')
```

`enu` is the older name; `enum` is an alias added because `enum` is a reserved keyword in some build setups.

### geometry, geography, point

Spatial columns. Available on PostgreSQL (with PostGIS), MySQL, and other dialects with spatial support.

```ts
table.geometry('shape')
table.geography('coverage_area')
table.point('location')
```

### specificType

Define a column with a raw type string when the builder does not expose the type natively.

```ts
table.specificType('mac_address', 'macaddr')
table.specificType('tags', 'text[]')   // PostgreSQL array
```

## Column modifiers

The methods below are chainable on the result of any column-type method. They modify the column being created (or altered).

### defaultTo

Set a default value for inserts.

```ts
table.boolean('is_published').defaultTo(false)
table.timestamp('created_at').defaultTo(this.now())
table.uuid('id').defaultTo(this.raw('gen_random_uuid()'))
```

On MSSQL, pass a `constraintName` option to control the generated default constraint's name:

```ts
table.boolean('is_published').defaultTo(false, { constraintName: 'df_posts_is_published' })
```

### notNullable and nullable

Mark the column as `NOT NULL` or `NULL`.

```ts
table.string('email').notNullable()
table.text('bio').nullable()
```

When **altering** an existing column, prefer `setNullable` and `dropNullable` (covered below) so the constraint change is explicit.

### unsigned

Mark a numeric column as unsigned. Has no effect on PostgreSQL, which does not support unsigned integers.

```ts
table.integer('user_id').unsigned()
```

### primary

Mark the column as the primary key. Pass an optional options object with `constraintName` and `deferrable`.

```ts
table.uuid('id').primary()
table.uuid('id').primary({ constraintName: 'posts_pk' })
```

For composite primary keys, use the table-level `table.primary([...])` shown below.

### unique

Add a unique index on the column. Pass an optional options object with `indexName` and `deferrable`.

```ts
table.string('email').unique()
table.string('email').unique({ indexName: 'users_email_unique' })
```

For composite unique indexes, use the table-level `table.unique([...])`.

### index

Add an index on the column. Pass an optional index name and an optional index type (PostgreSQL and MySQL).

```ts
table.string('slug').index()
table.string('slug').index('posts_slug_idx')
table.json('payload').index('posts_payload_gin', 'gin')
```

### first and after

Position a column at the start of the table (`first`) or after a specific column (`after`). MySQL only.

```ts
table.string('email').first()
table.string('avatar_url').after('password')
```

### comment

Set a comment on the column.

```ts
table.string('avatar_url').comment('Stored as a relative path')
```

### collate

Set the collation for a column. MySQL only.

```ts
table.string('email').collate('utf8_unicode_ci')
```

## Foreign keys

Foreign keys can be declared inline as a column modifier or table-level for composite keys. Both shapes share the same downstream methods.

### references and inTable

Define the referenced column and table. The shorthand `references('table.column')` combines both.

```ts
// Long form
table.integer('user_id').references('id').inTable('users')

// Shorthand
table.integer('user_id').references('users.id')

// Table-level (allows composite keys and named constraints)
table.foreign('user_id').references('users.id')
table.foreign(['tenant_id', 'user_id']).references(['tenant_id', 'id']).inTable('users')
```

### onDelete and onUpdate

Specify the action to take when the referenced row is deleted or updated. Standard SQL actions: `CASCADE`, `SET NULL`, `RESTRICT`, `NO ACTION`, `SET DEFAULT`.

```ts
table
  .integer('user_id')
  .references('users.id')
  .onDelete('CASCADE')
  .onUpdate('RESTRICT')
```

### withKeyName

Override the auto-generated foreign key constraint name. Useful when you need to drop or alter the constraint by name later.

```ts
table
  .integer('user_id')
  .references('users.id')
  .withKeyName('posts_user_id_fk')
```

### deferrable

Mark the foreign key as deferrable, so the constraint check is delayed until commit time. PostgreSQL only. Accepts `'deferred'`, `'immediate'`, or `'not deferrable'`.

```ts
table
  .integer('user_id')
  .references('users.id')
  .deferrable('deferred')
```

## Check constraints

Check constraints enforce a predicate on every inserted or updated row. Available on PostgreSQL, MySQL 8+, MSSQL, SQLite, and Oracle. Each method accepts an optional constraint name as the last argument.

### checkPositive, checkNegative

```ts
table.integer('balance').checkPositive()
table.integer('temperature_below_zero').checkNegative('temp_must_be_negative')
```

### checkIn and checkNotIn

```ts
table.string('status').checkIn(['draft', 'published', 'archived'])
table.string('locale').checkNotIn(['xx', 'yy'], 'locale_blacklist')
```

### checkBetween

Pass a `[min, max]` tuple for a single range, or an array of tuples for multiple acceptable ranges.

```ts
table.integer('rating').checkBetween([1, 5])
table.integer('hour').checkBetween([[0, 11], [13, 23]])  // skip 12
```

### checkLength

```ts
table.string('handle').checkLength('>=', 3)
table.string('handle').checkLength('<=', 30, 'handle_max_length')
```

### checkRegex

Regex check, written as a SQL-compatible pattern (dialect-specific syntax).

```ts
table.string('handle').checkRegex('^[a-z0-9_]+$')
```

### dropChecks

Drop every check constraint defined on the column.

```ts
table.dropChecks()
```

## Table-level constraints

These methods sit on the table builder rather than chained off a column. Use them for composite indexes, composite foreign keys, and named constraints.

### primary

Define a single or composite primary key.

```ts
table.primary(['tenant_id', 'user_id'])
table.primary(['tenant_id', 'user_id'], { constraintName: 'tenant_user_pk' })
```

### unique

Define a single or composite unique index.

```ts
table.unique(['slug', 'tenant_id'])
table.unique(['slug', 'tenant_id'], { indexName: 'posts_slug_tenant_unique' })
```

### index

Add an index across one or more columns.

```ts
table.index(['first_name', 'last_name'])
table.index(['first_name', 'last_name'], 'users_full_name_idx')
table.index(['payload'], 'posts_payload_gin', 'gin')   // PostgreSQL: index type
```

### foreign

Add a foreign key constraint, including composite keys. The same `references`, `inTable`, `onDelete`, `onUpdate`, `withKeyName`, and `deferrable` methods are available.

```ts
table.foreign('user_id').references('users.id').onDelete('CASCADE')
table
  .foreign(['tenant_id', 'user_id'])
  .references(['tenant_id', 'id'])
  .inTable('users')
  .withKeyName('posts_tenant_user_fk')
```

## Altering existing columns

The methods below are valid inside `alterTable` (or `this.schema.table(...)`).

### alter

Mark a column definition as an alteration rather than an addition. The alteration is non-incremental: you must restate every constraint you want the column to keep.

```ts
this.schema.alterTable('posts', (table) => {
  table.text('body').notNullable().alter()
})
```

Pass options to control which aspects are altered:

```ts
table.text('body').alter({ alterNullable: true, alterType: false })
```

`alter` is not supported on SQLite or Redshift.

### setNullable and dropNullable

Toggle the nullability of an existing column without re-defining its type.

```ts
this.schema.alterTable('users', (table) => {
  table.setNullable('phone')
  table.dropNullable('email')
})
```

`dropNullable` fails when the column already contains `NULL` values; backfill before applying.

### renameColumn

Rename a column.

```ts
table.renameColumn('name', 'full_name')
```

## Dropping columns and constraints

### dropColumn and dropColumns

Drop one or more columns by name.

```ts
table.dropColumn('legacy_field')
table.dropColumns('first_name', 'middle_name', 'last_name')
```

### dropPrimary

Drop the primary key constraint. Pass an optional name when the constraint was created with a custom name.

```ts
table.dropPrimary()
table.dropPrimary('posts_pk')
```

### dropUnique

Drop a unique index. Pass the columns and optionally the index name.

```ts
table.dropUnique(['email'])
table.dropUnique(['slug', 'tenant_id'], 'posts_slug_tenant_unique')
```

### dropIndex

Drop an index. Pass the columns and optionally the index name.

```ts
table.dropIndex(['first_name', 'last_name'])
table.dropIndex(['first_name', 'last_name'], 'users_full_name_idx')
```

### dropForeign

Drop a foreign key constraint. Pass the columns and optionally the constraint name.

```ts
table.dropForeign('user_id')
table.dropForeign(['tenant_id', 'user_id'], 'posts_tenant_user_fk')
```

### dropTimestamps

Drop the `created_at` and `updated_at` columns added by `timestamps()`.

```ts
table.dropTimestamps()
```

## Table options

### comment

Set a comment on the table.

```ts
table.comment('Tracks every published article')
```

### engine

Set the storage engine. MySQL only.

```ts
table.engine('InnoDB')
```

### charset

Set the table-level character set. MySQL only.

```ts
table.charset('utf8mb4')
```

### collate

Set the table-level collation. MySQL only.

```ts
table.collate('utf8mb4_unicode_ci')
```

### inherits

Set a parent table for inheritance. PostgreSQL only.

```ts
table.inherits('cities')
```
