---
summary: Execute raw SQL safely with the raw query builder, including positional and named bindings, embedding fragments inside other queries, transactions, and inspection helpers.
---

# Raw query builder

This guide covers the raw query builder. You will learn how to:

- Execute raw SQL statements safely with bindings
- Embed raw SQL fragments inside other query builders
- Use positional (`?`, `??`) and named (`:value`, `:column:`) bindings
- Run raw queries inside transactions
- Inspect, debug, and tag raw queries

## Overview

The raw query builder gives you a way to run SQL Lucid does not model in its query builder, while still keeping bindings safe from SQL injection. Lucid exposes two complementary entry points:

- **`db.rawQuery(sql, bindings)`** returns a query that executes on its own. Use it for entire SQL statements you want to run directly.
- **`db.raw(sql, bindings)`** returns a fragment that you pass into another query builder method. Use it to drop down to SQL inside an otherwise builder-built query.

Use raw queries when the standard query builder cannot express what you need. Stay inside the [select](./select.md), [insert](./insert.md), or [update and delete](./update_and_delete.md) query builders for everything that fits — they handle dialect differences, identifier quoting, and result typing for you.

The result of a raw query comes straight from the underlying database driver, so its shape is dialect-specific. PostgreSQL returns a result object with `rows`, MySQL returns an array, and SQLite returns rows directly. Inspect or destructure the result accordingly.

```ts
// PostgreSQL
const result = await db.rawQuery('select * from users')
console.log(result.rows)

// MySQL / SQLite
const [rows] = await db.rawQuery('select * from users')
```

:::warning
Never concatenate user input into a raw SQL string. Always use bindings, which the driver escapes correctly. Concatenated input opens the door to SQL injection.
:::

## Executing raw SQL

Use `db.rawQuery` to run a complete SQL statement.

```ts
// title: app/services/reports_service.ts
import db from '@adonisjs/lucid/services/db'

const result = await db.rawQuery(
  `select date_trunc('month', created_at) as month, count(*) as total
   from orders
   group by month
   order by month desc`
)
```

Pass dynamic values as bindings, never as string interpolation. The second argument can be either an array (for positional bindings) or an object (for named bindings).

```ts
await db.rawQuery('select * from users where id = ?', [userId])

await db.rawQuery('select * from users where id = :id', { id: userId })
```

## Embedding raw fragments

Use `db.raw` to drop down to SQL inside another query builder. The fragment is passed by reference and inlined where the query builder accepts a value.

```ts
const users = await db
  .from('users')
  .select(
    'id',
    'email',
    db.raw('(select count(*) from posts where posts.user_id = users.id) as posts_count')
  )
```

Raw fragments work as `WHERE` values, `ORDER BY` expressions, `GROUP BY` keys, or anywhere else the builder accepts an expression.

```ts
await db
  .from('posts')
  .where('view_count', '>', db.raw('(select avg(view_count) from posts)'))

await db.from('posts').orderByRaw('LENGTH(title) DESC')
```

Bindings work the same way as `rawQuery`.

```ts
db.from('users').whereRaw('LOWER(email) = ?', [email.toLowerCase()])
```

## Bindings

### Positional bindings

`?` is replaced by a value, with the driver escaping the value for the dialect.

```ts
await db.rawQuery('select * from users where email = ? and is_active = ?', [
  email,
  true,
])
```

`??` is replaced by an identifier (column or table name) and is quoted appropriately.

```ts
await db.rawQuery('select * from users where ?? = ?', ['users.id', 1])

// SQL: select * from users where "users"."id" = 1
```

### Named bindings

`:name` is replaced by the matching value from the bindings object.

```ts
await db.rawQuery(
  `select * from posts where status = :status and author_id = :authorId`,
  { status: 'published', authorId: user.id }
)
```

`:name:` (with a trailing colon) is replaced by an identifier from the bindings object.

```ts
await db.rawQuery(
  `select * from user_logins inner join users on :left: = :right:`,
  { left: 'users.id', right: 'user_logins.user_id' }
)

// SQL: select * from user_logins inner join users on "users"."id" = "user_logins"."user_id"
```

Named bindings read clearly when the same value appears more than once or when the SQL has many parameters. Positional bindings are shorter for simple queries.

## Wrapping fragments

Wrap a raw fragment with a prefix and suffix when embedding it as a subquery. The query builder does not auto-wrap raw fragments in parentheses, so you must wrap them yourself when the surrounding SQL requires it.

```ts
await db
  .from('users')
  .select(
    'id',
    db
      .raw('select ip_address from user_logins where user_logins.user_id = users.id order by id desc limit 1')
      .wrap('(', ')')
  )
```

Without `wrap`, the inner SQL is inserted verbatim, which is invalid SQL when used as a column expression.

## Inside a transaction

To run a raw query inside a transaction, build it directly off the transaction client. The `trx` object exposes the same `.rawQuery` and `.raw` entry points as the `db` service. See the [transactions guide](../guides/transactions.md) for the full pattern.

```ts
await db.transaction(async (trx) => {
  await trx.rawQuery(
    'update inventory set stock = stock - ? where product_id = ?',
    [quantity, productId]
  )

  await trx.rawQuery(
    'insert into stock_movements (product_id, change, reason) values (?, ?, ?)',
    [productId, -quantity, 'order_fulfilled']
  )
})
```

## Inspecting and tagging

### toSQL

Return a `{ sql, bindings }` object describing the query without running it. Useful for logging, debugging, or composing with another `rawQuery` call.

```ts
const { sql, bindings } = db
  .rawQuery('select * from users where id = ?', [1])
  .toSQL()
```

### toQuery

Return the SQL with bindings substituted as a single string. Convenient for ad-hoc inspection. Prefer `toSQL` + bindings when forwarding to logs, since string interpolation can introduce quoting issues.

```ts
const sql = db.rawQuery('select * from users where id = ?', [1]).toQuery()
```

### debug

Enable debug output for this query only. The query is emitted on the `db:query` event when at least one listener is attached. See the [debugging guide](../guides/debugging.md) for the full debug workflow.

```ts
await db.rawQuery('select * from users').debug(true)
```

### timeout

Abort the query if it runs longer than the given number of milliseconds. Pass `{ cancel: true }` on PostgreSQL and MySQL to cancel the underlying query rather than leaving it running on the server after the client times out.

```ts
await db.rawQuery('select * from large_audit_log').timeout(30_000, { cancel: true })
```

### reporterData

Attach arbitrary metadata to the `db:query` event payload, accessible to listeners. Useful for tagging queries with request IDs, user IDs, or feature flags for observability.

```ts
await db
  .rawQuery('select * from posts where author_id = ?', [user.id])
  .reporterData({ userId: user.id, source: 'feed' })
```

```ts
// title: start/events.ts
import emitter from '@adonisjs/core/services/emitter'

emitter.on('db:query', (query) => {
  console.log(query.userId, query.source)
})
```

## Escape hatch

### knexQuery

Return the underlying Knex `Raw` instance. Use this when you need a Knex method on the raw query that Lucid does not expose. The result is shaped by Knex rather than Lucid. See [Drop to Knex](../guides/database_service.md#drop-to-knex) in the database service guide for the broader discussion.
