---
summary: An introduction to the Lucid ORM data models, built on the active record pattern.
---

# Models

This guide covers Lucid models in AdonisJS. You will learn what models are, how they are built on the Active Record pattern, how to create models, understand auto-generated schema classes, and configure model options using static properties.

## Overview

Lucid models are built on top of the Active Record pattern. They encapsulate database interactions into language-specific classes and objects, simplifying common tasks like CRUD operations, defining relationships, and querying data.

Each model is represented as a class that maps to a database table. Unlike working with raw query results or plain objects, models provide type safety and can be passed by reference throughout your application. This means you can add methods, define computed properties, and encapsulate business logic directly on the model class.

The key advantage of the Active Record pattern is that each model instance represents a single row in the database. You can call methods like `save()`, `delete()`, or access properties directly on the instance, making database operations feel natural and object-oriented.

## Creating your first model

Models in AdonisJS work hand-in-hand with migrations and schema classes. Before creating a model, you need to define the table structure using migrations. When migrations run, they automatically generate schema classes that contain the column definitions and decorators. Your model then extends these schema classes.

The workflow is:

1. Create and run migrations to define your table structure
2. The migration execution generates a schema class in `database/schema.ts`
3. Create your model that extends the generated schema class

To create a model, use the `make:model` command:

```bash
node ace make:model User
# CREATE: app/models/user.ts
```

## Model structure

A Lucid model is a class that extends the auto-generated schema class. Here's what a newly created User model looks like:

```ts
// title: app/models/user.ts
import { UserSchema } from '#database/schema'

export default class User extends UserSchema {
}
```

Notice the model class is empty. This is intentional. All column definitions, decorators, and type information come from the `UserSchema` class, which is automatically generated in the `database/schema.ts` file when you run migrations.

The generated schema class contains the complete column structure:

```ts
// title: database/schema.ts
export class UserSchema extends BaseModel {
  static $columns = ['id', 'fullName', 'email', 'password', 'createdAt', 'updatedAt'] as const
  $columns = UserSchema.$columns

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare fullName: string | null

  @column()
  declare email: string

  @column({ serializeAs: null })
  declare password: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
```

The schema class is completely auto-generated and regenerated every time you run migrations. You should never edit this file manually, as your changes will be overwritten. Instead, make changes to your migrations and re-run them to update the schema classes.

Your model class inherits all properties and methods from the schema class. You can add your own methods, computed properties, hooks, and business logic directly in the model file. This separation keeps your custom code safe while allowing the framework to manage database schema synchronization.

## Model options

You can customize model behavior using static properties. These properties let you override default conventions when your database structure doesn't follow AdonisJS naming patterns.

### Table name

By default, the model uses the pluralized, snake_case version of the class name as the table name. For example, a `User` model maps to the `users` table. You can override this using the `table` property:

```ts
// title: app/models/user.ts
import { UserSchema } from '#database/schema'

export default class User extends UserSchema {
  static table = 'app_users'
}
```

### Primary key

Models assume the primary key column is named `id`. If your table uses a different primary key column, specify it with the `primaryKey` property:

```ts
// title: app/models/user.ts
import { UserSchema } from '#database/schema'

export default class User extends UserSchema {
  static primaryKey = 'userId'
}
```

### Database connection

When working with multiple database connections, you can specify which connection a model should use with the `connection` property:

```ts
// title: app/models/analytics_event.ts
import { AnalyticsEventSchema } from '#database/schema'

export default class AnalyticsEvent extends AnalyticsEventSchema {
  static connection = 'analytics'
}
```

### Self-assigned primary keys

By default, AdonisJS expects the database to auto-generate primary key values (auto-increment). If your application generates primary keys (such as UUIDs), set `selfAssignPrimaryKey` to `true`:

```ts
// title: app/models/user.ts
import { UserSchema } from '#database/schema'

export default class User extends UserSchema {
  static selfAssignPrimaryKey = true
}
```

## Verifying your model

After creating a model, you can verify it works by importing it and running a simple query. The schema class must exist in `database/schema.ts` for the import to succeed.

```ts
import User from '#models/user'

const users = await User.all()
console.log(users)
```

If you see a TypeScript error when importing the model, ensure you have run your migrations. The schema class is only generated after migrations execute successfully.
