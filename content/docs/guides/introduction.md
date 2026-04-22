---
summary: Lucid is the SQL library for AdonisJS. Active Record models, hand-written migrations, generated schema classes, and the full power of Knex underneath.
---

# Introduction

Lucid is the SQL library for AdonisJS. It combines a Knex-powered query builder with class-based **Active Record** models, hand-written migrations, and **schema classes** that Lucid generates directly from your live database.

You write migrations to evolve your schema, and Lucid reads the database to regenerate typed schema classes for every table. Your models extend those generated classes and focus on what matters: relationships, lifecycle hooks, and the domain methods that operate on your data.

Because Lucid is the database layer AdonisJS is built around, the validator, the IoC container, Auth, testing utilities, and Ace commands integrate with it out of the box. You do not assemble a database stack; you write application code.

## A quick tour

Lucid's workflow starts at the database rather than at TypeScript. You describe schema changes in migrations, run them, and Lucid generates typed schema classes from the tables that actually exist.

Start by writing a migration that describes a new table.

```ts
// title: database/migrations/1234_create_posts_table.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('posts', (table) => {
      table.increments('id')
      table.string('title').notNullable()
      table.string('status').defaultTo('draft')
      table.integer('author_id').unsigned().references('users.id')
      table.timestamps(true, true)
    })
  }
}
```

Run the migration. Lucid scans the database and regenerates `database/schema.ts` with a typed schema class for every table it finds.

```sh
// title: terminal
node ace migration:run
```

Extend the generated class in your model. Columns are inherited automatically, so your model only needs to declare what is specific to this model: relationships, business logic, and lifecycle hooks.

```ts
// title: app/models/post.ts
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { PostsSchema } from '#database/schema'
import User from './user.js'

export default class Post extends PostsSchema {
  @belongsTo(() => User, { foreignKey: 'authorId' })
  declare author: BelongsTo<typeof User>

  isPublished(): boolean {
    return this.status === 'published'
  }

  async publish() {
    this.status = 'published'
    await this.save()
  }
}
```

Query and persist records, with types flowing end-to-end from the generated schema classes through your controllers.

```ts
// title: app/controllers/posts_controller.ts
const posts = await Post.query()
  .where('status', 'published')
  .preload('author')
  .orderBy('createdAt', 'desc')

const post = await Post.findOrFail(params.id)
await post.publish()
```

Your database is the contract, migrations evolve it over time, and your models carry the behavior that operates on it. TypeScript follows along automatically.

## The database is the source of truth

Most TypeScript ORMs work from code to database. You declare tables as TypeScript types or decorators, and the ORM generates migrations by diffing your entity definitions against the database.

This approach works fine for greenfield projects, but it breaks down once your application has real data in production. Column renames turn into drop-and-recreate operations that lose data. Complex backfills cannot be expressed as schema diffs. Splitting a table into two tables still requires you to write the migration by hand. And adopting an existing legacy database is effectively impossible without recreating its entire migration history from scratch.

Lucid inverts this direction. You write migrations directly, as real SQL changesets with full access to the database's capabilities. After migrations run, Lucid scans the database and generates `database/schema.ts`, a typed projection of the schema that actually exists. Your models extend those generated classes and inherit column types without declaring them twice.

You get strong typing where it matters, reading and writing rows, without paying the cost of a code-first schema that cannot express real production work.

If you are adopting an existing database, you can run `node ace schema:generate` to produce typed schema classes for every table that already exists. No migration history is required, which makes Lucid a practical choice for legacy projects as well as new ones.

## Models that do things

Lucid is an **Active Record** ORM. Model classes map to tables, instances map to rows, and methods live on the class next to the data they operate on.

Most TypeScript ORMs return plain objects: records that carry data but no behavior. Questions like "what can a user do?" are answered somewhere else, typically in a service, a helper, or a controller. Over time, the same rule gets enforced in three different places, with small variations creeping into each copy.

Active Record collapses that duplication by placing behavior directly on the model, where it belongs.

```ts
// title: app/models/subscription.ts
import { beforeSave, hasMany } from '@adonisjs/lucid/orm'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'
import { SubscriptionsSchema } from '#database/schema'
import Invoice from './invoice.js'

export default class Subscription extends SubscriptionsSchema {
  @hasMany(() => Invoice)
  declare invoices: HasMany<typeof Invoice>

  @beforeSave()
  static async touchRenewal(subscription: Subscription) {
    if (subscription.$dirty.status === 'active') {
      subscription.renewedAt = DateTime.now()
    }
  }

  isActive(): boolean {
    return this.status === 'active' && this.expiresAt > DateTime.now()
  }

  async cancel(reason: string) {
    this.status = 'cancelled'
    this.cancellationReason = reason
    await this.save()
  }
}
```

Behavior lives with the data it operates on, and lifecycle hooks enforce invariants automatically instead of asking every caller to remember them. Calling `subscription.cancel()` always records a reason, the `beforeSave` hook always updates `renewedAt` when the subscription becomes active, and relationships are defined once on the model and reused everywhere you load a subscription. Model instances also track their own state through `$dirty` and `$original`, and serialize themselves through `toJSON()` when sent as a response.

This is the same pattern that shapes domain-heavy applications in Laravel Eloquent, Rails Active Record, and Elixir Ecto. Lucid brings it to TypeScript without apology.

## The full power of SQL

Lucid is built on [Knex](https://knexjs.org/), a battle-tested SQL builder that handles connection pooling, transactions, migrations, and dialect support for PostgreSQL, MySQL, SQLite, MSSQL, and LibSQL.

That foundation means you are not confined to CRUD. When a problem needs window functions, recursive CTEs, JSON operations, or row locks, you can express it inside the query builder without dropping down to raw SQL strings.

### Window functions

Use SQL window functions to rank rows, deduplicate results, or compute running totals directly in the database, without post-processing in JavaScript.

```ts
// title: app/services/leaderboard_service.ts
import db from '@adonisjs/lucid/services/db'

const rankings = await db
  .from('scores')
  .select('user_id', 'game_id', 'points')
  .select(
    db.raw(`rank() OVER (PARTITION BY game_id ORDER BY points DESC) as rank`)
  )
```

### Recursive CTEs

Walk trees, graphs, and hierarchical data in a single query using the `withRecursive` method on the query builder.

```ts
// title: app/services/accounts_service.ts
import db from '@adonisjs/lucid/services/db'

const total = await db
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

### JSON operations

Query and filter JSON columns natively on PostgreSQL and MySQL using Lucid's `whereJson`, `whereJsonSuperset`, and `whereJsonSubset` helpers.

```ts
// title: app/controllers/users_controller.ts
const users = await User.query()
  .whereJsonSuperset('preferences', { theme: 'dark' })
```

### Row-level locks

Acquire row-level locks with `forUpdate` inside a transaction to serialize critical sections at the database layer and prevent concurrent writes from clobbering each other.

```ts
// title: app/services/wallet_service.ts
import db from '@adonisjs/lucid/services/db'

await db.transaction(async (trx) => {
  const wallet = await Wallet.query({ client: trx })
    .where('userId', userId)
    .forUpdate()
    .firstOrFail()

  wallet.balance -= amount
  await wallet.save()
})
```

## Compared to other ORMs

**Prisma** is schema-first. You declare tables in a `schema.prisma` file, and Prisma generates a typed client from that declaration. It is a good fit for greenfield projects outside AdonisJS that want a generated client and do not mind a code-first schema. Lucid picks Active Record behavior and a database-first schema over a generated client.

**Drizzle** is a thin typed layer over SQL with construction-time type safety. It is a good fit when you want to assemble a database stack yourself with minimal abstraction. Lucid picks framework integration and Active Record conventions over minimal abstraction.

**Kysely** is a fully typed query builder. It is a good fit when query-construction type safety is the top priority and you are ready to build your own abstractions on top of it. Lucid picks flexibility over construction-time types, which is what allows Auth, factories, relationships, and preload builders to work generically across every model.

**TypeORM and MikroORM** are Active Record and Data Mapper implementations for TypeScript. Both of them work code-first, where you declare entities and the ORM diffs them against the database to generate migrations. Lucid picks hand-written migrations and generated schema classes instead, so that the database stays the source of truth.

## When Lucid is the right fit

Lucid is the right choice when:

- **You are building an AdonisJS application.** The framework is designed around Lucid, so choosing anything else means reimplementing the integration points with Auth, validators, config, and testing utilities.
- **Your domain has real behavior.** When methods like `order.cancel()`, `subscription.renew()`, and `user.deactivate()` need to enforce business rules, log audit entries, and trigger hooks, Active Record keeps that logic in one place and enforces it every time.
- **You maintain a production database.** Hand-written migrations can express renames, backfills, safe index rollouts, and multi-step refactors that diffed migrations cannot produce safely.
- **You are adopting a legacy database.** Running `schema:generate` produces typed schema classes from whatever tables already exist, with no migration history required.
- **You run multiple databases or read/write replicas.** Lucid routes queries per connection, per model, or per request, and keeps transactions consistent across the boundary.
- **You write SQL beyond CRUD.** Window functions, CTEs, JSON operations, and locks are all first-class citizens inside the query builder.

Consider an alternative when:

- **You are not using AdonisJS.** Most of Lucid's value comes from framework integration, so a standalone library like Drizzle or Prisma is likely a better fit outside of AdonisJS.
- **Construction-time type safety is a hard requirement.** Kysely is the better fit if you need your query construction itself to be fully typed.
- **You prefer a schema-first workflow with a generated client.** Prisma is shaped around this workflow and fits it better than Lucid ever will.

## A note on type safety

Lucid is strongly typed on the output side. Query results, model instances, and relationships are all shaped by the generated schema classes, so you get autocomplete and type errors everywhere you read or write data.

Lucid is not fully typed on query construction. Kysely sets the bar there, but that comes with a rigidity tradeoff: generic abstractions on top of Kysely are effectively impossible, as the [Kysely authors have confirmed](https://www.answeroverflow.com/m/1179612569774870548). Lucid takes the opposite tradeoff and stays flexible enough to power the IoC container, Auth, factories, and every framework helper that needs to work generically across arbitrary models.

Parts of Lucid may grow stricter types over time, but parity with Kysely on construction is not a goal. [This write-up](https://github.com/thetutlage/meta/discussions/8) covers the reasoning in more depth.

## Next steps

- [Installation and setup](./installation.md)
- [Using models](../models/introduction.md)
- [Creating migrations](../migrations/introduction.md)
- [Model factories](../testing/model_factories.md)
