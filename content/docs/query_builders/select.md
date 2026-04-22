---
summary: Construct SELECT queries with the database query builder, including filters, joins, aggregates, CTEs, locks, and conditional helpers.
---

# Select query builder

This guide covers the SELECT query builder. You will learn how to:

- Select columns, including aliases, subqueries, and raw fragments
- Filter rows with the full family of `where` clauses and JSON helpers
- Join, group, aggregate, and order results
- Compose set operations and common table expressions
- Acquire row-level locks inside transactions
- Execute, inspect, and debug queries
- Build conditional queries with `if`, `unless`, `match`, and dialect-aware helpers

## Overview

The select query builder is Lucid's fluent interface for building SELECT statements. It returns plain JavaScript objects when executed. For typed model results, use the [model query builder](../models/query_builder.md). For inserts, use the [insert query builder](./insert.md). For updates and deletes, use [update and delete queries](./update_and_delete.md).

Get a builder instance through the `db` service.

```ts
import db from '@adonisjs/lucid/services/db'

const query = db.query()              // builder without a table selected
const usersQuery = db.from('users')   // shortcut: builder with the table selected
```

Both forms return the same `DatabaseQueryBuilder` instance. `db.from(table)` is the shortcut you will reach for most often.

## Selecting columns

By default the builder selects every column (`SELECT *`). Call `select` to limit the result to specific columns, or to use aliases, subqueries, and raw expressions.

### select

Pass column names as separate arguments or as an array.

```ts
// title: app/services/users_service.ts
import db from '@adonisjs/lucid/services/db'

const users = await db
  .from('users')
  .select('id', 'username', 'email')
```

Rename columns in the result with the `as` syntax or by passing an object with alias keys.

```ts
db.from('users').select('id', 'email as userEmail')

db.from('users').select({ id: 'id', userEmail: 'email' })
```

Pass a subquery as a column to compute a value at query time. The following selects each user's most recent login IP address as a derived column.

```ts
const users = await db
  .from('users')
  .select(
    db
      .from('user_logins')
      .select('ip_address')
      .whereColumn('users.id', 'user_logins.user_id')
      .orderBy('id', 'desc')
      .limit(1)
      .as('last_login_ip')
  )
```

Use `db.raw` for arbitrary SQL fragments as columns.

```ts
db
  .from('users')
  .select(
    db.raw(`(select count(*) from posts where posts.user_id = users.id) as posts_count`)
  )
```

### from

Select the table the query operates on.

```ts
db.from('users')
```

The `from` method also accepts a subquery or callback to query a derived table.

```ts
db
  .from((subquery) => {
    subquery
      .from('user_exams')
      .sum('marks as total')
      .groupBy('user_id')
      .as('totals')
  })
  .avg('totals.total')
```

### as

Set an alias on the query, typically when the query is used as a subquery passed to `select`, `from`, or another query builder method.

```ts
db
  .from('users')
  .select('id', 'username')
  .as('active_users')
```

## Where clauses

Where clauses filter the rows returned by the query. Lucid exposes a `where` method that accepts many shapes, plus a family of more specific helpers (`whereLike`, `whereIn`, `whereNull`, `whereExists`, `whereBetween`, `whereRaw`, JSON helpers).

### where

The most flexible filter method. It accepts a column name with an optional operator and a value, an object of equality checks, or a callback that builds a grouped condition.

```ts
// Equality
db.from('users').where('email', 'virk@adonisjs.com')

// Operator
db.from('users').where('age', '>', 18)

// Object form
db.from('users').where({ status: 'active', role: 'admin' })

// Grouped condition
db.from('users').where((query) => {
  query.where('role', 'admin').orWhere('is_owner', true)
})
```

Pass a subquery or raw expression as the value when the comparison cannot be expressed inline.

```ts
db
  .from('user_groups')
  .where(
    'user_id',
    db.raw(`(select user_id from users where users.user_id = ?)`, [1])
  )
```

The `where` method has variants for combining and inverting clauses:

| Method | Description |
| --- | --- |
| `andWhere` | Alias for `where` |
| `orWhere` | Adds an `OR WHERE` clause |
| `whereNot` | Adds a `WHERE NOT` clause |
| `orWhereNot` | Adds an `OR WHERE NOT` clause |
| `andWhereNot` | Alias for `whereNot` |

### whereColumn

Compare two columns directly, instead of a column to a value. Useful inside subqueries and joins.

```ts
db.from('users').whereColumn('updated_at', '>', 'created_at')
```

```ts
db
  .from('users')
  .select(
    db
      .from('user_logins')
      .select('ip_address')
      .whereColumn('users.id', 'user_logins.user_id')
      .orderBy('id', 'desc')
      .limit(1)
      .as('last_login_ip')
  )
```

`whereColumn` shares the same variant set as `where`: `andWhereColumn`, `orWhereColumn`, `whereNotColumn`, `orWhereNotColumn`, `andWhereNotColumn`.

### whereLike and whereILike

`whereLike` runs a case-sensitive `LIKE` comparison. `whereILike` runs a case-insensitive comparison and uses the appropriate operator for each dialect (`ILIKE` on PostgreSQL, `LIKE` on SQL Server, `LOWER(...)` on others).

```ts
db.from('posts').whereLike('title', '%Adonis 101%')
db.from('posts').whereILike('title', '%adonis 101%')
```

### whereIn

Match a column against a list of values.

```ts
db.from('users').whereIn('id', [1, 2, 3])
```

Pass an array of column names with a list of value tuples to filter on multiple columns at once.

```ts
db
  .from('users')
  .whereIn(['id', 'email'], [[1, 'virk@adonisjs.com']])

// SQL: select * from "users" where ("id", "email") in ((?, ?))
```

Compute the values from a subquery for "this row's id is in the result of another query" patterns.

```ts
db
  .from('users')
  .whereIn(
    'id',
    db.from('user_logins').select('user_id').where('logged_in_at', '>', '2026-01-01')
  )
```

Variants: `andWhereIn`, `orWhereIn`, `whereNotIn`, `orWhereNotIn`, `andWhereNotIn`.

### whereNull and whereNotNull

Filter rows where a column is (or is not) `NULL`.

```ts
db.from('users').whereNull('deleted_at')
db.from('users').whereNotNull('email_verified_at')
```

Variants: `andWhereNull`, `orWhereNull`, `andWhereNotNull`, `orWhereNotNull`.

### whereBetween and whereNotBetween

Filter rows where a column's value falls (or does not fall) within an inclusive range.

```ts
db.from('orders').whereBetween('total', [100, 500])
db.from('orders').whereNotBetween('created_at', ['2026-01-01', '2026-02-01'])
```

Variants: `andWhereBetween`, `orWhereBetween`, `andWhereNotBetween`, `orWhereNotBetween`.

### whereExists

Filter rows where a subquery returns at least one row. Use this for "rows that have a related record" patterns.

```ts
db
  .from('users')
  .whereExists((query) => {
    query
      .from('orders')
      .whereColumn('orders.user_id', 'users.id')
      .where('orders.status', 'paid')
  })
```

Variants: `andWhereExists`, `orWhereExists`, `whereNotExists`, `orWhereNotExists`, `andWhereNotExists`.

### wrapExisting

Wrap every where clause added so far into its own group, so subsequent where clauses combine with the wrapped group rather than its individual conditions. Useful when you have built a base query and want to apply additional conditions that should not mix into the existing logic.

```ts
const baseQuery = db
  .from('posts')
  .where('status', 'published')
  .orWhere('status', 'scheduled')

baseQuery
  .wrapExisting()
  .where('author_id', currentUser.id)

// SQL: select * from "posts" where ("status" = ? or "status" = ?) and "author_id" = ?
```

Without `wrapExisting`, the new `where('author_id', ...)` would `AND` against only the most recent `orWhere`, producing a different result.

### whereRaw

Embed a raw SQL fragment inside the where clause. Always pass user input as bindings, never by interpolating into the SQL string.

```ts
db
  .from('users')
  .whereRaw('LOWER(email) = ?', [request.input('email').toLowerCase()])
```

Variants: `andWhereRaw`, `orWhereRaw`, `whereNotRaw`, `orWhereNotRaw`, `andWhereNotRaw`.

### whereJsonPath

Filter rows by comparing a value at a JSON path inside a JSON column. The third argument is an operator and the fourth is the comparison value; pass three arguments to default the operator to `=`.

```ts
db
  .from('users')
  .whereJsonPath('preferences', '$.theme', 'dark')

db
  .from('orders')
  .whereJsonPath('payload', '$.totals.grand', '>', 1000)
```

Variants: `andWhereJsonPath`, `orWhereJsonPath`.

### whereJson

Filter rows where a JSON column matches a value structurally. Pass an object that the column must equal.

```ts
db
  .from('users')
  .whereJson('address', { city: 'Bangalore', pincode: '560001' })
```

Variants: `andWhereJson`, `orWhereJson`, `whereNotJson`, `orWhereNotJson`, `andWhereNotJson`.

### whereJsonSuperset

Filter rows where a JSON column contains all the keys and values of the given object. The column may have additional fields not in the test object.

```ts
db
  .from('users')
  .whereJsonSuperset('preferences', { theme: 'dark' })
```

Variants: `andWhereJsonSuperset`, `orWhereJsonSuperset`, `whereNotJsonSuperset`, `orWhereNotJsonSuperset`, `andWhereNotJsonSuperset`.

### whereJsonSubset

Filter rows where a JSON column is fully contained within the given object. The column's keys must be a subset of the test object.

```ts
db
  .from('users')
  .whereJsonSubset('flags', { premium: true, beta: true, internal: false })
```

Variants: `andWhereJsonSubset`, `orWhereJsonSubset`, `whereNotJsonSubset`, `orWhereNotJsonSubset`, `andWhereNotJsonSubset`.

JSON helpers are supported on PostgreSQL and MySQL. On SQLite the comparison falls back to a textual `JSON_EXTRACT`-style emulation that works for simple cases but should not be relied on for complex JSON queries.

## Joining tables

Joins combine rows from multiple tables. The query builder exposes the standard SQL join types, plus a raw escape hatch.

### join

The `join` method adds an `INNER JOIN` by default. Pass the joined table name, then either a column-to-column comparison or a callback for multi-condition joins.

```ts
// Simple ON clause
db
  .from('posts')
  .join('users', 'posts.user_id', 'users.id')

// With explicit operator
db
  .from('posts')
  .join('users', 'posts.user_id', '=', 'users.id')

// Callback form for compound conditions
db
  .from('posts')
  .join('users', (clause) => {
    clause
      .on('posts.user_id', 'users.id')
      .andOn('users.is_active', '=', db.raw('?', [true]))
  })
```

Variant methods produce the other join types:

| Method | Description |
| --- | --- |
| `innerJoin` | Same as `join`, but explicit |
| `leftJoin` / `leftOuterJoin` | `LEFT JOIN` / `LEFT OUTER JOIN` |
| `rightJoin` / `rightOuterJoin` | `RIGHT JOIN` / `RIGHT OUTER JOIN` |
| `fullOuterJoin` | `FULL OUTER JOIN` |
| `crossJoin` | `CROSS JOIN` |

### joinRaw

Use a raw SQL fragment as the entire join clause when the standard helpers cannot express what you need.

```ts
db
  .from('posts')
  .joinRaw('NATURAL FULL JOIN posts_meta')
```

### Join conditions with on*

Inside a join callback, the `on` clause supports a family of helpers for non-equality conditions. The methods mirror the where clause family but are called on the join clause object.

```ts
db
  .from('posts')
  .leftJoin('reactions', (clause) => {
    clause
      .on('reactions.post_id', 'posts.id')
      .onIn('reactions.kind', ['like', 'love', 'wow'])
      .onNotNull('reactions.deleted_at')
  })
```

```ts
db
  .from('users')
  .innerJoin('subscriptions', (clause) => {
    clause
      .on('subscriptions.user_id', 'users.id')
      .onBetween('subscriptions.created_at', ['2026-01-01', '2026-12-31'])
  })
```

The full set:

| Method | Description |
| --- | --- |
| `onIn(column, values)` | `column IN (...)` |
| `onNotIn(column, values)` | `column NOT IN (...)` |
| `onNull(column)` | `column IS NULL` |
| `onNotNull(column)` | `column IS NOT NULL` |
| `onExists(callback)` | `EXISTS (...)` |
| `onNotExists(callback)` | `NOT EXISTS (...)` |
| `onBetween(column, [min, max])` | `column BETWEEN min AND max` |
| `onNotBetween(column, [min, max])` | `column NOT BETWEEN min AND max` |

## Grouping and aggregating

### groupBy

Group rows by one or more columns. Aggregate functions like `count`, `sum`, and `avg` apply per group.

```ts
db
  .from('orders')
  .select('user_id')
  .count('* as order_count')
  .groupBy('user_id')
```

### groupByRaw

Group by a raw SQL expression.

```ts
db
  .from('orders')
  .groupByRaw('DATE_TRUNC(\'month\', created_at)')
```

### having

Filter the grouped result. Use `having` instead of `where` when the filter applies to an aggregate.

```ts
db
  .from('orders')
  .select('user_id')
  .count('* as order_count')
  .groupBy('user_id')
  .having('order_count', '>', 5)
```

Variants: `andHaving`, `orHaving`, `havingIn`, `havingNotIn`, `havingNull`, `havingNotNull`, `havingBetween`, `havingNotBetween`, `havingExists`, `havingNotExists`.

### havingRaw

Use a raw SQL fragment as the having clause.

```ts
db
  .from('orders')
  .select('user_id')
  .sum('total as total_spend')
  .groupBy('user_id')
  .havingRaw('SUM(total) > ?', [10000])
```

### Aggregate methods

Aggregate methods reduce the result to a single row per group, or a single row total when no `groupBy` is set. Pass an alias as part of the column string to control the output key.

```ts
const result = await db.from('orders').count('* as total')
console.log(result[0].total)
```

The full set of aggregates:

| Method | Description |
| --- | --- |
| `count(column)` | Number of non-null rows |
| `countDistinct(column)` | Number of distinct non-null values |
| `min(column)` | Minimum value |
| `max(column)` | Maximum value |
| `sum(column)` | Sum of values |
| `sumDistinct(column)` | Sum of distinct values |
| `avg(column)` | Average of values |
| `avgDistinct(column)` | Average of distinct values |

### distinct

Apply the `DISTINCT` modifier to the SELECT.

```ts
db.from('users').distinct('email')
```

Pass no arguments to apply `DISTINCT` to all selected columns.

### distinctOn

Apply the PostgreSQL-specific `DISTINCT ON` modifier, which keeps the first row for each distinct value of the listed columns according to the query's `ORDER BY`. Available only on PostgreSQL.

```ts
db
  .from('events')
  .distinctOn('user_id')
  .orderBy('user_id')
  .orderBy('occurred_at', 'desc')
```

## Ordering and limiting

### orderBy

Order results by a column. Pass `'asc'` or `'desc'` (defaults to `'asc'`).

```ts
db.from('posts').orderBy('created_at', 'desc')
```

Pass an array of objects to order by multiple columns.

```ts
db
  .from('posts')
  .orderBy([
    { column: 'is_pinned', order: 'desc' },
    { column: 'created_at', order: 'desc' },
  ])
```

### orderByRaw

Order by a raw SQL expression.

```ts
db
  .from('posts')
  .orderByRaw('LENGTH(title) DESC')
```

### offset and limit

Skip and limit rows.

```ts
db.from('posts').offset(40).limit(20)
```

### forPage

Convenience method that combines `offset` and `limit` for offset-based pagination. `forPage(page, perPage)` is equivalent to `.offset((page - 1) * perPage).limit(perPage)`.

```ts
db.from('posts').forPage(3, 20)
```

For the full pagination workflow including the `paginate` method and `SimplePaginator` reference, see the [pagination guide](../guides/pagination.md).

## Set operations

### union

Combine the results of two or more queries that return the same columns.

```ts
db
  .from('users')
  .select('email')
  .where('subscribed_to_newsletter', true)
  .union((query) => {
    query.from('contacts').select('email').where('opted_in', true)
  })
```

By default `union` removes duplicate rows. Pass `true` as the second argument or use `unionAll` to keep duplicates.

```ts
db
  .from('users')
  .select('email')
  .unionAll((query) => {
    query.from('contacts').select('email')
  })
```

### intersect and except

Return only rows that appear in both queries (`intersect`) or rows that appear in the first but not the second (`except`). Supported on PostgreSQL, MSSQL, and SQLite.

```ts
db
  .from('active_users')
  .select('id')
  .intersect((query) => {
    query.from('paying_users').select('id')
  })
```

## Common table expressions

CTEs let you give a subquery a name and reference it in the main query. Useful for readability and recursive queries.

### with

Define a CTE alias and use it as a regular table.

```ts
db
  .with('active_users', (query) => {
    query
      .from('users')
      .select('*')
      .where('is_active', true)
  })
  .from('active_users')
  .where('role', 'admin')
```

### withMaterialized and withNotMaterialized

PostgreSQL-specific hints that force the planner to materialize (or refuse to materialize) the CTE result.

```ts
db
  .withMaterialized('aliased_table', (query) => {
    query.from('users').select('*')
  })
  .select('*')
  .from('aliased_table')
```

### withRecursive

Build a recursive CTE for tree and graph traversal. Supported on PostgreSQL, MySQL 8+, SQLite 3.8+, MSSQL, and Oracle.

The example below sums the amounts of every account that descends from a given root, walking down the parent/child hierarchy.

```ts
db
  .query()
  .withRecursive('tree', (query) => {
    query
      .from('accounts')
      .select('amount', 'id')
      .where('id', 1)
      .union((subquery) => {
        subquery
          .from('accounts as a')
          .select('a.amount', 'a.id')
          .innerJoin('tree', 'tree.id', 'a.parent_id')
      })
  })
  .sum('amount as total')
  .from('tree')
```

A third argument restricts the column list of the CTE.

```ts
db
  .query()
  .withRecursive('tree', (query) => {
    // ...
  }, ['amount', 'id'])
  .sum('amount as total')
  .from('tree')
```

## Locks

Locks serialize concurrent access to selected rows at the database level. They must be used inside a transaction; without one, the lock is acquired and immediately released.

Locks must be issued through the transaction client itself (`trx`), not through `db`, so the lock and the transaction belong to the same connection.

### forUpdate

Acquire a write lock on the selected rows. Other transactions that try to read or modify the same rows block until your transaction commits or rolls back.

```ts
await db.transaction(async (trx) => {
  const wallet = await trx
    .from('wallets')
    .where('user_id', userId)
    .forUpdate()
    .first()

  // safe to modify the row inside the transaction
})
```

### forShare

Acquire a shared lock. Other transactions can read but not modify the rows. PostgreSQL emits `FOR SHARE`; MySQL emits `LOCK IN SHARE MODE`.

```ts
await db.transaction(async (trx) => {
  await trx
    .from('users')
    .where('id', 1)
    .forShare()
    .first()
})
```

### skipLocked

Skip rows that another transaction has locked instead of waiting. Available on PostgreSQL 9.5+ and MySQL 8.0+.

```ts
await db.transaction(async (trx) => {
  const job = await trx
    .from('jobs')
    .where('status', 'pending')
    .forUpdate()
    .skipLocked()
    .first()
})
```

### noWait

Fail immediately when any selected row is locked, instead of blocking. Available on PostgreSQL 9.5+ and MySQL 8.0+.

```ts
await db.transaction(async (trx) => {
  await trx
    .from('jobs')
    .where('id', 1)
    .forUpdate()
    .noWait()
    .first()
})
```

## Executing the query

The query builder is a `Promise`. You can `await` it directly, iterate the result, or use the dedicated execution helpers below.

```ts
const users = await db.from('users').where('is_active', true)
```

### first

Return the first matching row, or `null` when no row matches.

```ts
const user = await db.from('users').where('email', email).first()
```

### firstOrFail

Return the first matching row, or throw a `RowNotFoundException` when no row matches. Convenient for controllers that should respond with a 404 when the record does not exist.

```ts
const user = await db.from('users').where('id', params.id).firstOrFail()
```

### Inside a transaction

To run a query inside a transaction, build it directly off the transaction client. The `trx` object exposes the same `.from`, `.query`, and other entry points as the `db` service. See the [transactions guide](../guides/transactions.md) for the full pattern.

```ts
await db.transaction(async (trx) => {
  const users = await trx
    .from('users')
    .where('is_active', true)
})
```

## Conditional builders

These methods let you add query constraints based on application state, without scattering `if` statements through the chain.

### if

Apply a callback only when the condition is truthy. The callback receives the query builder.

```ts
const search = request.input('search')

const users = await db
  .from('users')
  .if(search, (query) => {
    query.whereILike('email', `%${search}%`)
  })
```

Pass a fallback callback as the third argument for the false branch.

```ts
db
  .from('posts')
  .if(includeDrafts, (query) => query, (query) => query.where('status', 'published'))
```

### unless

The inverse of `if`: apply the callback only when the condition is falsy.

```ts
db
  .from('posts')
  .unless(currentUser.isAdmin, (query) => {
    query.where('status', 'published')
  })
```

### match

Apply the first callback whose guard is truthy, or an optional default callback when none match. Reads cleanly when several mutually exclusive conditions are in play.

```ts
db
  .from('posts')
  .match(
    [request.input('status') === 'draft', (query) => query.where('status', 'draft')],
    [request.input('status') === 'published', (query) => query.where('status', 'published')],
    (query) => query.whereNot('status', 'archived')
  )
```

### ifDialect and unlessDialect

Apply a callback only when the connection's dialect matches (or does not match) one of the given names. Useful for writing dialect-specific SQL fragments without manual checks.

```ts
db
  .from('users')
  .ifDialect('postgres', (query) => {
    query.select(db.raw(`to_char(created_at, 'YYYY-MM-DD') as created_date`))
  })
  .unlessDialect(['sqlite3', 'better-sqlite3'], (query) => {
    query.forUpdate()
  })
```

Dialect names accepted: `postgres`, `mysql`, `mysql2`, `mssql`, `sqlite3`, `better-sqlite3`, `libsql`, `oracledb`, `redshift`.

## Inspecting and debugging

### toSQL

Return a `{ sql, bindings }` object describing the SQL the query will execute, without running it. Useful for logging, debugging, or composing with `db.rawQuery`.

```ts
const { sql, bindings } = db.from('users').where('is_active', true).toSQL()
```

### toQuery

Return the query as a single interpolated string, with bindings substituted. Convenient for ad-hoc inspection. Prefer `toSQL` + bindings when forwarding to logs to avoid quoting issues.

```ts
const sql = db.from('users').where('is_active', true).toQuery()
```

### debug

Enable debug output for this query only. The query is emitted on the `db:query` event when at least one listener is attached.

```ts
db.from('users').debug(true)
```

See the [debugging guide](../guides/debugging.md) for the full debug workflow, including pretty-printing and `asyncStackTraces`.

### timeout

Abort the query if it runs longer than the given number of milliseconds. Pass `{ cancel: true }` on PostgreSQL and MySQL to cancel the underlying query.

```ts
db.from('users').timeout(5000)
db.from('users').timeout(5000, { cancel: true })
```

### clone

Return a copy of the builder that can be modified without affecting the original. Useful when one base query feeds multiple variants.

```ts
const baseQuery = db.from('posts').where('is_published', true)

const recent = await baseQuery.clone().orderBy('created_at', 'desc').limit(10)
const popular = await baseQuery.clone().orderBy('views', 'desc').limit(10)
```

### reporterData

Attach arbitrary metadata to the `db:query` event payload, accessible to listeners. Useful for tagging queries with request IDs, user IDs, or feature flags for observability.

```ts
const posts = await db
  .from('posts')
  .where('is_published', true)
  .reporterData({ userId: auth.user.id, source: 'feed' })
```

```ts
// title: start/events.ts
import emitter from '@adonisjs/core/services/emitter'

emitter.on('db:query', (query) => {
  console.log(query.userId, query.source)
})
```

See the [debugging guide](../guides/debugging.md) for the full `db:query` event payload.

## Schema and escape hatches

### withSchema

Set a non-default schema for the query (PostgreSQL, MSSQL).

```ts
db.from('users').withSchema('analytics')
```

### knexQuery

Return the underlying Knex query builder. Use this when you need a Knex method that Lucid does not expose, such as `rowNumber` or other analytic helpers.

```ts
const rankings = await db
  .knexQuery()
  .from('scores')
  .select('user_id', 'points')
  .rowNumber('rank', { column: 'points', order: 'desc' })
```

The result is shaped by Knex rather than Lucid, so you lose Lucid's typed result. See [Drop to Knex](../guides/database_service.md#drop-to-knex) in the database service guide for the broader discussion.
