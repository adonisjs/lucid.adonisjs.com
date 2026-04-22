---
summary: Model factories generate realistic fake data for tests and seeders. Lucid factories cover attribute overrides, states, relationships, stubbing, hooks, and custom instantiation.
---

# Model factories

This guide covers Lucid's model factories. You will learn how to:

- Define a factory for a model and generate instances
- Override default attributes and apply named states
- Create or persist instances, including in-memory and stubbed variants
- Seed relationships, including pivot attributes for many-to-many
- Hook into factory lifecycle events
- Use factories across multiple connections

## Overview

A factory is a small module that produces realistic instances of a model. Instead of building the required fields by hand in every test or seeder, you declare the shape once and reuse it with overrides.

```ts
// title: database/factories/user_factory.ts
import User from '#models/user'
import { Factory } from '@adonisjs/lucid/factories'

export const UserFactory = Factory.define(User, ({ faker }) => {
  return {
    email: faker.internet.email(),
    password: faker.internet.password(),
  }
}).build()
```

Factories live in `database/factories/`. Generate a new factory with the `make:factory` Ace command.

```sh
node ace make:factory User
// CREATE: database/factories/user_factory.ts
```

`Factory.define(Model, callback)` takes the model class and a callback that returns the default attributes. The callback receives a runtime context, whose `faker` property is a [Faker.js](https://fakerjs.dev) instance for generating realistic values. Return an object with every required field the model expects, otherwise the database rejects the insert with a `NOT NULL` error.

Call `.build()` at the end to finalize the factory. The return value is what the rest of the application imports and uses.

## Generating models

A factory can produce model instances in three modes. Pick based on whether you need a persisted row, a database-free instance, or an in-memory instance with a simulated primary key.

### create and createMany

`create()` builds an instance, persists it to the database, and returns the saved model. `createMany(count)` does the same for `count` instances.

```ts
import { UserFactory } from '#database/factories/user_factory'

const user = await UserFactory.create()
const users = await UserFactory.createMany(10)
```

This is the default you will reach for in integration tests and seeders.

### make and makeMany

`make()` instantiates the model without running any database query. The returned instance has no primary key and `$isPersisted` is `false`.

```ts
const user = await UserFactory.make()

console.log(user.id)              // undefined
console.log(user.$isPersisted)    // false
```

Use `make` when the test only needs to exercise model behavior that does not touch the database (for example, computed properties, serialization, validation).

### makeStubbed and makeStubbedMany

`makeStubbed()` also skips the database but assigns an in-memory primary key, so any code that expects a persisted model (an authorization helper that reads `user.id`, a cache key builder) works against the stub.

```ts
const user = await UserFactory.makeStubbed()

console.log(user.id)              // 1, 2, 3, ... from a global counter
console.log(user.$isPersisted)    // false
```

Use `makeStubbed` for unit tests that want the appearance of a persisted model without paying the cost of a real insert.

## Overriding attributes

### merge

Call `merge(attributes)` to override specific fields for this invocation. Every other field still comes from the factory's default callback.

```ts
await UserFactory.merge({ email: 'test@example.com' }).create()
```

When producing many instances, pass an array of overrides. Each entry is applied to the instance at the same index.

```ts
await UserFactory
  .merge([
    { email: 'foo@example.com' },
    { email: 'bar@example.com' },
  ])
  .createMany(3)
```

Instances beyond the end of the array fall back to the factory defaults. In the example above the first two users get the explicit emails and the third gets the faker-generated default.

### mergeRecursive

`mergeRecursive(attributes)` applies the same merge to the factory's relationships as well, so overriding a field on the parent also overrides it on every related factory in the tree.

```ts
await UserFactory
  .with('posts', 2)
  .mergeRecursive({ tenantId: 'tenant-a' })
  .create()

// tenantId is set on the user and on each post
```

Reach for `mergeRecursive` when you have a field (tenant id, partition key, soft-delete flag) that must stay consistent across a parent and its descendants.

### pivotAttributes

`pivotAttributes` sets values on the pivot table for a many-to-many relationship. See [Relationships](#relationships) below.

## Factory states

States are named variations of the factory. Define them with `.state(name, callback)` before `.build()`, and apply them at call time with `.apply(...names)`.

```ts
// title: database/factories/post_factory.ts
import Post from '#models/post'
import { Factory } from '@adonisjs/lucid/factories'

export const PostFactory = Factory.define(Post, ({ faker }) => {
  return {
    title: faker.lorem.sentence(),
    content: faker.lorem.paragraphs(4),
    status: 'DRAFT',
  }
})
  .state('published', (post) => {
    post.status = 'PUBLISHED'
  })
  .state('archived', (post) => {
    post.status = 'ARCHIVED'
    post.archivedAt = DateTime.now()
  })
  .build()
```

Apply one state or many at call time.

```ts
await PostFactory.apply('published').createMany(3)

await PostFactory.apply('published', 'featured').create()
```

State callbacks receive the already-built model instance plus the runtime context, so you can call faker or read the transaction from there as well.

## Per-instance decoration with tap

`tap(callback)` runs your callback for every instance the factory produces, after the factory callback and any applied states. Use it for one-off decoration that does not deserve a state.

```ts
const users = await UserFactory
  .tap((user, ctx, builder) => {
    user.rememberMeToken = generateToken()
  })
  .createMany(5)
```

The callback receives the model instance, the runtime context, and the factory builder. Mutate the model in place; return values are ignored.

## Relationships

Factories compose naturally with model relationships. Declare the relationship on the factory with `.relation(name, factoryFn)` and Lucid detects its type from the model.

```ts
// title: database/factories/user_factory.ts
import User from '#models/user'
import { Factory } from '@adonisjs/lucid/factories'
import { PostFactory } from '#database/factories/post_factory'

export const UserFactory = Factory.define(User, ({ faker }) => {
  return {
    email: faker.internet.email(),
    password: faker.internet.password(),
  }
})
  .relation('posts', () => PostFactory)
  .build()
```

The relationship must already exist on the Lucid model. `.relation` wires a factory to that relationship so you can create it alongside the parent.

Use `.with(name, count?, callback?)` to create related rows when producing the parent.

```ts
const user = await UserFactory.with('posts', 3).create()
console.log(user.posts.length)    // 3
```

Lucid wraps the parent and the related writes in a managed transaction, so if the related write fails the parent insert rolls back too.

### Applying states to related rows

Pass a callback to `.with` to configure the related factory. The callback receives the related factory so you can chain `apply`, `merge`, or further nested `with` calls.

```ts
const user = await UserFactory
  .with('posts', 3, (post) => post.apply('published'))
  .create()
```

Mix states across multiple `with` calls for the same relationship.

```ts
const user = await UserFactory
  .with('posts', 3, (post) => post.apply('published'))
  .with('posts', 2)
  .create()

console.log(user.posts.length)    // 5
```

Nested relationships work through chained `.with` inside the callback.

```ts
const user = await UserFactory
  .with('posts', 2, (post) => post.with('comments', 5))
  .create()
```

### Pivot attributes for many-to-many

For many-to-many relationships, `.pivotAttributes(attrs)` sets columns on the pivot row that gets inserted alongside.

```ts
await UserFactory
  .with('teams', 1, (team) => {
    team.pivotAttributes({ role: 'admin' })
  })
  .create()
```

Pass an array to set different pivot attributes per row. The array length must match the number of related rows.

```ts
await UserFactory
  .with('teams', 2, (team) => {
    team.pivotAttributes([
      { role: 'admin' },
      { role: 'moderator' },
    ])
  })
  .create()
```

## Hooks

Register callbacks to run before or after factory lifecycle events. Hooks are declared on the factory model before `.build()`.

```ts
Factory.define(Post, () => ({ /* ... */ }))
  .before('create', (factory, model, ctx) => {
    // runs before the INSERT
  })
  .after('create', (factory, model, ctx) => {
    // runs after the INSERT
  })
  .build()
```

The hook callback receives the factory builder, the model instance, and the runtime context.

| Hook | When it fires |
| --- | --- |
| `before('create')` | Before the `INSERT` when `create`/`createMany` is used |
| `after('create')` | After the `INSERT` |
| `before('makeStubbed')` | Before the primary key is assigned on a stubbed instance |
| `after('makeStubbed')` | After the stubbed instance is ready |
| `after('make')` | After an instance is built, for every mode (`make`, `makeStubbed`, `create`) |

You can register multiple hooks for the same event. They run in registration order.

## Runtime context

A runtime context is created for every factory invocation and passed to the attribute callback, state callbacks, relationships, hooks, and `tap`.

```ts
Factory.define(User, (ctx) => {
  return { /* ... */ }
})
  .state('admin', (model, ctx) => { /* ... */ })
  .before('create', (factory, model, ctx) => { /* ... */ })
  .after('create', (factory, model, ctx) => { /* ... */ })
  .build()
```

The context exposes two fields:

- `faker`, a Faker.js instance for generating values
- `isStubbed`, a boolean indicating whether the factory was called with `makeStubbed`
- `$trx`, the transaction wrapping the factory's writes, when one exists

Run any database queries inside a hook through the transaction on `ctx.$trx` so they commit or roll back with the factory's own writes.

## Using factories across connections

Factories inherit the model's connection by default. Override per call when your tests or seeders operate on a non-default connection.

```ts
// By connection name
await UserFactory.connection('tenant-a').create()

// With an explicit query client
import db from '@adonisjs/lucid/services/db'
await UserFactory.client(db.connection('tenant-a')).create()

// Via the query() shortcut, accepting either
await UserFactory.query({ connection: 'tenant-a' }).create()
```

The override applies to the current factory chain. Subsequent factory calls still use the default unless they set their own override.

## Customizing instantiation

### newUp

`newUp(callback)` replaces Lucid's default instantiation. Use it when the model needs a non-standard construction step.

```ts
Factory.define(User, () => ({ /* ... */ }))
  .newUp((attributes, ctx) => {
    const user = new User()
    user.fill(attributes)
    return user
  })
  .build()
```

### merge

`merge(callback)` replaces the default attribute-merge behavior. The callback decides how the attributes object is applied to the model instance.

```ts
Factory.define(User, () => ({ /* ... */ }))
  .merge((user, attributes, ctx) => {
    user.merge(attributes)
  })
  .build()
```

## Customizing stubbed primary keys

By default, `makeStubbed` assigns an incrementing integer to the model's primary key. Override this globally with `Factory.stubId` when your models use non-integer primary keys (UUIDs, BigInts, ULIDs).

```ts
import { Factory } from '@adonisjs/lucid/factories'

Factory.stubId((counter, model) => {
  return BigInt(counter)
})
```

For per-factory customization, register a `before('makeStubbed')` hook that assigns the primary key before Lucid's stub runs.

```ts
import { randomUUID } from 'node:crypto'

Factory.define(Post, () => ({ /* ... */ }))
  .before('makeStubbed', (_, model) => {
    model.id = randomUUID()
  })
  .build()
```
