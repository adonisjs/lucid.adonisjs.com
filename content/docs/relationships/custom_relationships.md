---
summary: Add your own relationship types to Lucid. A relationship from a third-party package then works the same way as the five built-in ones.
---

# Custom relationships

Lucid ships with five relationship types. A package can add more, for example a polymorphic relationship, a hierarchical one, or a custom join strategy. It does so by registering the new type on the relation registry.

In this guide, you will learn how to:

- Register a relationship type on the relation registry
- Declare the contract and the opaque type that make it type-safe
- Create a decorator for it
- Build the queries that Lucid runs during preloading
- Read a complete `hasOneThrough` implementation

## Overview

The five built-in types are ordinary registry entries. Every new registry seeds them in its constructor, and from there they follow the same code path as a type you register yourself. Nothing in the ORM treats them differently. `$addRelation` does one registry lookup, whatever the type.

A relationship has four parts.

| Part | Purpose |
| --- | --- |
| Relationship class | Runtime behaviour: resolves keys, builds queries, assigns results to the parent |
| Relationship contract | The interface the class implements. It extends `BaseRelationContract` |
| Registry entry | Maps a type name to a factory that creates the class |
| Module augmentation | Tells TypeScript about the contract and about the type of the model property |

The first three exist at runtime. The fourth is types only. You need all four before `preload`, `related` and serialization work on your relationship.

## The relation registry

The registry lives on `BaseModel.$relationRegistry`. It maps a type name to the factory that builds the relationship.

The lookup happens when the decorator runs, that is when the model class is evaluated. If the type is not registered at that moment, `$addRelation` throws `E_UNSUPPORTED_RELATION_TYPE`. So the registration must run before the first model that uses the type is imported.

A service provider does not guarantee that order. Nothing stops an ace command, a test file or a standalone script from importing a model before the `register` method of your provider has run, or without booting the application at all. When that happens, the model fails to load and the relationship appears to not exist.

Register the type in the module that exports the decorator instead. A model cannot use the decorator without importing that module first, so the import order is enforced by the language.

```ts
// title: src/decorators.ts
import { BaseModel, createRelationDecorator } from '@adonisjs/lucid/orm'
import { HasOneThroughRelation } from './relation.js'
import type { HasOneThroughDecorator } from './types.js'

BaseModel.$relationRegistry.register('hasOneThrough', {
  create(relationName, relatedModel, options, model) {
    return new HasOneThroughRelation(relationName, relatedModel, options, model)
  },
})

export const hasOneThrough: HasOneThroughDecorator = createRelationDecorator('hasOneThrough')
```

Keep the registration and the decorator in one module, and do not re-export the decorator from a module that skips the registration. A registration placed in a provider, a preload file or a separate `register.ts` only works as long as nothing imports a model earlier.

<dl>

<dt>

register

</dt>

<dd>

`register(type: string, config: RelationFactoryConfig): void`

Adds a relationship type. Throws `E_DUPLICATE_RELATION_TYPE` if the name is already taken, by Lucid or by another package.

`RelationFactoryConfig` has one member, `create`. It receives the relationship name, the related model reference, the decorator options and the parent model. The five built-in relationship classes have the same constructor signature.

</dd>

<dt>

get

</dt>

<dd>

`get(type: string): RelationFactory | undefined`

Returns the factory for a type. `Model.$addRelation()` calls it, and throws `E_UNSUPPORTED_RELATION_TYPE` if the type has no factory.

</dd>

<dt>

has

</dt>

<dd>

`has(type: string): boolean`

Returns `true` if the type is registered.

</dd>

<dt>

types

</dt>

<dd>

`types: string[]`

The names of all registered types, built-ins included.

</dd>

</dl>

### Registration is add-only

There is no `unregister` and no `clear`. You can add a type. You cannot remove it, replace it or shadow it, and built-in types follow the same rule.

Removing a factory would not undo anything anyway. Once a model boots, `Model.$relationsDefinitions` holds relationship *instances*, not factories. Existing relationships keep working without their factory. Only the next module that defines one would break.

When you need isolation, replace the registry instead of changing it, as you would replace `$adapter` or `namingStrategy`. A new registry contains the five built-ins and nothing else.

```ts
const previous = BaseModel.$relationRegistry
BaseModel.$relationRegistry = new RelationRegistry()

// ... register, define models, assert ...

BaseModel.$relationRegistry = previous
```

## The relationship contract

Every relationship, built-in or custom, implements `BaseRelationContract`.

```ts
BaseRelationContract<ParentModel, RelatedModel, Type, IsMany>
```

`Type` and `IsMany` must be literal types. The built-in contracts fill them in the same way a custom contract does, so there is no second contract to learn.

```ts
interface HasOneRelationContract<ParentModel, RelatedModel>
  extends BaseRelationContract<ParentModel, RelatedModel, 'hasOne', false> {}
```

The two literals keep `RelationshipsContract` a discriminated union. If a contract extends `BaseRelationContract` without pinning `Type`, its `type` property becomes the whole union. It then matches every `case` of a `switch (relation.type)`. Narrowing breaks for every consumer of Lucid, not only for the package that declared the contract.

### Members

| Member | Purpose |
| --- | --- |
| `type` | The registration key, as a literal |
| `isMany` | Multiplicity, as a literal |
| `relationName` | The property name on the parent model |
| `serializeAs` | The JSON key, or `null` to skip serialization |
| `booted`, `boot()` | Resolves the keys. Lucid defers this until the first use of the relationship |
| `model`, `relatedModel()` | The parent model and the related model |
| `clone(parent)` | Called when you subclass a model that defines the relationship |
| `client(parent, client)` | The object that `related('name')` returns |
| `eagerQuery(parent, client)` | The query behind `preload` and `load` |
| `subQuery(client)` | The query behind `whereHas` and `withCount` |
| `setRelated(parent, related)` | Assigns the result on one parent |
| `pushRelated(parent, related)` | Appends to the result on one parent |
| `setRelatedForMany(parents, related)` | Matches an eager-loaded result set back to its parents |

`setRelated` and `pushRelated` take their argument type from `IsMany`. An array never type-checks against a singular relationship.

### isMany carries the multiplicity

Three places read `isMany`, two at runtime and one at the type level:

- The preloader gives `result[0] || null` to a relationship with `isMany: false`, and the whole array to one with `isMany: true`.
- `$setRelated` and `$pushRelated` reset and concatenate the value when `isMany` is true. They reject a value that is not an array.
- `GetRelationModelInstance`, the type behind the `load` and `preload` callbacks, gives one instance for a contract with `isMany: false`, and an array for the others.

The multiplicity lives on the relationship instance. Nothing looks it up by type name, so it cannot drift from the relationship it describes.

## Registering the types

You augment two interfaces. The key of each entry must match the literal it registers. A mismatched entry collapses to `never` and drops out of the unions, instead of breaking narrowing for everyone.

```ts
// title: src/types.ts
declare module '@adonisjs/lucid/types/relations' {
  interface KnownCustomRelations {
    // The key must equal the contract's "type"
    hasOneThrough: HasOneThroughRelationContract<LucidModel, LucidModel>
  }

  interface KnownCustomOpaqueRelations<
    RelatedModel extends LucidModel,
    ParentModel extends LucidModel,
  > {
    // The key must equal the opaque type's "__opaque_type"
    hasOneThrough: HasOneThrough<RelatedModel, ParentModel>
  }
}
```

| Interface | Feeds | Effect |
| --- | --- | --- |
| `KnownCustomRelations` | `RelationshipsContract` | The contract shows up when you iterate `$relationsDefinitions`, and `switch (relation.type)` narrows to it |
| `KnownCustomOpaqueRelations` | `ModelRelations` | Lucid recognises the model property as a relationship, so `preload`, `load`, `related` and `withCount` accept its name |

### The opaque type

The opaque type exists only at compile time. It tells TypeScript that a model property is a relationship and not a column.

```ts
export type HasOneThrough<
  RelatedModel extends LucidModel,
  ParentModel extends LucidModel = LucidModel,
> = InstanceType<RelatedModel> & {
  readonly __opaque_type: 'hasOneThrough'
  model: RelatedModel
  instance: InstanceType<RelatedModel>
  client: HasOneThroughClientContract<
    HasOneThroughRelationContract<ParentModel, RelatedModel>,
    RelatedModel
  >
  builder: RelationQueryBuilderContract<RelatedModel, any>
  subQuery: RelationSubQueryBuilderContract<RelatedModel>
}
```

Intersect with `InstanceType<RelatedModel>` for a singular relationship, and with `InstanceType<RelatedModel>[]` for a many relationship.

Derive `client` from `RelationQueryClientContract`, like the built-in clients. That interface provides the `relation` property, and `Model.$getRelation()` reads `client['relation']`. If you write a client type from scratch and leave that property out, the compile error shows up in `src/types/model.ts`, not in your package.

`KnownCustomOpaqueRelations` is generic in both models, and your entry must pass both parameters on. This is how a custom relationship keeps the concrete related model everywhere a built-in one does. The union `ModelRelations<RelatedModel, ParentModel>` contains `HasOne<RelatedModel, ParentModel>` and the four other built-ins. With the augmentation above, it also contains `HasOneThrough<RelatedModel, ParentModel>`. TypeScript never has to compare your type structurally against one fixed instantiation.

The two type parameters have no defaults, and that is deliberate. If you write the augmentation without them, the compiler reports `TS2428: All declarations of 'KnownCustomOpaqueRelations' must have identical type parameters` on your own declaration. With defaults, the same mistake would compile, pin the entry to `LucidModel`, and lose the related model's type inside `onQuery`.

Write your options type the way Lucid writes its own, with the opaque type parameterised:

```ts
export type HasOneThroughOptions<
  RelatedModel extends LucidModel = LucidModel,
  ParentModel extends LucidModel = LucidModel,
> = RelationOptions<RelatedModel, ParentModel, HasOneThrough<RelatedModel, ParentModel>> & {
  throughModel: () => LucidModel
  throughLocalKey?: string
  throughForeignKey?: string
}
```

## Creating a decorator

`createRelationDecorator` returns a decorator. The decorator boots the model, adds the related model reference to the options, and calls `$addRelation`.

```ts
// title: src/decorators.ts
import { createRelationDecorator } from '@adonisjs/lucid/orm'
import type { LucidModel, OptionalTypedDecorator } from '@adonisjs/lucid/types/model'

export type HasOneThroughDecorator = <RelatedModel extends LucidModel>(
  model: () => RelatedModel,
  options: HasOneThroughOptions<RelatedModel>
) => OptionalTypedDecorator<HasOneThrough<RelatedModel> | null>

export const hasOneThrough: HasOneThroughDecorator = createRelationDecorator('hasOneThrough')
```

The decorator type ties the decorator to the property type, as `HasOneDecorator` does for the built-ins. Add `| null` for a singular relationship, so that you can express a relationship that is not loaded yet. Since the options type is parameterised, the `onQuery` callback of `@hasOneThrough(() => Address, ...)` receives a `RelationQueryBuilderContract<typeof Address, any>`, the same as with a built-in relationship.

The decorator lives in the same module as the registration, as shown in [The relation registry](#the-relation-registry). Importing the decorator then registers the type as a side effect, before any model can use it.

You do not have to use a decorator. `Model.$addRelation(name, type, relatedModel, options)` is public, and you can call it directly. The same rule applies: the type must be registered before the call.

## Building the queries

`@adonisjs/lucid/orm/relations` exports the building blocks a relationship needs.

| Export | Use |
| --- | --- |
| `KeysExtractor` | Resolves key names into attribute and column names. Throws `E_MISSING_MODEL_ATTRIBUTE` if the model does not define a key |
| `RelationBaseQueryBuilder` | Base class for the relationship query builder |
| `RelationBaseSubQueryBuilder` | Base class for the `whereHas` and `withCount` sub-query builder |
| `HasOneQueryClient`, `HasManyQueryClient`, `BelongsToQueryClient`, `ManyToManyQueryClient` | The built-in clients, for a custom relationship that delegates persistence to them |

`RelationBaseQueryBuilder` has four abstract members.

<dl>

<dt>

applyConstraints

</dt>

<dd>

Adds the joins and where clauses that scope the query to the relationship. Lucid calls it more than once per query, so guard it with a flag.

</dd>

<dt>

getRelationKeys

</dt>

<dd>

The columns the preloader needs to match rows to parents. When the user cherry-picks columns, `selectRelationKeys()` adds these, so a `preload` with an explicit `select` still returns rows that Lucid can match back to their parent.

</dd>

<dt>

profilerData

</dt>

<dd>

The data that Lucid attaches to the query in debug output.

</dd>

<dt>

getGroupLimitQuery

</dt>

<dd>

The window-function query behind `groupLimit`. A singular relationship throws here, as `hasOne` does.

</dd>

</dl>

### Eager loading

`eagerQuery(parent, client)` receives either one row or an array of rows. Handle both cases.

- For one row, constrain the query to that row. A singular relationship adds `limit(1)`, unless the query action is `update` or `delete`.
- For an array of rows, constrain with `whereIn`. Also select the column that lets `setRelatedForMany` match each row back to its parent. If that column lives on a joined table, it does not survive as a model attribute. Alias it and read it back from `$extras`. This is what `hasManyThrough` does with its `through_` prefix.

## A complete example: hasOneThrough

Lucid ships `hasManyThrough` but no `hasOneThrough`. The code below implements it. A user has one address, through their profile.

```
users.id       ←  profiles.user_id      (foreignKey, on the through model)
profiles.id    ←  addresses.profile_id  (throughForeignKey, on the related model)
```

### Contracts and types

```ts
// title: src/types.ts
import type { LucidModel } from '@adonisjs/lucid/types/model'
import type {
  BaseRelationContract,
  RelationOptions,
  RelationQueryClientContract,
  RelationQueryBuilderContract,
  RelationSubQueryBuilderContract,
} from '@adonisjs/lucid/types/relations'

export interface HasOneThroughClientContract<
  Relation extends HasOneThroughRelationContract<LucidModel, LucidModel>,
  RelatedModel extends LucidModel,
> extends RelationQueryClientContract<Relation, RelatedModel> {}

export type HasOneThrough<
  RelatedModel extends LucidModel,
  ParentModel extends LucidModel = LucidModel,
> = InstanceType<RelatedModel> & {
  readonly __opaque_type: 'hasOneThrough'
  model: RelatedModel
  instance: InstanceType<RelatedModel>
  client: HasOneThroughClientContract<
    HasOneThroughRelationContract<ParentModel, RelatedModel>,
    RelatedModel
  >
  builder: RelationQueryBuilderContract<RelatedModel, any>
  subQuery: RelationSubQueryBuilderContract<RelatedModel>
}

export interface HasOneThroughRelationContract<
  ParentModel extends LucidModel,
  RelatedModel extends LucidModel,
> extends BaseRelationContract<ParentModel, RelatedModel, 'hasOneThrough', false> {
  readonly localKey: string
  readonly foreignKey: string
  readonly throughLocalKey: string
  readonly throughForeignKey: string
  throughModel(): LucidModel
}

export type HasOneThroughOptions<
  RelatedModel extends LucidModel = LucidModel,
  ParentModel extends LucidModel = LucidModel,
> = RelationOptions<RelatedModel, ParentModel, HasOneThrough<RelatedModel, ParentModel>> & {
  throughModel: () => LucidModel
  throughLocalKey?: string
  throughForeignKey?: string
}

declare module '@adonisjs/lucid/types/relations' {
  interface KnownCustomRelations {
    hasOneThrough: HasOneThroughRelationContract<LucidModel, LucidModel>
  }

  interface KnownCustomOpaqueRelations<
    RelatedModel extends LucidModel,
    ParentModel extends LucidModel,
  > {
    hasOneThrough: HasOneThrough<RelatedModel, ParentModel>
  }
}
```

### The query builder

```ts
// title: src/query_builder.ts
import { type Knex } from 'knex'
import type { LucidRow } from '@adonisjs/lucid/types/model'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { RelationBaseQueryBuilder } from '@adonisjs/lucid/orm/relations'
import { getValue, unique } from '@adonisjs/lucid/utils'

export class HasOneThroughQueryBuilder extends RelationBaseQueryBuilder {
  protected appliedConstraints: boolean = false
  protected cherryPickingKeys: boolean = false

  private throughTable: string
  private relatedTable: string

  constructor(
    builder: Knex.QueryBuilder,
    client: QueryClientContract,
    private parent: LucidRow | LucidRow[],
    private relation: HasOneThroughRelation
  ) {
    super(builder, client, relation, (userFn) => {
      return ($builder) => {
        const subQuery = new HasOneThroughQueryBuilder(
          $builder,
          this.client,
          this.parent,
          this.relation
        )
        subQuery.isChildQuery = true
        subQuery.isRelatedPreloadQuery = this.isRelatedPreloadQuery
        userFn(subQuery)
        subQuery.applyWhere()
      }
    })

    this.throughTable = relation.throughModel().table
    this.relatedTable = relation.relatedModel().table
  }

  private prefixThroughTable(column: string) {
    return column.includes('.') ? column : `${this.throughTable}.${column}`
  }

  private prefixRelatedTable(column: string) {
    return column.includes('.') ? column : `${this.relatedTable}.${column}`
  }

  protected profilerData() {
    return {
      type: this.relation.type,
      model: this.relation.model.name,
      throughModel: this.relation.throughModel().name,
      relatedModel: this.relation.relatedModel().name,
    }
  }

  protected getRelationKeys(): string[] {
    return [this.prefixRelatedTable(this.relation.throughForeignKeyColumnName)]
  }

  protected applyConstraints() {
    if (this.appliedConstraints) {
      return
    }

    this.appliedConstraints = true
    const queryAction = this.queryAction()
    const foreignKeyColumn = this.prefixThroughTable(this.relation.foreignKeyColumnName)

    /**
     * Carry the through table's foreign key into "$extras", so that
     * "setRelatedForMany" can match each row back to its parent
     */
    if (!this.hasAggregates) {
      if (!this.cherryPickingKeys) {
        this.select('*')
      }

      this.knexQuery.select(
        `${foreignKeyColumn} as ${this.relation.throughAlias(this.relation.foreignKeyColumnName)}`
      )
    }

    this.innerJoin(
      this.throughTable,
      this.prefixThroughTable(this.relation.throughLocalKeyColumnName),
      this.prefixRelatedTable(this.relation.throughForeignKeyColumnName)
    )

    /**
     * Eager query constraints
     */
    if (Array.isArray(this.parent)) {
      this.whereIn(
        foreignKeyColumn,
        unique(
          this.parent.map((row) => {
            return getValue(row, this.relation.localKey, this.relation, queryAction)
          })
        )
      )
      return
    }

    /**
     * Single parent constraints
     */
    this.where(
      foreignKeyColumn,
      getValue(this.parent, this.relation.localKey, this.relation, queryAction)
    )

    if (!['update', 'delete'].includes(queryAction)) {
      this.limit(1)
    }
  }

  select(...args: any): this {
    const columns = Array.isArray(args[0]) ? args[0] : args
    this.cherryPickingKeys = true

    this.knexQuery.select(
      columns.map((one: any) => {
        return typeof one === 'string'
          ? this.prefixRelatedTable(this.resolveKey(one))
          : this.transformValue(one)
      })
    )

    return this
  }

  clone() {
    const clonedQuery = new HasOneThroughQueryBuilder(
      this.knexQuery.clone(),
      this.client,
      this.parent,
      this.relation
    )

    this.applyQueryFlags(clonedQuery)
    clonedQuery.appliedConstraints = this.appliedConstraints
    clonedQuery.cherryPickingKeys = this.cherryPickingKeys
    clonedQuery.isRelatedPreloadQuery = this.isRelatedPreloadQuery
    clonedQuery.debug(this.debugQueries)
    clonedQuery.reporterData(this.customReporterData)

    return clonedQuery
  }

  paginate(): Promise<any> {
    throw new Error(`Cannot paginate a hasOneThrough relationship "(${this.relation.relationName})"`)
  }

  getGroupLimitQuery(): never {
    throw new Error(
      `Cannot apply groupLimit or groupOrderBy on hasOneThrough relationship "(${this.relation.relationName})"`
    )
  }
}
```

### The query client

This is the object that `user.related('address')` returns. If your relationship supports persistence, add `save`, `create` or `firstOrCreate` here. `hasOneThrough` does not, for the same reason as `hasManyThrough`.

```ts
// title: src/query_client.ts
export class HasOneThroughClient
  implements
    HasOneThroughClientContract<HasOneThroughRelationContract<LucidModel, LucidModel>, LucidModel>
{
  constructor(
    public relation: HasOneThroughRelation,
    private parent: LucidRow,
    private client: QueryClientContract
  ) {}

  static query(
    client: QueryClientContract,
    relation: HasOneThroughRelation,
    rows: LucidRow | LucidRow[]
  ) {
    const query = new HasOneThroughQueryBuilder(client.knexQuery(), client, rows, relation)
    typeof relation.onQueryHook === 'function' && relation.onQueryHook(query)
    return query
  }

  static eagerQuery(
    client: QueryClientContract,
    relation: HasOneThroughRelation,
    rows: LucidRow | LucidRow[]
  ) {
    const query = new HasOneThroughQueryBuilder(client.knexQuery(), client, rows, relation)
    query.isRelatedPreloadQuery = true
    typeof relation.onQueryHook === 'function' && relation.onQueryHook(query)
    return query
  }

  query(): any {
    return HasOneThroughClient.query(this.client, this.relation, this.parent)
  }
}
```

### The relationship

```ts
// title: src/relation.ts
import { KeysExtractor } from '@adonisjs/lucid/orm/relations'
import { ensureRelationIsBooted } from '@adonisjs/lucid/utils'

export class HasOneThroughRelation
  implements HasOneThroughRelationContract<LucidModel, LucidModel>
{
  readonly type = 'hasOneThrough' as const
  readonly isMany = false as const

  booted: boolean = false
  serializeAs: string | null
  throughModel: () => LucidModel
  onQueryHook

  declare localKey: string
  declare localKeyColumnName: string
  declare foreignKey: string
  declare foreignKeyColumnName: string
  declare throughLocalKey: string
  declare throughLocalKeyColumnName: string
  declare throughForeignKey: string
  declare throughForeignKeyColumnName: string

  constructor(
    public relationName: string,
    public relatedModel: () => LucidModel,
    private options: HasOneThroughOptions,
    public model: LucidModel
  ) {
    this.throughModel = options.throughModel
    this.onQueryHook = options.onQuery
    this.serializeAs = options.serializeAs === undefined ? relationName : options.serializeAs
  }

  throughAlias(key: string): string {
    return `through_${key}`
  }

  /**
   * Key resolution is deferred to "boot", so that models can reference
   * each other without import cycles
   */
  boot() {
    if (this.booted) {
      return
    }

    const relatedModel = this.relatedModel()
    const throughModel = this.throughModel()
    relatedModel.boot()
    throughModel.boot()

    const { localKey, foreignKey, throughLocalKey, throughForeignKey } = new KeysExtractor(
      this.model,
      this.relationName,
      {
        localKey: {
          model: this.model,
          key:
            this.options.localKey ||
            this.model.namingStrategy.relationLocalKey(
              this.type,
              this.model,
              relatedModel,
              this.relationName
            ),
        },
        foreignKey: {
          model: throughModel,
          key:
            this.options.foreignKey ||
            this.model.namingStrategy.relationForeignKey(
              this.type,
              this.model,
              throughModel,
              this.relationName
            ),
        },
        throughLocalKey: {
          model: throughModel,
          key:
            this.options.throughLocalKey ||
            this.model.namingStrategy.relationLocalKey(
              this.type,
              throughModel,
              relatedModel,
              this.relationName
            ),
        },
        throughForeignKey: {
          model: relatedModel,
          key:
            this.options.throughForeignKey ||
            this.model.namingStrategy.relationForeignKey(
              this.type,
              throughModel,
              relatedModel,
              this.relationName
            ),
        },
      }
    ).extract()

    this.localKey = localKey.attributeName
    this.localKeyColumnName = localKey.columnName
    this.foreignKey = foreignKey.attributeName
    this.foreignKeyColumnName = foreignKey.columnName
    this.throughLocalKey = throughLocalKey.attributeName
    this.throughLocalKeyColumnName = throughLocalKey.columnName
    this.throughForeignKey = throughForeignKey.attributeName
    this.throughForeignKeyColumnName = throughForeignKey.columnName

    this.booted = true
  }

  clone(parent: LucidModel): any {
    return new HasOneThroughRelation(
      this.relationName,
      this.relatedModel,
      { ...this.options },
      parent
    )
  }

  setRelated(parent: LucidRow, related: LucidRow | null): void {
    ensureRelationIsBooted(this)
    parent.$setRelated(this.relationName as any, related ?? null)
  }

  pushRelated(parent: LucidRow, related: LucidRow | null): void {
    ensureRelationIsBooted(this)
    parent.$pushRelated(this.relationName as any, related ?? null)
  }

  setRelatedForMany(parents: LucidRow[], related: LucidRow[]): void {
    ensureRelationIsBooted(this)
    const alias = this.throughAlias(this.foreignKeyColumnName)

    parents.forEach((parent) => {
      const value = (parent as any)[this.localKey]
      const match = related.find((row) => value !== undefined && row.$extras[alias] === value)
      this.setRelated(parent, match ?? null)
    })
  }

  client(parent: LucidRow, client: QueryClientContract): any {
    ensureRelationIsBooted(this)
    return new HasOneThroughClient(this, parent, client)
  }

  eagerQuery(parent: LucidRow | LucidRow[], client: QueryClientContract): any {
    ensureRelationIsBooted(this)
    return HasOneThroughClient.eagerQuery(client, this, parent)
  }

  subQuery(_client: QueryClientContract): any {
    throw new Error(
      `"whereHas" and "withCount" are not supported by the "${this.relationName}" relationship`
    )
  }
}
```

### Registration and decorator

The registration and the decorator share one module, so that importing `hasOneThrough` registers the type first.

```ts
// title: src/main.ts
import { BaseModel, createRelationDecorator } from '@adonisjs/lucid/orm'

BaseModel.$relationRegistry.register('hasOneThrough', {
  create: (relationName, relatedModel, options, model) => {
    return new HasOneThroughRelation(relationName, relatedModel, options, model)
  },
})

export const hasOneThrough: HasOneThroughDecorator = createRelationDecorator('hasOneThrough')
```

### Using the relationship

```ts
// title: app/models/user.ts
import { hasOneThrough, type HasOneThrough } from 'lucid-has-one-through'
import { UsersSchema } from '#database/schema'
import Address from '#models/address'
import Profile from '#models/profile'

export default class User extends UsersSchema {
  @hasOneThrough(() => Address, { throughModel: () => Profile })
  declare address: HasOneThrough<typeof Address> | null
}
```

From here on, the relationship behaves like a built-in one.

```ts
// Eager load across many parents, in one extra query
const users = await User.query().preload('address')

// Lazy load one parent
const user = await User.findOrFail(1)
await user.load('address')
console.log(user.address.city)

// Query the relationship
const rows = await user.related('address').query().where('city', 'Paris')

// Serialization honours "serializeAs"
user.serialize() // { id: 1, address: { id: 1, city: 'Paris' } }
```

## Testing custom relationships

You cannot undo a registration. Give each test a fresh registry instead of changing the shared one.

```ts
group.each.setup(() => {
  const previous = BaseModel.$relationRegistry
  BaseModel.$relationRegistry = new RelationRegistry()

  return () => {
    BaseModel.$relationRegistry = previous
  }
})
```

Two tests are worth writing for every custom relationship.

The first checks the multiplicity. A singular relationship must receive one row and not an array, when you preload one parent and when you preload many. This is what `isMany` exists for, and it is the first thing a custom relationship gets wrong.

The second checks narrowing. Once your augmentation is loaded, a `switch (relation.type)` over `RelationshipsContract` must still narrow every built-in member. A contract that leaves `Type` unpinned breaks this silently, for every package in the application.

## Current limitations

| Limitation | Detail |
| --- | --- |
| `whereHas` and `withCount` | They need a real `subQuery()` that returns a `RelationSubQueryBuilderContract`. Extend `RelationBaseSubQueryBuilder`, or throw an error that says so |
| Naming strategy | `relationLocalKey` and `relationForeignKey` accept custom type names, but `SnakeCaseNamingStrategy` only has a special case for `belongsTo`. Every other type falls back to the parent model's primary key |

## Related

- [Relationships introduction](./introduction.md): the built-in relationship types
- [HasManyThrough](./has_many_through.md): the built-in relationship that the example above mirrors
