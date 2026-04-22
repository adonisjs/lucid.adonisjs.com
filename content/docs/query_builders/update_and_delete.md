---
summary: Update, delete, increment, and decrement rows through the database query builder, including returning columns, transactions, and read-only safety.
---

# Update and delete queries

This guide covers the UPDATE and DELETE methods on the database query builder. You will learn how to:

- Update one or many columns in matching rows
- Increment and decrement numeric columns atomically
- Delete rows
- Read back affected rows with `returning`
- Run updates and deletes inside transactions
- Understand the read-only safety guard

## Overview

The database query builder exposes `update`, `delete` (with `del` as an alias), `increment`, and `decrement` for modifying rows. These methods live on the same builder as `select`, so you compose the WHERE, JOIN, and ORDER clauses exactly the same way and end the chain with the modifying call.

```ts
import db from '@adonisjs/lucid/services/db'

await db.from('users').where('id', 1).update({ is_active: false })
```

For inserts, see the [insert query builder](./insert.md). For SELECT and the full list of WHERE and JOIN helpers used to scope these queries, see the [select query builder](./select.md). For raw SQL, see the [raw query builder](./raw.md).

The return value of `update`, `delete`, `increment`, and `decrement` is the number of affected rows by default. When `returning` is set, the result is an array of the returned rows instead.

## Updating rows

### update

Pass a column-value object to update multiple columns at once.

```ts
await db
  .from('users')
  .where('id', 1)
  .update({
    is_active: false,
    deactivated_at: new Date(),
  })
```

Pass two arguments to update a single column.

```ts
await db
  .from('users')
  .where('id', 1)
  .update('email', 'new@adonisjs.com')
```

Use `db.raw` as a value to update a column based on its existing content or a SQL expression.

```ts
await db
  .from('posts')
  .where('id', params.id)
  .update({
    view_count: db.raw('view_count + 1'),
    last_viewed_at: db.raw('NOW()'),
  })
```

The query returns the number of affected rows.

```ts
const affected = await db
  .from('users')
  .where('is_active', false)
  .update({ status: 'archived' })

// affected === number of rows touched
```

:::warning
Always include a `where` clause on update queries. Without one, every row in the table is updated. Lucid does not require a `where` clause for safety; that responsibility is on the caller.
:::

### Returning updated columns

On dialects that support `RETURNING` (PostgreSQL, MSSQL, Oracle, SQLite 3.35+), call `returning` to read back columns from the affected rows. The result becomes an array of objects rather than an affected-rows count.

```ts
const updated = await db
  .from('users')
  .where('plan', 'free')
  .update({ plan: 'pro' })
  .returning(['id', 'email'])

updated.forEach((user) => console.log(user.id, user.email))
```

`returning` accepts a single column, an array of columns, or `'*'` for every column. On MySQL, `returning` is silently ignored, and the query still resolves to the affected-rows count.

## Increment and decrement

### increment

Atomically add to a numeric column. Without a counter argument, the column is incremented by `1`.

```ts
await db
  .from('posts')
  .where('id', params.id)
  .increment('view_count')

await db
  .from('posts')
  .where('id', params.id)
  .increment('view_count', 5)
```

### decrement

Atomically subtract from a numeric column. Without a counter argument, the column is decremented by `1`.

```ts
await db
  .from('inventory')
  .where('product_id', productId)
  .decrement('stock')

await db
  .from('inventory')
  .where('product_id', productId)
  .decrement('stock', quantity)
```

Increments and decrements are issued as `UPDATE column = column +/- value` on the database side, so they are safe under concurrent writes without an explicit transaction or row lock.

## Deleting rows

### delete

Issue a DELETE statement against the rows matching the current chain.

```ts
await db
  .from('sessions')
  .where('user_id', user.id)
  .delete()
```

The query returns the number of affected rows.

```ts
const removed = await db
  .from('expired_tokens')
  .where('expires_at', '<', new Date())
  .delete()

console.log(`Removed ${removed} expired tokens`)
```

`del` is an alias for `delete` and behaves identically. Use whichever reads better in your codebase.

```ts
await db.from('sessions').where('id', sessionId).del()
```

:::warning
Always include a `where` clause on delete queries. Without one, every row in the table is deleted.
:::

### Returning deleted columns

On dialects that support `RETURNING`, call `returning` to read back the columns from the deleted rows. Useful when you want to log the rows you removed or hand them off to another part of the application.

```ts
const removed = await db
  .from('comments')
  .where('post_id', params.id)
  .delete()
  .returning(['id', 'author_id'])

await audit.recordDeletion('comment', removed)
```

## Inside a transaction

To update or delete rows inside a transaction, build the query directly off the transaction client. The `trx` object exposes the same `.from` entry point as the `db` service. See the [transactions guide](../guides/transactions.md) for the full pattern.

```ts
await db.transaction(async (trx) => {
  await trx
    .from('orders')
    .where('id', orderId)
    .update({ status: 'paid', paid_at: new Date() })

  await trx
    .from('inventory')
    .where('product_id', productId)
    .decrement('stock')
})
```

Both modifications either commit together or roll back together if either query throws.

## Read-only mode protection

When you obtain a query client in `read` mode (typically by calling `db.connection('postgres', { mode: 'read' })`), the builder refuses to execute `update`, `delete`, `increment`, or `decrement` and throws an exception:

```
Updates and deletes cannot be performed in read mode
```

This guard prevents accidental writes to a read replica. To perform a write, use the default (`dual`) or explicit `write` mode.

```ts
// Safe: dual mode auto-routes writes to the primary
await db.from('users').where('id', 1).update({ last_seen_at: new Date() })

// Explicit write mode
await db
  .connection('postgres', { mode: 'write' })
  .from('users')
  .where('id', 1)
  .update({ last_seen_at: new Date() })
```

## Inspecting the query

The same inspection helpers documented in the [select query builder](./select.md#inspecting-and-debugging) apply to update and delete queries.

```ts
const { sql, bindings } = db
  .from('users')
  .where('id', 1)
  .update({ is_active: false })
  .toSQL()
```

Use `debug(true)` to emit this query on the `db:query` event without enabling connection-level debug, and `timeout(ms, { cancel: true })` to abort long-running modifications.

```ts
db
  .from('analytics_events')
  .where('created_at', '<', cutoff)
  .delete()
  .timeout(30_000, { cancel: true })
```

See the [debugging guide](../guides/debugging.md) for the full debug workflow.
