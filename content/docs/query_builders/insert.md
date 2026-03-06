# Insert query builder

The insert query builder allows you to insert new rows into the database. You must use the [select query builder](./select.md) for **selecting**, **deleting** or **updating** rows.

You can get access to the insert query builder as shown in the following example:

```ts
import db from '@adonisjs/lucid/services/db'

db.insertQuery()

// selecting table also returns an instance of the query builder
db.table('users')
```

## Methods/Properties
Following is the list of methods and properties available on the Insert query builder class.

### insert
The `insert` method accepts an object of key-value pair to insert.

The return value of the insert query is highly dependent on the underlying driver.

- MySQL returns the id of the last inserted row.
- SQLite returns the id of the last inserted row.
- For PostgreSQL, MSSQL, and Oracle, you must use the `returning` method to fetch the value of the id.

```ts
db
  .table('users')
  .returning('id')
  .insert({
    username: 'virk',
    email: 'virk@adonisjs.com',
    password: 'secret',
  })
```

### multiInsert
The `multiInsert` method accepts an array of objects and inserts multiple rows at once.

```ts
db
  .table('users')
  .multiInsert([
    {
      username: 'virk',
      email: 'virk@adonisjs.com',
      password: 'secret',
    },
    {
      username: 'romain',
      email: 'romain@adonisjs.com',
      password: 'secret',
    }
  ])

/**
INSERT INTO "users"
  ("email", "password", "username")
values
  ('virk@adonisjs.com', 'secret', 'virk'),
  ('romain@adonisjs.com', 'secret', 'romain')
*/
```

### returning
You can use the `returning` method with PostgreSQL, MSSQL, and Oracle databases to retrieve one or more columns' values.

```ts
const rows = db
  .table('users')
  .returning(['id', 'username'])
  .insert({
    username: 'virk',
    email: 'virk@adonisjs.com',
    password: 'secret',
  })

console.log(rows[0].id, rows[0].username)
```

### onConflict
The `onConflict` method allows you to specify an alternative behavior when a unique constraint violation occurs during an insert. It is supported in **PostgreSQL**, **MySQL**, and **SQLite3** databases. You can chain it with `ignore` to silently discard the conflicting row, or `merge` to perform an upsert.

You can call `onConflict` without arguments, with a single column, or with an array of columns.

#### onConflict().ignore()
Ignore the insert when a conflict occurs. This adds an `ON CONFLICT ... DO NOTHING` clause (or the equivalent for your database).

```ts
db
  .table('users')
  .insert({ username: 'virk', email: 'virk@adonisjs.com' })
  .onConflict('username')
  .ignore()

/**
INSERT INTO "users" ("email", "username")
VALUES ('virk@adonisjs.com', 'virk')
ON CONFLICT ("username") DO NOTHING
*/
```

You can also specify multiple columns:

```ts
db
  .table('users')
  .insert({ username: 'virk', email: 'virk@adonisjs.com' })
  .onConflict(['username', 'email'])
  .ignore()
```

Or call `onConflict` without arguments to handle any conflict:

```ts
db
  .table('users')
  .insert({ username: 'virk', email: 'virk@adonisjs.com' })
  .onConflict()
  .ignore()
```

#### onConflict().merge()
Merge the conflicting row with the new values (upsert). This adds an `ON CONFLICT ... DO UPDATE SET` clause.

When called without arguments, all inserted columns are updated:

```ts
db
  .table('users')
  .insert({ username: 'virk', email: 'virk@adonisjs.com' })
  .onConflict('username')
  .merge()

/**
INSERT INTO "users" ("email", "username")
VALUES ('virk@adonisjs.com', 'virk')
ON CONFLICT ("username")
DO UPDATE SET "email" = EXCLUDED."email", "username" = EXCLUDED."username"
*/
```

You can specify a subset of columns to update on conflict:

```ts
db
  .table('users')
  .insert({ username: 'virk', email: 'virk@adonisjs.com' })
  .onConflict('username')
  .merge(['email'])
```

Or provide an object of key-value pairs to set specific values on conflict:

```ts
db
  .table('users')
  .insert({ username: 'virk', email: 'virk@adonisjs.com' })
  .onConflict('username')
  .merge({ email: 'updated@adonisjs.com' })
```

### with
The `with` method allows you to use CTE (Common table expression) with insert queries in **PostgreSQL**, **Oracle**, **SQLite3** and the **MSSQL** databases.

```ts
import db from '@adonisjs/lucid/services/db'

db
  .table('users')
  .with('active_users', db.raw('select * from users where is_active = ?', [true]))
  .insert({ username: 'virk' })
```

### withMaterialized/withNotMaterialized
The `withMaterialized` and the `withNotMaterialized` methods allow you to use CTE (Common table expression) as materialized views with insert queries in **PostgreSQL** and **SQLite3** databases.

```ts
db
  .table('users')
  .withMaterialized('active_users', db.raw('select * from users where is_active = 1'))
  .insert({ username: 'virk' })
```

### withRecursive
The `withRecursive` method creates a recursive CTE (Common table expression) for insert queries in **PostgreSQL**, **Oracle**, **SQLite3** and the **MSSQL** databases.

```ts
db
  .table('users')
  .withRecursive('tree', db.raw('select * from categories'))
  .insert({ username: 'virk' })
```

### comment
The `comment` method adds an SQL comment to the query. This can be helpful for identifying queries in database logs and monitoring tools.

```ts
db
  .table('users')
  .comment('bulk user insert')
  .insert({ username: 'virk', email: 'virk@adonisjs.com' })

/**
/* bulk user insert *​/ INSERT INTO "users" ("email", "username")
VALUES ('virk@adonisjs.com', 'virk')
*/
```

### debug
The `debug` method allows enabling or disabling debugging at an individual query level. Here's a [complete guide](../guides/debugging.md) on debugging queries.

```ts
const rows = db
  .table('users')
  // highlight-start
  .debug(true)
  // highlight-end
  .insert({
    username: 'virk',
    email: 'virk@adonisjs.com',
    password: 'secret',
  })
```

### timeout
Define the `timeout` for the query. An exception is raised after the timeout has been exceeded.

The value of timeout is always in milliseconds.

```ts
db
  .table('users')
  // highlight-start
  .timeout(2000)
  // highlight-end
  .insert({
    username: 'virk',
    email: 'virk@adonisjs.com',
    password: 'secret',
  })
```

You can also cancel the query when using timeouts with MySQL and PostgreSQL.

```ts
db
  .table('users')
  .timeout(2000, { cancel: true })
  .insert({
    username: 'virk',
    email: 'virk@adonisjs.com',
    password: 'secret',
  })
```

### toSQL
The `toSQL` method returns the query SQL and bindings as an object.

```ts
const output = db
  .table('users')
  .insert({
    username: 'virk',
    email: 'virk@adonisjs.com',
    password: 'secret',
  })
  // highlight-start
  .toSQL()
  // highlight-end

console.log(output)
```

The `toSQL` object also has the `toNative` method to format the SQL query as per the database dialect in use.

```ts
const output = db
  .table('users')
  .insert({
    username: 'virk',
    email: 'virk@adonisjs.com',
    password: 'secret',
  })
  .toSQL()
  .toNative()

console.log(output)
```

### toQuery
Returns the SQL query as a string with bindings applied to the placeholders.

```ts
const output = db
  .table('users')
  .insert({
    username: 'virk',
    email: 'virk@adonisjs.com',
    password: 'secret',
  })
  .toQuery()

console.log(output)
/**
INSERT INTO "users"
  ("email", "password", "username")
values
  ('virk@adonisjs.com', 'secret', 'virk')
*/
```

## Helpful properties and methods
Following is the list of properties and methods you may occasionally need when building something on top of the query builder.

### client
Reference to the instance of the underlying [database query client](https://github.com/adonisjs/lucid/blob/develop/src/query_client/index.ts).

```ts
const query = db.insertQuery()
console.log(query.client)
```

### knexQuery
Reference to the instance of the underlying KnexJS query.

```ts
const query = db.insertQuery()
console.log(query.knexQuery)
```

### reporterData
The query builder emits the `db:query` event and reports the query's execution time with the framework profiler.

Using the `reporterData` method, you can pass additional details to the event and the profiler.

```ts
const query = db.table('users')

await query
  .reporterData({ userId: auth.user.id })
  .insert({
    username: 'virk',
    email: 'virk@adonisjs.com',
    password: 'secret',
  })
```

Within the `db:query` event, you can access the value of `userId` as follows.

```ts
import emitter from '@adonisjs/lucid/services/emitter'

emitter.on('db:query', (query) => {
  console.log(query.userId)
})
```
