# Auto-Generated Schema Classes

This guide covers how Lucid automatically generates schema classes from your database tables. You will learn about the migrations-first philosophy, type mappings, schema rules customization, and model-level overrides.

## Overview

Schema classes are TypeScript classes that Lucid automatically generates by scanning your database tables. Each table gets its own schema class that your models extend, providing type-safe access to database columns without cluttering your models with schema definitions.

This approach represents a fundamental shift from traditional ORMs. Instead of defining schema in models and generating migrations from them, Lucid reverses this flow: you write migrations that create or modify tables, and Lucid generates schema classes that models extend. This migration-first philosophy keeps models clean and focused on business logic while maintaining full TypeScript type safety.

The schema classes are regenerated automatically whenever you run migrations, ensuring your models always stay in sync with your actual database structure.

## The migrations-first philosophy

Traditional ORMs like TypeORM and Sequelize follow a models-first approach where you define your database schema within model classes or schema files, then generate migrations from those definitions. While convenient for greenfield projects, this approach has significant limitations:

**Models become cluttered with database concerns.** Your model files mix business logic with schema definitions, column types, constraints, and database-specific configuration. This creates visual noise and makes models harder to understand.

**Automatic migrations are limited.** When the ORM generates migrations automatically, it can only handle simple changes. Complex refactors like renaming a column while preserving data, splitting a table into two tables, or moving data between columns require manual intervention. The ORM's generated migration often becomes a starting point that you must modify anyway.

**Existing databases are difficult to integrate.** Projects with existing databases that don't have migration history face challenges. You must either manually recreate the entire migration history or work without migrations altogether.

Lucid solves these problems by reversing the relationship between migrations and models:

**Migrations are hand-written and expressive.** You write migrations manually using Lucid's schema builder, which means you can handle any database operation. This includes renaming columns, transforming data, creating complex indexes, or performing multi-step refactors. Migrations become the source of truth for your database schema.

**Models extend generated schema classes.** After you run migrations, Lucid scans your database tables and generates schema classes with proper TypeScript types for each column. Your models extend these schema classes, inheriting all column definitions automatically.

**Models stay clean and focused.** Your model files are empty classes by default, containing only relationships, business logic, hooks, and custom methods. There's no visual clutter from column definitions or database configuration.

**Existing databases work seamlessly.** Projects with existing databases can use Lucid without any migration history. Just run `schema:generate` to create schema classes from your existing tables, and your models immediately have type-safe access to all columns.

This philosophy makes Lucid particularly well-suited for complex applications, legacy database integration, and teams that value explicit control over their database schema.

## Basic workflow

Let's walk through the complete workflow of creating a table, generating its schema class, and using it in a model.

### Step 1: Create a migration

First, create a migration that defines your database table structure:

```ts
// title: database/migrations/1703001234567_create_posts_table.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'posts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('title').notNullable()
      table.text('content').notNullable()
      
      /**
       * Timestamp columns are created without timezone information.
       * Lucid will convert these to Luxon DateTime objects automatically.
       */
      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
```

### Step 2: Run the migration

Execute your migration using the Ace command.

```bash
node ace migration:run
```

When the migration completes successfully, you'll see output confirming both the migration execution and schema generation.

```bash
❯ Executed 1703001234567_create_posts_table migration
✔ Generated schema classes
```

Lucid automatically regenerates the `database/schema.ts` file after running migrations, ensuring your schema classes always match your database structure.

:::note
If you are not running migrations using AdonisJS, then you may run `node ace schema:generate` command to generate the schema classes.
:::

### Step 3: Examine the generated schema class

Open the `database/schema.ts` file to see what Lucid generated. For the posts table, you'll find:

```ts
// title: database/schema.ts
import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export class PostsSchema extends BaseModel {
  static table = 'posts'
  
  /**
   * The $columns property provides a readonly tuple of all column names.
   * This enables TypeScript to provide accurate autocomplete for column references.
   */
  static $columns = ['id', 'title', 'content', 'createdAt', 'updatedAt'] as const
  
  $columns = PostsSchema.$columns

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  @column()
  declare content: string

  /**
   * Timestamp columns are automatically configured with autoCreate.
   * The type includes null because timestamps can be nullable in the database.
   */
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
```

Notice how column names are automatically converted from snake_case (as defined in the migration) to camelCase (as used in TypeScript). This happens automatically and cannot be customized. Lucid always assumes your database uses snake_case conventions.

### Step 4: Create your model

Now create a model that extends the generated schema class:

```ts
// title: app/models/post.ts
import { PostsSchema } from '#database/schema'

export default class Post extends PostsSchema {}
```

That's it. Your model is now a fully functional Lucid model with type-safe access to all columns, complete with TypeScript autocomplete and type checking.

### Step 5: Use your model

You can now use your model throughout your application with full type safety:

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import Post from '#models/post'

export default class PostsController {
  async index({ response }: HttpContext) {
    const posts = await Post.all()
    
    /**
     * TypeScript knows that each post has id, title, content,
     * createdAt, and updatedAt properties with the correct types.
     */
    return response.json(posts)
  }

  async store({ request, response }: HttpContext) {
    /**
     * The create method accepts an object matching the model's columns.
     * TypeScript will error if you provide invalid column names or types.
     */
    const post = await Post.create({
      title: request.input('title'),
      content: request.input('content'),
    })
    
    return response.created(post)
  }
}
```

### What you learned

You now know how to:
- Create migrations that define your database schema
- Generate schema classes automatically by running migrations
- Create models that extend generated schema classes
- Use models with full TypeScript type safety

## Understanding type mappings

Lucid converts database-specific column types into TypeScript types based on an internal mapping system. This mapping handles the nuances of different database systems (PostgreSQL, MySQL, SQLite, MSSQL) and provides consistent TypeScript types regardless of which database you're using.

### Internal type system

Lucid uses an internal type system as an abstraction layer between database-specific types and TypeScript types. When you create a column in a migration, the database returns a specific type name (like `varchar` in PostgreSQL or `nvarchar` in MSSQL). Lucid maps these database types to one of its internal types, which then determine the final TypeScript type.

The internal types you can customize via schema rules are:

| Internal Type | Default TypeScript Type | Description |
|--------------|------------------------|-------------|
| `number` | `number` | Integer and floating-point numbers |
| `bigint` | `number` | Large integers (can be customized to TypeScript `bigint`) |
| `decimal` | `number` | Decimal/numeric types with precision |
| `boolean` | `boolean` | Boolean values |
| `string` | `string` | All text and character types |
| `date` | `DateTime` | Date without time |
| `time` | `string` | Time without date |
| `DateTime` | `DateTime` | Date and time combined |
| `binary` | `Buffer` | Binary data and blobs |
| `json` | `any` | JSON columns |
| `jsonb` | `any` | PostgreSQL JSONB columns |
| `uuid` | `string` | UUID/GUID identifiers |
| `enum` | `string` | Enumerated types |
| `set` | `string` | MySQL SET types |
| `unknown` | `unknown` | Unrecognized or complex types |

### Database type to internal type mapping

Different databases use different names for similar column types. Lucid normalizes these into internal types. Here's the complete mapping for all supported databases:

#### Numeric types

| Database Type | Internal Type | TypeScript Type | Notes |
|--------------|---------------|-----------------|-------|
| `smallint`, `integer`, `int` | `number` | `number` | Standard integers |
| `bigint`, `unsigned big int` | `bigint` | `number` | Large integers, default to number |
| `decimal`, `numeric`, `money` | `decimal` | `number` | Precise decimal values |
| `real`, `double`, `float` | `number` | `number` | Floating-point numbers |
| `tinyint` | `boolean` | `boolean` | MySQL uses tinyint(1) for booleans |
| `mediumint` | `number` | `number` | MySQL medium integers |
| `smallmoney` | `decimal` | `number` | MSSQL currency type |
| `smallserial`, `serial` | `number` | `number` | PostgreSQL auto-increment |
| `bigserial` | `bigint` | `number` | PostgreSQL large auto-increment |

#### Boolean types

| Database Type | Internal Type | TypeScript Type |
|--------------|---------------|-----------------|
| `boolean`, `bool` | `boolean` | `boolean` |
| `mssql.bit` | `boolean` | `boolean` |

#### Text types

| Database Type | Internal Type | TypeScript Type | Notes |
|--------------|---------------|-----------------|-------|
| `char`, `varchar`, `text` | `string` | `string` | Standard text types |
| `character`, `character varying` | `string` | `string` | PostgreSQL variants |
| `tinytext`, `mediumtext`, `longtext` | `string` | `string` | MySQL text sizes |
| `nchar`, `nvarchar`, `clob` | `string` | `string` | SQLite text types |
| `ntext`, `sysname` | `string` | `string` | MSSQL text types |
| `xml` | `string` | `string` | XML stored as string |

#### Date and time types

| Database Type | Internal Type | TypeScript Type | Notes |
|--------------|---------------|-----------------|-------|
| `date` | `date` | `DateTime` | Date only |
| `time` | `time` | `string` | Time only |
| `datetime`, `timestamp` | `DateTime` | `DateTime` | Combined date and time |
| `timestamp without time zone` | `DateTime` | `DateTime` | PostgreSQL |
| `timestamp with time zone` | `DateTime` | `DateTime` | PostgreSQL with timezone |
| `smalldatetime`, `datetime2` | `DateTime` | `DateTime` | MSSQL variants |
| `datetimeoffset` | `DateTime` | `DateTime` | MSSQL with timezone |
| `interval` | `string` | `string` | PostgreSQL intervals |
| `year` | `number` | `number` | MySQL year type |

#### Binary types

| Database Type | Internal Type | TypeScript Type |
|--------------|---------------|-----------------|
| `bytea`, `blob` | `binary` | `Buffer` |
| `tinyblob`, `mediumblob`, `longblob` | `binary` | `Buffer` |
| `binary`, `varbinary` | `binary` | `Buffer` |
| `image`, `rowversion` | `binary` | `Buffer` |

#### JSON types

| Database Type | Internal Type | TypeScript Type | Notes |
|--------------|---------------|-----------------|-------|
| `json` | `json` | `any` | Flexible JSON storage |
| `jsonb` | `jsonb` | `any` | PostgreSQL binary JSON |

#### UUID types

| Database Type | Internal Type | TypeScript Type |
|--------------|---------------|-----------------|
| `uuid` | `uuid` | `string` |
| `uniqueidentifier` | `uuid` | `string` |

#### Enum and set types

| Database Type | Internal Type | TypeScript Type |
|--------------|---------------|-----------------|
| `enum` | `enum` | `string` |
| `set` | `set` | `string` |

#### Special PostgreSQL types

| Database Type | Internal Type | TypeScript Type | Notes |
|--------------|---------------|-----------------|-------|
| `inet`, `cidr`, `macaddr` | `string` | `string` | Network addresses |
| `tsvector`, `tsquery` | `string` | `string` | Full-text search |
| `bit`, `bit varying` | `string` | `string` | Bit strings |
| `hstore` | `unknown` | `unknown` | Key-value store |
| Range types (`int4range`, etc.) | `unknown` | `unknown` | Range types |
| Geometry types | `string` or `unknown` | Various | GIS types |

For the complete, up-to-date mapping of all database types, see the [source code on GitHub](https://github.com/adonisjs/lucid/blob/22.x/src/orm/schema_generator/mappings.ts).

### How type mapping works

When Lucid generates schema classes, it follows this process:

1. **Scan the database:** Lucid queries your database's information schema to get a list of all tables and their columns.

2. **Map database types to internal types:** For each column, Lucid looks up the database-specific type (like `varchar` or `timestamp`) in the `DATA_TYPES_MAPPING` and converts it to an internal type (like `string` or `DateTime`).

3. **Apply schema rules (if configured):** If you've defined schema rules in `database/schema_rules.ts`, Lucid applies any custom type mappings or decorators for specific internal types, tables, or columns.

4. **Generate TypeScript code:** Lucid generates the schema class with `@column` decorators and TypeScript type annotations based on the final type mappings.

5. **Write to schema.ts:** All schema classes are written to a single `database/schema.ts` file that your models can import from.

## Working with common data types

While Lucid provides sensible defaults for all database types, certain types deserve special attention due to their complexity or database-specific nuances.

### Enums

Database-native enums present several challenges that make them impractical for most applications:

**SQLite doesn't support enums.** SQLite uses `CHECK` constraints to simulate enum behavior, which means enum-based code won't be portable across databases.

**PostgreSQL stores enums separately.** PostgreSQL treats enums as custom database types that require additional queries to create and manage. This adds complexity to your migrations.

**Enums are inflexible.** Adding or renaming enum values in production databases is difficult and often requires downtime. Some databases don't support renaming enum values at all.

For these reasons, Lucid converts database enum columns to TypeScript `string` types by default. Instead of using database-native enums, we recommend storing integer values in the database and mapping them to meaningful constants in your application code:

```ts
// title: database/migrations/xxxx_create_posts_table.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'posts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('title')
      
      /**
       * Store status as a tiny integer instead of an enum.
       * This gives you flexibility to add/change values without database migrations.
       */
      table.integer('status').unsigned().notNullable().defaultTo(0)
      
      table.timestamps(true, true)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
```

Then define the status mapping in your application:

```ts
// title: app/models/post.ts
import { PostsSchema } from '#database/schema'

/**
 * PostStatus object serves as both a runtime value holder
 * and the basis for the PostStatus type.
 */
export const PostStatus = {
  DRAFT: 0,
  PUBLISHED: 1,
  ARCHIVED: 2,
} as const

export type PostStatus = (typeof PostStatus)[keyof typeof PostStatus]

export default class Post extends PostsSchema {
  get isDraft() {
    return this.status === PostStatus.DRAFT
  }
  
  get isPublished() {
    return this.status === PostStatus.PUBLISHED
  }
}
```

You can now use `PostStatus` as both a value and a type throughout your application:

```ts
const post = new Post()
post.status = PostStatus.DRAFT
```

If you still prefer to use enum columns for specific use cases, you can customize their TypeScript type using schema rules (covered later in this guide).

### JSON columns

JSON columns are mapped to TypeScript's `any` type by default. This provides maximum flexibility (you can store any JSON-serializable value without TypeScript complaining) but you lose type safety.

```ts
// title: database/migrations/xxxx_create_posts_table.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'posts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('title')
      
      /**
       * JSON columns are perfect for flexible, semi-structured data
       * like post metadata, user preferences, or feature flags.
       */
      table.json('metadata')
      
      table.timestamps(true, true)
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
```

The generated schema class will have:

```ts
@column()
declare metadata: any
```

For better type safety, you can override the column type at the model level with a more specific interface. This approach is covered in detail in the "Model-level overrides" section below.

The difference between `json` and `jsonb` in PostgreSQL is primarily about storage format and performance. Both map to `any` in TypeScript by default. Use `jsonb` for better query performance and indexing capabilities, and use `json` when you need to preserve exact JSON formatting including whitespace and key ordering.

### Dates and timestamps

Lucid converts all date and timestamp columns to Luxon's `DateTime` class, providing a powerful API for working with dates in JavaScript:

```ts
// title: database/migrations/xxxx_create_posts_table.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'posts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('title')
      
      /**
       * Date columns store only the date (no time component).
       */
      table.date('published_on')
      
      /**
       * Timestamp columns store both date and time.
       * These are automatically converted to DateTime objects.
       */
      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
```

The generated schema class provides:

```ts
@column.date()
declare publishedOn: DateTime | null

@column.dateTime({ autoCreate: true })
declare createdAt: DateTime | null

@column.dateTime({ autoCreate: true, autoUpdate: true })
declare updatedAt: DateTime | null
```

DateTime columns marked with `autoCreate: true` are automatically set to the current timestamp when you create a new record. Columns with `autoUpdate: true` are updated to the current timestamp whenever you save changes to the model.

You can work with these DateTime objects using Luxon's full API:

```ts
const post = await Post.find(1)

// Format dates for display
console.log(post.createdAt.toFormat('yyyy-MM-dd'))

// Perform date arithmetic
const daysSinceCreated = DateTime.now().diff(post.createdAt, 'days').days

// Compare dates
if (post.publishedOn > DateTime.now()) {
  console.log('This post is scheduled for future publication')
}
```

## Customizing types with schema rules

Schema rules allow you to customize how Lucid generates schema classes. You define rules in the `database/schema_rules.ts` file, which Lucid reads during schema generation. Rules can target specific internal types globally, specific tables, or individual columns within tables.

The schema rules file is already created for you when you set up Lucid. If it doesn't exist, create it manually:

```ts
// title: database/schema_rules.ts
import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

export default {
  types: {},
  tables: {},
} satisfies SchemaRules
```

### Structure of schema rules

Schema rules have two main sections:

The `types` section defines global rules for internal types. Any column that maps to one of these internal types will use your custom configuration unless overridden by a more specific rule.

The `tables` section defines rules for specific tables and columns. These rules take precedence over global type rules, allowing fine-grained control.

```ts
// title: database/schema_rules.ts
import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

export default {
  /**
   * Global type rules apply to all columns of a given internal type
   * across all tables, unless overridden by table-specific rules.
   */
  types: {
    // Rules for internal types like 'json', 'bigint', 'enum', etc.
  },
  
  /**
   * Table-specific rules target individual tables and columns,
   * providing the most precise control over type generation.
   */
  tables: {
    // Rules for specific tables and their columns
  },
} satisfies SchemaRules
```

### Global type rules

Global type rules modify how all columns of a specific internal type are generated. This is useful when you want consistent behavior across your entire application.

For example, to change all JSON columns to use a custom `JSON` type wrapper:

```ts
// title: database/schema_rules.ts
import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

export default {
  types: {
    /**
     * Customize all JSON columns globally to use a type-safe JSON wrapper
     * instead of the default 'any' type.
     */
    json: {
      decorator: '@column()',
      tsType: 'JSON<any>',
      imports: [
        {
          source: '#types/db',
          typeImports: ['JSON'],
        },
      ],
    },
  },
  tables: {},
} satisfies SchemaRules
```

After defining this rule, all JSON columns across all tables will be generated as:

```ts
@column()
declare metadata: JSON<any>
```

You'll need to create the `JSON` type wrapper that this rule references:

```ts
// title: types/db.ts
/**
 * Type-safe wrapper for JSON columns that preserves the generic parameter
 * while ensuring JSON-serializable values at runtime.
 */
export type JSON<T> = T
```

### Table-specific column rules

Table-specific rules give you precise control over individual columns. These rules override any global type rules for those specific columns.

For example, to map a `role` column to a TypeScript union type:

```ts
// title: database/schema_rules.ts
import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

export default {
  types: {},
  tables: {
    /**
     * Customize the users table to make the role column
     * a strict union type instead of a generic string.
     */
    users: {
      columns: {
        role: {
          decorator: '@column()',
          tsType: `'admin' | 'moderator' | 'user'`,
        },
      },
    },
  },
} satisfies SchemaRules
```

This generates:

```ts
@column()
declare role: 'admin' | 'moderator' | 'user'
```

Now TypeScript will enforce that the `role` property can only be one of these three values.

### Combining global and table rules

You can use both global type rules and table-specific column rules together. Table rules always take precedence:

```ts
// title: database/schema_rules.ts
import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

export default {
  types: {
    /**
     * Global rule: All JSON columns use JSON<any> by default.
     */
    json: {
      decorator: '@column()',
      tsType: 'JSON<any>',
      imports: [
        {
          source: '#types/db',
          typeImports: ['JSON'],
        },
      ],
    },
    
    /**
     * Global rule: All bigint columns use TypeScript bigint instead of number.
     */
    bigint: {
      decorator: '@column.bigInteger()',
      tsType: 'bigint',
    },
  },
  tables: {
    posts: {
      columns: {
        /**
         * Table-specific rule: The posts.metadata column has a specific shape
         * that overrides the global JSON<any> type.
         */
        metadata: {
          decorator: '@column()',
          tsType: 'JSON<{ title?: string; description?: string; ogImage?: string }>',
          imports: [
            {
              source: '#types/db',
              typeImports: ['JSON'],
            },
          ],
        },
      },
    },
  },
} satisfies SchemaRules
```

With these rules:
- All JSON columns will use `JSON<any>` except `posts.metadata`
- The `posts.metadata` column will use the specific type shape defined in the table rule
- All bigint columns will use TypeScript `bigint` across all tables

### When to regenerate schemas

Schema rules are applied when Lucid generates schema classes. After modifying your schema rules file, you need to regenerate the schemas:

```bash
node ace schema:generate
```

The schemas are also regenerated automatically whenever you run migrations:

```bash
node ace migration:run
```

Or rollback migrations:

```bash
node ace migration:rollback
```

## Model-level overrides

While schema rules customize how Lucid generates schema classes, sometimes you need to override specific columns at the model level. This is useful when you want different type definitions for the same column in different models, or when you need to add custom logic to a column accessor.

Model-level overrides work by re-declaring the column property in your model class. The TypeScript type system ensures that your override is compatible with the base schema class type.

### Overriding JSON columns

The most common use case for model overrides is refining generic JSON columns to specific interfaces:

```ts
// title: app/models/post.ts
import type { JSON } from '#types/db'
import { PostsSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'

export default class Post extends PostsSchema {
  /**
   * Override the metadata column from the schema class to provide
   * a specific type shape instead of the generic JSON<any>.
   * 
   * The @column decorator must match the schema class decorator.
   * The type can be more specific but must remain compatible.
   */
  @column()
  declare metadata: JSON<Partial<{
    title: string
    description: string
    ogImage: string
    keywords: string[]
  }>>
}
```

Now when you access `post.metadata`, TypeScript knows the exact shape:

```ts
const post = await Post.find(1)

/**
 * TypeScript provides autocomplete for these properties
 * and ensures you handle the Partial<...> correctly.
 */
if (post.metadata?.title) {
  console.log(`SEO Title: ${post.metadata.title}`)
}
```

### Type compatibility constraints

TypeScript enforces type compatibility when you override properties. You can make a type more specific, but you cannot change it to an incompatible type:

```ts
// ✅ Valid: string can be narrowed to a union type
@column()
declare status: 'draft' | 'published'  // Schema class has: string

// ✅ Valid: any can be narrowed to a specific type
@column()
declare metadata: JSON<{ title: string }>  // Schema class has: any

// ❌ Invalid: cannot change string to number
@column()
declare title: number  // Schema class has: string - TypeScript error!

// ❌ Invalid: cannot change number to string
@column()
declare id: string  // Schema class has: number - TypeScript error!
```

If you need to change a column's type fundamentally (like converting `string` to `number`), you must use schema rules instead. Schema rules generate the initial type, which models can then refine but not contradict.

### Combining schema rules and model overrides

The most flexible approach combines both techniques: use schema rules for global type changes, and use model overrides for model-specific refinements.

For example, configure all JSON columns to use `JSON<any>` globally:

```ts
// title: database/schema_rules.ts
import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

export default {
  types: {
    json: {
      decorator: '@column()',
      tsType: 'JSON<any>',
      imports: [
        {
          source: '#types/db',
          typeImports: ['JSON'],
        },
      ],
    },
  },
  tables: {},
} satisfies SchemaRules
```

Then refine specific JSON columns in individual models:

```ts
// title: app/models/post.ts
import type { JSON } from '#types/db'
import { PostsSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'

export default class Post extends PostsSchema {
  @column()
  declare metadata: JSON<{
    seo?: { title: string; description: string }
    social?: { ogImage: string; twitterCard: string }
  }>
}
```

```ts
// title: app/models/user.ts
import type { JSON } from '#types/db'
import { UsersSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'

export default class User extends UsersSchema {
  @column()
  declare preferences: JSON<{
    theme: 'light' | 'dark'
    notifications: boolean
    language: string
  }>
}
```

This approach keeps your schema rules simple and maintainable while giving each model the type specificity it needs.

## Configuration

Schema generation is controlled through your database connection configuration. By default, schema generation is enabled for all connections, but you can customize this behavior in your database config file:

```ts
// title: config/database.ts
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: env.get('DB_CONNECTION'),
  connections: {
    postgres: {
      client: 'pg',
      connection: {
        host: env.get('PG_HOST'),
        port: env.get('PG_PORT'),
        user: env.get('PG_USER'),
        password: env.get('PG_PASSWORD'),
        database: env.get('PG_DB_NAME'),
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
      /**
       * Enable or disable schema generation for this connection.
       * When enabled, schemas are regenerated after running migrations.
       */
      schemaGeneration: {
        enabled: true,
      },
    },
  },
})

export default dbConfig
```

The `schemaGeneration` option accepts:
- `{ enabled: true }` - Schemas are generated automatically (default)
- `{ enabled: false }` - Schema generation is disabled for this connection

Disabling schema generation can be useful in specific scenarios:
- Working with very large databases where schema generation is slow
- Using a shared database where you don't control the schema
- Temporarily disabling generation during development

When schema generation is disabled, you can still generate schemas manually using the `schema:generate` command whenever you need to update them.
