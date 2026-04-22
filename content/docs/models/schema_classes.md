---
summary: How Lucid generates schema classes from your database, the TypeScript types each database column maps to, schema rules for type customization, and model-level column overrides.
---

# Schema classes

This guide covers how models consume the schema classes Lucid generates from your database. You will learn how to:

- Read and understand a generated schema class
- Know what TypeScript type each database column produces
- Handle common types where the default mapping needs care (enums, JSON, dates, primary keys)
- Customize generated types globally or per table with schema rules
- Override columns on the model class with specific types, accessors, and read/write hooks

For the generation workflow itself (when `schema:generate` runs, adopting legacy databases, committing the generated file) see the [schema generation guide](../migrations/schema_generation.md). For the migrations-first philosophy, see the [introduction](../guides/introduction.md#the-database-is-the-source-of-truth).

## Anatomy of a generated schema class

When migrations run, Lucid writes one class per table to `database/schema.ts`. Each class extends `BaseModel`, declares a `static table`, exposes a readonly `$columns` tuple of column names, and declares every column with the appropriate `@column` decorator.

```ts
// title: database/schema.ts
import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export class PostsSchema extends BaseModel {
  static table = 'posts'

  static $columns = ['id', 'title', 'content', 'createdAt', 'updatedAt'] as const
  $columns = PostsSchema.$columns

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare title: string

  @column()
  declare content: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
```

A few things worth knowing about the generated output:

- Column names are converted from snake_case to camelCase. `created_at` in the database becomes `createdAt` on the model, with `columnName: 'created_at'` recorded internally so queries address the correct column.
- The `static $columns` tuple drives autocomplete. Methods like `query().select(...)` use this tuple to offer type-safe column name completion.
- Primary key columns are detected from the database and decorated with `@column({ isPrimary: true })`.
- Date and datetime columns use the `@column.date` and `@column.dateTime` decorators rather than the plain `@column`. Both return Luxon `DateTime` instances.

You never edit `database/schema.ts` directly. The file is overwritten on every generation; customize through [schema rules](#customizing-types-with-schema-rules) or [model-level overrides](#overriding-columns-on-the-model).

Your model extends the generated class and adds behavior.

```ts
// title: app/models/post.ts
import { PostsSchema } from '#database/schema'

export default class Post extends PostsSchema {}
```

## Column type reference

Lucid converts database-specific column types into TypeScript types through an internal mapping. The database driver reports the native column type (like `varchar` or `int4`), Lucid maps it to an internal category (like `string` or `number`), and the internal category determines the final TypeScript type.

The internal type is also the key you target when [customizing types with schema rules](#customizing-types-with-schema-rules).

### Internal types

| Internal type | Default TypeScript type | Description |
| --- | --- | --- |
| `number` | `number` | Integer and floating-point columns |
| `bigint` | `bigint \| number` | Large integers. The union default covers both drivers that return bigints as JavaScript `number` (when the value fits) and as `bigint` (when it does not). Override with a schema rule if your driver is consistent. |
| `decimal` | `string` | Decimal types with precision. Defaults to `string` to preserve exact precision; override to `number` when application-side precision loss is acceptable. |
| `boolean` | `boolean` | Boolean columns |
| `string` | `string` | All text and character types |
| `date` | `DateTime` | Date without time. Uses the `@column.date` decorator. |
| `time` | `string` | Time without date |
| `DateTime` | `DateTime` | Combined date and time. Uses the `@column.dateTime` decorator. |
| `binary` | `Buffer` | Binary and blob columns |
| `json` | `any` | JSON columns |
| `jsonb` | `any` | PostgreSQL JSONB columns |
| `uuid` | `string` | UUID and GUID columns |
| `enum` | `string` | Enumerated types |
| `set` | `string` | MySQL SET types |
| `unknown` | `any` | Types Lucid does not recognize. Falls back to `any` so the column is usable without requiring manual casts. |

### Database type to internal type

The tables below list the concrete database types Lucid recognizes and how they map. For anything not listed, Lucid falls back to `unknown`.

**Numeric types**

| Database type | Internal type | Notes |
| --- | --- | --- |
| `smallint`, `integer`, `int` | `number` | Standard integers |
| `bigint`, `unsigned big int` | `bigint` | Large integers |
| `decimal`, `numeric`, `money` | `decimal` | Precise decimals |
| `real`, `double`, `double precision`, `float` | `number` | Floating-point |
| `tinyint` | `boolean` | MySQL convention for booleans |
| `mediumint` | `number` | MySQL medium integer |
| `smallmoney` | `decimal` | MSSQL currency |
| `smallserial`, `serial` | `number` | PostgreSQL auto-increment |
| `bigserial` | `bigint` | PostgreSQL large auto-increment |
| `int2`, `int4` | `number` | PostgreSQL integer aliases |
| `int8` | `bigint` | PostgreSQL bigint alias |
| `float4`, `float8` | `number` | PostgreSQL floating-point aliases |
| `oid` | `number` | PostgreSQL object identifier |
| `year` | `number` | MySQL year type |

**Boolean types**

| Database type | Internal type |
| --- | --- |
| `boolean`, `bool` | `boolean` |
| `bit` (MSSQL) | `boolean` |

**Text types**

| Database type | Internal type | Notes |
| --- | --- | --- |
| `char`, `varchar`, `text` | `string` | Standard text |
| `character`, `character varying` | `string` | PostgreSQL variants |
| `tinytext`, `mediumtext`, `longtext` | `string` | MySQL text sizes |
| `nchar`, `nvarchar`, `clob` | `string` | Other dialects |
| `ntext`, `sysname` | `string` | MSSQL text |
| `xml` | `string` | XML stored as text |

**Date and time types**

| Database type | Internal type | Notes |
| --- | --- | --- |
| `date` | `date` | Date only |
| `time` | `time` | Time only, mapped to `string` |
| `time without time zone`, `time with time zone` | `time` | PostgreSQL time variants |
| `datetime`, `timestamp` | `DateTime` | Combined date and time |
| `timestamp without time zone` | `DateTime` | PostgreSQL |
| `timestamp with time zone` | `DateTime` | PostgreSQL with timezone |
| `smalldatetime`, `datetime2` | `DateTime` | MSSQL variants |
| `datetimeoffset` | `DateTime` | MSSQL with timezone |
| `interval` | `string` | PostgreSQL intervals stored as strings |

**Binary types**

| Database type | Internal type |
| --- | --- |
| `bytea`, `blob` | `binary` |
| `tinyblob`, `mediumblob`, `longblob` | `binary` |
| `binary`, `varbinary` | `binary` |
| `image`, `rowversion` | `binary` |

**JSON types**

| Database type | Internal type |
| --- | --- |
| `json` | `json` |
| `jsonb` | `jsonb` |

**UUID types**

| Database type | Internal type |
| --- | --- |
| `uuid` | `uuid` |
| `uniqueidentifier` | `uuid` |

**Enum and set types**

| Database type | Internal type |
| --- | --- |
| `enum` | `enum` |
| `set` | `set` |

**PostgreSQL specialized types**

| Database type | Internal type | Notes |
| --- | --- | --- |
| `inet`, `cidr`, `macaddr`, `macaddr8` | `string` | Network addresses |
| `tsvector`, `tsquery` | `string` | Full-text search |
| `bit`, `bit varying` | `string` | Bit strings |
| `hstore` | `unknown` | Key-value store |
| `int4range`, `int8range`, `numrange`, `tsrange`, `tstzrange`, `daterange` | `unknown` | Range types |
| `int4multirange`, `int8multirange`, `nummultirange`, `tsmultirange`, `tstzmultirange`, `datemultirange` | `unknown` | Multirange types (PostgreSQL 14+) |
| `pg_lsn`, `name`, `pg_snapshot`, `txid_snapshot` | `string` | Special identifier types |
| `regclass`, `regproc`, `regprocedure`, `regoper`, `regoperator`, `regtype`, `regrole`, `regnamespace` | `string` | Object identifier types |
| `point` | `string` | Point geometry |
| `line`, `lseg`, `box`, `path`, `polygon`, `circle` | `string` | Geometric shapes |
| `multipoint`, `multilinestring`, `multipolygon`, `geometrycollection` | `string` | Geometry collections |
| `geometry`, `geography` | `unknown` | Untyped spatial |

**MSSQL specialized types**

| Database type | Internal type |
| --- | --- |
| `hierarchyid` | `string` |
| `sql_variant` | `unknown` |

**SQLite type affinity variants**

SQLite returns types in uppercase, mapped alongside the standard lowercase variants:

| Database type | Internal type |
| --- | --- |
| `INTEGER` | `number` |
| `REAL` | `number` |
| `TEXT` | `string` |
| `BLOB` | `binary` |
| `NUMERIC` | `number` |

For the complete up-to-date mapping including dialect-specific quirks, see the [mappings source on GitHub](https://github.com/adonisjs/lucid/blob/22.x/src/orm/schema_generator/mappings.ts).

### Dialect-qualified type lookup

Before consulting the generic mapping, the generator first looks for `{dialect}.{columnType}`. This lets a type mean different things across dialects. For example, `bit` is a bit string on PostgreSQL (maps to `string`), but `mssql.bit` is a 1-bit boolean on SQL Server (maps to `boolean`). Users rarely interact with this directly; it matters only when you define a schema rule that needs to target a specific dialect's interpretation of a type.

### Nullability and column order

Two conventions are applied to every generated class:

- **Nullability.** When a database column is nullable and is not the primary key, Lucid appends `| null` to the TypeScript type. Primary keys never receive the `| null` suffix regardless of their database nullability.
- **Column order.** Columns are sorted alphabetically by property name in the generated class. The order does not reflect the table's physical column order.

### Identifiers that are not valid JavaScript

When a column name starts with a character that is not a valid JavaScript identifier (for example, a digit like `2fa_secret`), the generator prefixes the property name with an underscore (`_2fa_secret`) and records the original column name in the decorator's `columnName` argument so queries still address the correct column.

```ts
@column({ columnName: '2fa_secret' })
declare _2fa_secret: string | null
```

## Working with common data types

Most types work without additional configuration. The types below need a note because they either require a design decision (enums, JSON) or produce richer runtime objects (dates, primary keys).

### Enums

Database-native enum types are often a poor fit for application data for three reasons:

- SQLite does not support enums. Enum-based migrations are not portable across dialects.
- PostgreSQL stores enums as separate types, which adds migration overhead.
- Adding, removing, or renaming enum values in production usually requires a table rewrite or manual SQL, and some dialects disallow some of these operations entirely.

Lucid maps database enum columns to TypeScript `string` by default. The recommended pattern is to store the value as an integer (or a short string) and define the semantics in application code.

```ts
// title: database/migrations/xxxx_create_posts_table.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('posts', (table) => {
      table.increments('id')
      table.string('title').notNullable()
      table.integer('status').unsigned().notNullable().defaultTo(0)
      table.timestamps(true, true)
    })
  }
}
```

```ts
// title: app/models/post.ts
import { PostsSchema } from '#database/schema'

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

`PostStatus` doubles as both a runtime value object and a TypeScript type. You can use it as either in the same file.

If you still prefer native enums, customize the generated column type with a [schema rule](#customizing-types-with-schema-rules) to produce a strict union type.

### JSON columns

JSON and JSONB columns map to TypeScript `any` by default. You get maximum flexibility at the cost of type safety.

```ts
@column()
declare metadata: any
```

Two paths tighten this type.

The first is a schema rule that applies to every JSON column across your application.

```ts
// title: database/schema_rules.ts
import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

export default {
  types: {
    json: {
      tsType: 'JSON<any>',
      decorators: [{ name: '@column' }],
      imports: [
        { source: '#types/db', typeImports: ['JSON'] },
      ],
    },
  },
  tables: {},
} satisfies SchemaRules
```

```ts
// title: types/db.ts
export type JSON<T> = T
```

The second is a [model-level override](#overriding-columns-on-the-model) for one specific column.

```ts
// title: app/models/post.ts
import type { JSON } from '#types/db'
import { column } from '@adonisjs/lucid/orm'
import { PostsSchema } from '#database/schema'

export default class Post extends PostsSchema {
  @column()
  declare metadata: JSON<{ seoTitle?: string; keywords?: string[] }>
}
```

Both approaches can be used together. See [Combining global and table rules](#combining-global-and-table-rules) below.

The difference between `json` and `jsonb` in PostgreSQL is runtime: `jsonb` is indexable and slightly faster to query, while `json` preserves exact input formatting. Both map to `any` in TypeScript by default, and rules target them as separate internal types (`json` vs `jsonb`), so you can treat them the same or differently.

### Dates and timestamps

Every date and timestamp column maps to a Luxon `DateTime` instance, so dates have a full API available rather than being raw strings.

```ts
// title: app/models/post.ts
import { PostsSchema } from '#database/schema'

const post = await Post.findOrFail(params.id)

post.createdAt.toFormat('yyyy-MM-dd')

const daysSinceCreated = DateTime.now().diff(post.createdAt, 'days').days

if (post.publishedOn && post.publishedOn > DateTime.now()) {
  // scheduled for later
}
```

The generated schema class uses `@column.date` for date columns and `@column.dateTime` for datetime and timestamp columns. The two decorators are functionally identical in the current release and accept the same options.

Timestamp columns created with `table.timestamps(true, true)` are annotated with `autoCreate` and `autoUpdate`, which tell Lucid to set them automatically on insert and update respectively.

```ts
@column.dateTime({ autoCreate: true })
declare createdAt: DateTime | null

@column.dateTime({ autoCreate: true, autoUpdate: true })
declare updatedAt: DateTime | null
```

### Primary keys

Lucid detects the primary key column from the database when it generates schema classes. The column, whatever its name, is decorated with `@column({ isPrimary: true })` and its type matches whatever the database column's type is (integer, string, UUID).

```ts
// title: database/migrations/xxxx_create_oauth_states_table.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('oauth_states', (table) => {
      table.string('key').notNullable().primary()
      table.text('value').notNullable()
      table.timestamp('updated_at')
    })
  }
}
```

```ts
// title: database/schema.ts (generated)
export class OauthStatesSchema extends BaseModel {
  static table = 'oauth_states'

  @column({ isPrimary: true })
  declare key: string

  @column()
  declare value: string

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
```

When your primary key is not named `id`, also set `static primaryKey` on your application model so relationships and default finders use the right column.

```ts
// title: app/models/oauth_state.ts
import { OauthStatesSchema } from '#database/schema'

export default class OauthState extends OauthStatesSchema {
  static primaryKey = 'key'
}
```

Lucid models support only a single primary key. When a table has a composite primary key, Lucid uses the first column. To customize the decision, use the [custom primary key detection](#customizing-primary-key-detection) rule.

## Customizing types with schema rules

Schema rules let you change how Lucid generates types and decorators without hand-editing `database/schema.ts`. Rules live in a file pointed at by `schemaGeneration.rulesPaths` in your database config (typically `database/schema_rules.ts`) and are loaded automatically by the generator. See the [configuration guide](../guides/configuration.md#schema-generation-config) for the field reference.

A starter rules file looks like this:

```ts
// title: database/schema_rules.ts
import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

export default {
  types: {},
  columns: {},
  tables: {},
} satisfies SchemaRules
```

### Shape of the rules file

The rules file accepts five top-level keys, any of which can be omitted.

<dl>

<dt>

types

</dt>

<dd>

Rules keyed by internal type name (`number`, `bigint`, `decimal`, `string`, `json`, `jsonb`, `uuid`, `enum`, `set`, and the others from the [internal types table](#internal-types)). The rule applies to every column that maps to that internal type across every table.

</dd>

<dt>

columns

</dt>

<dd>

Rules keyed by database column name. The rule applies to every column with that exact name across every table. Lucid's built-in defaults use this to apply `autoCreate` to every `created_at` column and `autoCreate + autoUpdate` to every `updated_at` column.

</dd>

<dt>

tables

</dt>

<dd>

Per-table rules. Each table entry can define its own `types`, `columns`, `skipColumns`, and `primaryKey` that apply only to that table.

</dd>

<dt>

primaryKey

</dt>

<dd>

A function that decides how primary keys are represented for every table. Receives the table name, detected primary key column names, and the full column metadata. See [Customizing primary key detection](#customizing-primary-key-detection).

</dd>

</dl>

### Rule resolution precedence

For each column, the generator walks a five-step lookup in this order and uses the first match:

1. **Table-specific column rule** at `tables[tableName].columns[columnName]`
2. **Table-specific type rule** at `tables[tableName].types[internalType]`
3. **Global column rule** at `columns[columnName]`
4. **Primary key rule** result, when the column is the detected primary key
5. **Global type rule** at `types[internalType]`

More specific rules win over less specific rules. A table column rule overrides a global column rule, which overrides a global type rule.

Rules are applied when the schema file is generated. After changing rules, run `node ace schema:generate` to regenerate, or wait for the next migration command to regenerate automatically.

### Shape of a rule value

Every rule returns a `ColumnInfo` object with three fields:

```ts
type ColumnInfo = {
  tsType: string
  decorators?: { name: string; args?: Record<string, any> }[]
  imports?: ImportInfo[]
}
```

<dl>

<dt>

tsType

</dt>

<dd>

The TypeScript type to declare on the column, as a string (`'number'`, `'string'`, `'JSON<any>'`, `` `'admin' | 'user'` ``).

</dd>

<dt>

decorators

</dt>

<dd>

The decorators to emit above the column. An array of `{ name, args? }` objects where `name` is the decorator name starting with `@column` (for example, `'@column'`, `'@column.date'`, `'@column.dateTime'`) and `args` is an optional object of decorator arguments.

</dd>

<dt>

imports

</dt>

<dd>

Imports the generated file needs so the decorator and type resolve. Each entry is an `ImportInfo` object: `{ source, namedImports?, typeImports?, defaultImport?, defaultTypeImport? }`. Use `namedImports` for runtime values (like `DateTime` from Luxon) and `typeImports` for type-only imports.

</dd>

</dl>

Rules can also be functions that return a `ColumnInfo`. The function receives the database type string (`'varchar'`, `'int4'`, and so on) and returns a rule. Use this when the same internal type needs slightly different handling based on the concrete database type.

```ts
types: {
  string: (dataType) => ({
    tsType: dataType === 'text' ? 'string' : `string`,
    decorators: [{ name: '@column' }],
    imports: [],
  }),
}
```

### Global type rules

A global type rule targets every column that maps to the given internal type.

```ts
// title: database/schema_rules.ts
import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

export default {
  types: {
    json: {
      tsType: 'JSON<any>',
      decorators: [{ name: '@column' }],
      imports: [
        { source: '#types/db', typeImports: ['JSON'] },
      ],
    },
    bigint: {
      tsType: 'bigint',
      decorators: [{ name: '@column' }],
    },
  },
  tables: {},
} satisfies SchemaRules
```

With these rules, every JSON column becomes `JSON<any>`, and every bigint column becomes TypeScript `bigint`.

### Global column rules

Global column rules target every column with a given name across every table. Lucid ships with two built-in global column rules that you inherit by default:

- `created_at` emits `@column.dateTime({ autoCreate: true })`
- `updated_at` emits `@column.dateTime({ autoCreate: true, autoUpdate: true })`

Add your own for columns you use consistently. For example, if every encrypted column in your database is named `ciphertext_*`, a global rule keeps them typed uniformly:

```ts
// title: database/schema_rules.ts
export default {
  columns: {
    deleted_at: {
      tsType: 'DateTime | null',
      decorators: [{ name: '@column.dateTime' }],
      imports: [
        { source: 'luxon', namedImports: ['DateTime'] },
      ],
    },
  },
} satisfies SchemaRules
```

### Table-specific column rules

Column rules target one specific column on one specific table.

```ts
// title: database/schema_rules.ts
export default {
  tables: {
    users: {
      columns: {
        role: {
          tsType: `'admin' | 'moderator' | 'user'`,
          decorators: [{ name: '@column' }],
        },
      },
    },
  },
} satisfies SchemaRules
```

With this rule, `users.role` is generated as:

```ts
@column()
declare role: 'admin' | 'moderator' | 'user'
```

### Table-specific type rules

A per-table type rule overrides a global type rule for one table. Use this when one table treats a type differently from the rest of the application.

```ts
// title: database/schema_rules.ts
export default {
  types: {
    json: {
      tsType: 'JSON<any>',
      decorators: [{ name: '@column' }],
      imports: [
        { source: '#types/db', typeImports: ['JSON'] },
      ],
    },
  },
  tables: {
    audit_events: {
      types: {
        json: {
          tsType: 'Record<string, unknown>',
          decorators: [{ name: '@column' }],
        },
      },
    },
  },
} satisfies SchemaRules
```

JSON columns across the application are typed as `JSON<any>`, but JSON columns inside `audit_events` are typed as `Record<string, unknown>`.

### Skipping columns

To exclude specific columns from the generated schema class (for example, columns managed by a database trigger or a separate tool), list them in `skipColumns` on the table.

```ts
// title: database/schema_rules.ts
export default {
  tables: {
    users: {
      skipColumns: ['search_tsv', 'ltree_path'],
    },
  },
} satisfies SchemaRules
```

The columns are left out of the generated class entirely. Queries through the model will still hit the table, but the columns are invisible to TypeScript and to Lucid's change tracking.

### Combining rules

Rules compose from least specific to most specific. Column rules refine type rules, per-table rules refine global rules, and decorator arguments accumulate.

```ts
// title: database/schema_rules.ts
export default {
  types: {
    json: {
      tsType: 'JSON<any>',
      decorators: [{ name: '@column' }],
      imports: [
        { source: '#types/db', typeImports: ['JSON'] },
      ],
    },
  },
  columns: {
    deleted_at: {
      tsType: 'DateTime | null',
      decorators: [{ name: '@column.dateTime' }],
      imports: [
        { source: 'luxon', namedImports: ['DateTime'] },
      ],
    },
  },
  tables: {
    posts: {
      columns: {
        metadata: {
          tsType: 'JSON<{ title?: string; description?: string; ogImage?: string }>',
          decorators: [{ name: '@column' }],
          imports: [
            { source: '#types/db', typeImports: ['JSON'] },
          ],
        },
      },
    },
  },
} satisfies SchemaRules
```

JSON columns across the application become `JSON<any>`, except `posts.metadata` which uses its specific shape. Every `deleted_at` column becomes a nullable `DateTime` regardless of which table it appears on.

### Customizing primary key detection

By default, Lucid uses the first primary key column returned by the database and applies `@column({ isPrimary: true })` with the TypeScript type inferred from the column's database type (so an `integer` primary key becomes `number` and a `uuid` primary key becomes `string`). Override this with the `primaryKey` function, either globally or per table.

The callback has the following signature:

```ts
type PrimaryKeyRule = (
  tableName: string,
  primaryKeys: string[],
  columns: Record<string, DatabaseColumn>,
) => { columnName: string; columnInfo: ColumnInfo } | undefined
```

`columns` is a map from column name to column metadata. Each entry has the shape:

```ts
type DatabaseColumn = {
  type: string
  nullable: boolean
  defaultValue?: any
  maxLength?: number | null
}
```

Return `undefined` to let Lucid fall back to the default detection for that table.

```ts
// title: database/schema_rules.ts
import { type SchemaRules } from '@adonisjs/lucid/types/schema_generator'

export default {
  primaryKey: (tableName, primaryKeys, columns) => {
    const columnName = primaryKeys[0]
    if (!columnName || !columns[columnName]) {
      return undefined
    }

    return {
      columnName,
      columnInfo: {
        tsType: 'string',
        decorators: [{ name: '@column', args: { isPrimary: true } }],
        imports: [],
      },
    }
  },
} satisfies SchemaRules
```

Table-level `primaryKey` rules override the global rule for that table only.

```ts
// title: database/schema_rules.ts
export default {
  tables: {
    oauth_states: {
      primaryKey: (tableName, primaryKeys, columns) => {
        const columnName = primaryKeys[0]
        if (!columnName || !columns[columnName]) {
          return undefined
        }

        return {
          columnName,
          columnInfo: {
            tsType: 'string',
            decorators: [{ name: '@column', args: { isPrimary: true } }],
            imports: [],
          },
        }
      },
    },
  },
} satisfies SchemaRules
```

:::note
If you define a column rule (under `columns`) for the column that happens to be the primary key, the column rule wins and the `primaryKey` rule is skipped for that column.
:::

## Overriding columns on the model

Schema rules customize what the generator emits. Model-level overrides let an individual model refine or re-declare a column at the TypeScript level, in the model file itself.

Reach for a model override when:

- Only one model needs a type refinement, and a schema rule would be overkill.
- You want custom read or write behavior on a column (via `consume`, `prepare`, or getters and setters) that does not belong in the generated file.
- You want to add extra options to the decorator (`columnName`, `meta`) without editing schema rules.

Override by re-declaring the column on your model with a compatible type.

```ts
// title: app/models/post.ts
import type { JSON } from '#types/db'
import { column } from '@adonisjs/lucid/orm'
import { PostsSchema } from '#database/schema'

export default class Post extends PostsSchema {
  @column()
  declare metadata: JSON<Partial<{
    title: string
    description: string
    ogImage: string
    keywords: string[]
  }>>
}
```

The model inherits the schema class's column definition unless you override it, and the re-declared property shadows the one from the parent.

### The `@column` options reference

The `@column` decorator accepts an options object with the following fields. These apply to the plain `@column()` decorator and the date variants (`@column.date()`, `@column.dateTime()`).

<dl>

<dt>

columnName

</dt>

<dd>

The actual database column name when it cannot be derived from the property name. Rarely needed in generated classes (the generator already records this), but useful on model overrides when you want to rename the property without changing the database.

```ts
@column({ columnName: 'email_address' })
declare email: string
```

</dd>

<dt>

isPrimary

</dt>

<dd>

Marks the column as the primary key. Set by the generator automatically for detected primary keys. Declare explicitly on an override only when the generator could not determine the primary key.

</dd>

<dt>

consume

</dt>

<dd>

A function called when a row is read from the database. Transforms the raw column value into the shape your model uses. Common cases include JSON columns your driver returns as strings, numeric IDs you want as strings, or encrypted values that need decrypting.

```ts
@column({
  consume: (value) => typeof value === 'string' ? JSON.parse(value) : value,
})
declare preferences: Record<string, unknown>
```

The callback receives the raw value, the attribute name, and the model instance.

</dd>

<dt>

prepare

</dt>

<dd>

A function called before the value is sent to the database on insert or update. Inverse of `consume`. Use it to serialize, encrypt, or normalize values before persistence.

```ts
@column({
  prepare: (value) => typeof value === 'object' ? JSON.stringify(value) : value,
})
declare preferences: Record<string, unknown>
```

</dd>

<dt>

meta

</dt>

<dd>

An arbitrary object of metadata to attach to the column. Lucid does not consume this field; use it for your own tooling (custom decorators, form generators, admin panels) that needs extra information per column.

```ts
@column({ meta: { editableInAdmin: false } })
declare internalId: string
```

</dd>

</dl>

### Options specific to date columns

The `@column.date` and `@column.dateTime` decorators accept every `@column` option above, plus two additional fields for automatic timestamping.

<dl>

<dt>

autoCreate

</dt>

<dd>

When `true`, Lucid sets the column to the current `DateTime` when a new row is inserted. Applied by the generator to `created_at` and `updated_at` columns.

```ts
@column.dateTime({ autoCreate: true })
declare createdAt: DateTime | null
```

</dd>

<dt>

autoUpdate

</dt>

<dd>

When `true`, Lucid sets the column to the current `DateTime` whenever the model is saved. Pair with `autoCreate` for `updatedAt`-style columns, or use alone for fields that track the most recent modification without being set on creation.

```ts
@column.dateTime({ autoCreate: true, autoUpdate: true })
declare updatedAt: DateTime | null
```

</dd>

</dl>

### Custom getters and setters for a column

When you need custom read or write behavior beyond what `consume` and `prepare` express, add a TypeScript getter or setter for the column on your model. Lucid still reads and writes the underlying attribute through `$attributes`, so getters and setters wrap that value without replacing Lucid's storage.

The pattern is: declare a private backing field under `$attributes` and expose a getter or setter with the public name.

```ts
// title: app/models/user.ts
import { column } from '@adonisjs/lucid/orm'
import { UsersSchema } from '#database/schema'

export default class User extends UsersSchema {
  @column({ columnName: 'avatar_path' })
  declare avatarPath: string | null

  get avatarUrl(): string | null {
    return this.avatarPath
      ? `https://cdn.example.com/${this.avatarPath}`
      : null
  }
}
```

For write-side transforms that still need to land in a column, `prepare` is usually a better fit since it runs on every insert and update automatically. Reach for a setter when the transform depends on other model properties at the time of assignment.

### Type compatibility constraints

TypeScript enforces that a re-declared property's type is compatible with the base class's type. You can narrow a type, but you cannot change it to an incompatible one.

```ts
// Valid: narrow string to a union type
@column()
declare status: 'draft' | 'published'

// Valid: narrow any to a specific type
@column()
declare metadata: JSON<{ title: string }>

// Invalid: cannot change string to number
@column()
declare title: number

// Invalid: cannot change number to string
@column()
declare id: string
```

When you need to fundamentally change a column's type, use a schema rule to set the correct type at generation time; the model can then further refine the generated type. See [Combining global and table rules](#combining-global-and-table-rules).
