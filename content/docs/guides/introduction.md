---
summary: An overview of Lucid's SQL query builder and Active Record ORM, including its philosophy around class-based models, the Active Record pattern, and how it compares to other ORMs.
---

# Introduction

This guide explains Lucid's core philosophy: treating models as domain objects with behavior, not just data shapes. You'll learn about the Active Record pattern, how Lucid builds on Knex for powerful query building, explicit migrations, and how Lucid compares to alternatives like Prisma and Drizzle.

## Overview

Lucid is a SQL query builder and Active Record ORM built on top of [Knex](https://knexjs.org/). Lucid strives to leverage SQL to its full potential and offers a clean API for many advanced SQL operations.

Following are some of the hand-picked Lucid features:

- A fluent query builder built on top of Knex.
- Support for read-write replicas and multiple connection management.
- Class-based models that adhere to the Active Record pattern.
- Migration system to modify database schema using incremental changesets.
- Model factories to generate fake data for testing.
- Database seeders to insert initial/dummy data into the database.

## A fluent query builder

The base layer of Lucid is a fluent query builder built on top of Knex.js. Knex handles connection pooling, transactions, schema building, and query construction across multiple database engines (MySQL, PostgreSQL, SQLite, MSSQL, Oracle). The query builder supports many advanced SQL operations like **window functions**, **recursive CTEs**, **JSON operations**, and **row-based locks**.

```typescript
const posts = await Post.query()
  .where('status', 'published')
  .orderBy('created_at', 'desc')
  .limit(10)
```

For complex queries that go beyond standard CRUD operations, Knex's full capabilities are available. You can use raw SQL for complex analytics, write CTEs for advanced queries, or leverage database-specific optimizations:

```typescript
// Complex analytical query
const stats = await Database.from('posts')
  .select('user_id')
  .count('* as total')
  .sum('views as total_views')
  .groupBy('user_id')
  .havingRaw('count(*) > ?', [5])
```

See also: [Using query builder](./installation.md#basic-usage)

## Active record ORM

The ORM layer of AdonisJS uses JavaScript classes to define data models. In the Active Record pattern, each model instance represents a database row and knows how to persist itself. Models can define lifecycle hooks, custom methods to encapsulate domain logic, and control serialization behavior.

Object-based ORMs like Prisma or Drizzle return plain JavaScript objects, they contain data but no behavior. Lucid's class-based approach means you write `if (user.isAdmin())` instead of `if (user.role === 'admin')`. Behavior lives with data.

```typescript
// title: app/models/user.ts
import { beforeSave } from '@adonisjs/lucid/orm'
import hash from '@adonisjs/core/services/hash'
import { UserSchema } from '#database/schema'

export default class User extends UserSchema {
  @beforeSave()
  static async hashPassword(user: User) {
    if (user.$dirty.password) {
      user.password = await hash.make(user.password)
    }
  }

  isAdmin(): boolean {
    return this.role === 'admin'
  }

  async deactivate() {
    this.isActive = false
    await this.save()
  }
}
```

Business logic on the model ensures rules are consistently applied. 

- Instead of spreading logic across services, behavior is discoverable. It's `await user.deactivate()` rather than `await deactivateUser(user)`.
- Method names describe intent. `order.place()`, `order.cancel()`, `order.isPaid()`.
- Lifecycle hooks like `@beforeSave()` enforce invariants. Password hashing always happens, not just when you remember.
- Models are stateful. The `$dirty` property tracks changes, enabling partial updates and audit trails.
- Relationships are defined once. `await user.related('posts').query()` rather than re-creating joins everywhere.

See also: [Using models](../models/introduction.md)

## Migration system

Inspired by frameworks like Laravel, Rails, and Elixir Ecto, AdonisJS does not infer schema changes from models. Instead, you write incremental changesets to modify the database schema. 

In real-world applications, schema changes involve renaming columns, preserving data, creating new tables, and copying data, and all without locking tables for long durations. Manual migrations ensure you can express schema changes per your application requirements.

```typescript
// title: database/migrations/1234_create_users_table.ts
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('users', (table) => {
      table.increments('id')
      table.string('email').unique().notNullable()
      table.string('password', 180).notNullable()
      table.timestamps(true)
    })
  }

  async down() {
    this.schema.dropTable('users')
  }
}
```

See also: [Creating migrations](../migrations/introduction.md)

## How Lucid compares to other ORMs

**Prisma** is schema-first, you define everything in a `schema.prisma` file and generate TypeScript types. Prisma returns plain objects with excellent type inference. Lucid uses TypeScript classes as domain objects with behavior. Choose Prisma for schema-first development or standalone projects. Choose Lucid for behavior-driven models in AdonisJS applications.

**Drizzle** emphasizes a SQL-like syntax (`db.select().from(users).where(...)`) with lightweight abstraction. Like Lucid, Drizzle provides type information for query outputs but not complete type safety for query construction. Lucid uses object-oriented patterns (`User.query().where(...)`). Choose Drizzle if you prefer minimal abstraction. Choose Lucid for Active Record convenience with lifecycle hooks and behavior on models.

## Lucid is not type-safe

Lucid is not type-safe. Let's discuss why.

Type safety with SQL ORMs is a complex topic since it must be applied on multiple layers, such as query construction and output. Many query builders and ORMs are only type-safe with the query output (sometimes they also limit the SQL features), and only a few are type-safe with query construction as well. Kysely is one of them.

I have [written a few hundred words](https://github.com/thetutlage/meta/discussions/8) comparing Kysely and Drizzle ORM that might help you properly understand the type safety layers.

If we take Kysely as the gold standard of type-safety, we lose a lot of flexibility with it. Especially, in ways, we extend and use Lucid across the AdonisJS codebase. In fact, I used it to create an extension for our Auth module and the helpers Lucid models can use. And I failed both times. The [creators of Kysely also confirmed](https://www.answeroverflow.com/m/1179612569774870548) that creating generic abstractions of Kysely is impossible.

This is not to say that Kysely is limiting in the first place. It is limiting how we want to use, i.e., build generic abstractions and integrate them seamlessly with the rest of the framework. Kysely is an excellent tool for direct usage.

With that said, looking at the resources at our disposal and our goals, Lucid will not be as type-safe as Kysely in the near future. However, we might invest some time in making certain parts of the ORM type safe.

## When to choose Lucid

Choose Lucid if you're building an AdonisJS application, it integrates seamlessly with the framework's conventions, IoC container, and validators.

Choose Lucid if you want models with behavior (`user.isAdmin()`, `order.cancel()`), lifecycle hooks that enforce invariants automatically, or stateful models that track changes through `$dirty`.

Consider alternatives if you're building stateless services where plain objects are clearer, you're not using AdonisJS, or you strongly prefer schema-first development (Prisma).

## Next steps

- [Installation and setup](./installation.md)
- [Using models](../models/introduction.md)
- [Creating migrations](../migrations/introduction.md)
- [Model factories](../models/model_factories.md)
