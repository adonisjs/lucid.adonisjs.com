---
summary: Lucid's unique and exists validation rules for VineJS, including the options reference, callback form, custom messages, and the gotchas worth knowing.
---

# Validation rules

This guide covers the validation rules Lucid adds to VineJS. You will learn how to:

- Validate that a value is unique inside a database table
- Validate that a value exists inside a database table
- Exclude the current row from a uniqueness check on update
- Customize the query through options or a callback
- Override the default error messages

## Overview

Lucid extends VineJS with two database-aware validation rules: `unique` and `exists`. Both rules are macros on `VineString` and `VineNumber`, registered automatically when Lucid's service provider boots, so you can chain them onto any string or number field in your schema.

```ts
// title: app/validators/users_validator.ts
import vine from '@vinejs/vine'

export const createUserValidator = vine.create({
  email: vine.string().email().unique({ table: 'users', column: 'email' }),
  referralCode: vine.string().exists({ table: 'referrals', column: 'code' }),
})
```

Both rules support two invocation forms. The **options object** describes the table, column, and any extra constraints, and Lucid runs the query for you. The **callback** gives you the database service and lets you write the query yourself, which is useful when the options form does not cover what you need.

Each rule runs a separate query against the database for every validated value, so a request that validates many such fields runs many queries. See [Behavior and performance notes](#behavior-and-performance-notes) for the implications.

## The unique rule

The `unique` rule passes when the database does **not** already contain a row matching the value, and reports a validation error when it does. Use it for fields that must be unique within a table, like email addresses or slugs.

```ts
const createUserValidator = vine.create({
  email: vine.string().email().unique({ table: 'users', column: 'email' }),
})
```

The options form above emits the following SQL when the rule executes:

```sql
SELECT "email" FROM "users" WHERE "email" = ? LIMIT 1
```

When the SELECT returns a row, the rule reports `"The {{ field }} has already been taken"` for that field. When no row is returned, validation passes.

## The exists rule

The `exists` rule is the inverse: it passes when the database **does** contain a matching row, and reports an error when it does not. Use it to validate references to existing records, like a category slug or a foreign key submitted in a form.

```ts
const subscribeValidator = vine.create({
  plan: vine.string().exists({ table: 'plans', column: 'slug' }),
})
```

The SQL is structurally identical to `unique`:

```sql
SELECT "slug" FROM "plans" WHERE "slug" = ? LIMIT 1
```

The rule fails when the SELECT returns no rows, with the message `"The selected {{ field }} is invalid"`.

## Excluding the current row on update

The plain options form of `unique` is correct for create requests but wrong for updates. When a user edits their profile and submits the same email they already have, the rule finds their own row and reports the email as taken. The fix is the `filter` option, combined with VineJS metadata, which lets you exclude the current row from the uniqueness check.

Define the validator with a metadata type so it accepts the current user's ID at validation time.

```ts
// title: app/validators/users_validator.ts
import vine from '@vinejs/vine'

export const updateUserValidator = vine
  .withMetaData<{ userId: number }>()
  .create({
    email: vine.string().email().unique({
      table: 'users',
      column: 'email',
      filter: (db, _value, field) => {
        db.whereNot('id', field.meta.userId)
      },
    }),
  })
```

Pass the user's ID as metadata when calling the validator from the controller.

```ts
// title: app/controllers/users_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { updateUserValidator } from '#validators/users_validator'

export default class UsersController {
  async update({ params, request }: HttpContext) {
    const user = await User.findOrFail(params.id)

    const payload = await updateUserValidator.validate(request.all(), {
      meta: { userId: user.id },
    })

    user.merge(payload)
    await user.save()

    return user
  }
}
```

The `filter` callback receives the underlying query builder and mutates it in place. The emitted SQL becomes:

```sql
SELECT "email" FROM "users" WHERE "email" = ? AND "id" <> ? LIMIT 1
```

The user's own row is now excluded, so the rule only fails when the email belongs to someone else.

## Options reference

Both `unique` and `exists` accept the same options object.

<dl>

<dt>

table

</dt>

<dd>

The database table to query. Required.

</dd>

<dt>

column

</dt>

<dd>

The column to compare the value against. When omitted, the rule uses the field name from the schema, which can be wrong if your field name and column name differ. Pass it explicitly when the field is camelCase (like `emailAddress`) and the column is snake_case (like `email_address`).

</dd>

<dt>

connection

</dt>

<dd>

Name of the database connection to query. Defaults to the application's primary connection. Use this when the table being checked lives on a non-default connection.

</dd>

<dt>

caseInsensitive

</dt>

<dd>

When `true`, both sides of the comparison are wrapped in `LOWER(...)`. The rule emits `WHERE LOWER("column") = LOWER(?)` instead of `WHERE "column" = ?`. See [Behavior and performance notes](#behavior-and-performance-notes) for the index implications.

</dd>

<dt>

filter

</dt>

<dd>

A callback `(query, value, field) => void | Promise<void>` that lets you append additional `WHERE` clauses to the query. Mutate the query builder directly rather than returning a new query. Use this to exclude a current row on updates, scope the check to a tenant, or apply any other constraint the options form cannot express.

</dd>

</dl>

## Using a callback

The callback form takes a function `(db, value, field) => Promise<boolean>` that runs the entire query yourself. Reach for it when the options form cannot describe what you need: multi-clause WHERE, joins, soft-delete handling, or anything model-specific.

For `unique`, the callback returns `true` when the value is unique (validation passes) and `false` when it already exists (validation fails). For `exists`, the semantics are inverted: `true` means the value exists.

```ts
import vine from '@vinejs/vine'
import User from '#models/user'

const createUserValidator = vine.create({
  email: vine.string().email().unique(async (_db, value) => {
    const existing = await User.findBy('email', value)
    return existing === null
  }),
})
```

The callback can use a Lucid model directly (as shown above) or use the `db` argument to write the query in raw query-builder form.

```ts
.unique(async (db, value) => {
  const row = await db
    .from('users')
    .where('email', value)
    .whereNull('deleted_at')
    .first()
  return row === null
})
```

## Custom error messages

The default messages are `"The {{ field }} has already been taken"` for `unique` and `"The selected {{ field }} is invalid"` for `exists`. Override them through VineJS's message customization mechanism using the rule keys `database.unique` and `database.exists`.

```ts
// title: app/validators/messages_provider.ts
import { SimpleMessagesProvider } from '@vinejs/vine'

export const messagesProvider = new SimpleMessagesProvider({
  'database.unique': 'A user with this {{ field }} is already registered',
  'database.exists': 'No record found for the given {{ field }}',
})
```

See the [VineJS error messages guide](https://vinejs.dev/docs/custom_error_messages) for the full pattern, including per-field and per-rule overrides.

## Behavior and performance notes

A few details about how the rules execute that are worth knowing.

**Earlier rule failures skip the database query.** If a field is invalid before the `unique` or `exists` rule runs (the value is missing, the format is wrong, or another rule reported an error), the rule short-circuits and does not hit the database. This means `unique` and `exists` errors do not stack on top of other errors. A submission with an empty value to `vine.string().minLength(3).unique({...})` reports the `minLength` error and never runs the unique check.

**Case-insensitive comparison disables index usage.** Setting `caseInsensitive: true` wraps both sides in `LOWER(...)`. Standard B-tree indexes on the column cannot be used for this comparison, so the database falls back to a sequential scan. To keep the rule fast on large tables, create a functional index on `LOWER(column)` (PostgreSQL, MySQL 8+) or use a generated column with a regular index.

**Each rule runs a separate query.** Validating five fields with `unique`/`exists` rules in one schema produces five separate database round trips. This is rarely a bottleneck for typical forms, but worth knowing for endpoints that validate many such fields against large tables.
