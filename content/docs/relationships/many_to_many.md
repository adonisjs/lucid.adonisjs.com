---
summary: The ManyToMany relationship connects two models through a pivot table, with full support for pivot columns, pivot timestamps, and the attach, detach, and sync persistence APIs.
---

# ManyToMany

This guide covers the `manyToMany` relationship. You will learn how to:

- Declare a `manyToMany` relationship and understand its options
- Include pivot columns and timestamps
- Load, constrain, and filter the related rows
- Query against pivot columns directly
- Persist the relationship through `attach`, `detach`, `sync`, and the save and create helpers

## Overview

A `manyToMany` relationship connects two models through a pivot table that holds foreign keys to both sides. Neither model holds a direct foreign key to the other. A user has many skills and a skill belongs to many users; a post has many tags and a tag belongs to many posts.

```ts
// title: app/models/user.ts
import { manyToMany } from '@adonisjs/lucid/orm'
import type { ManyToMany } from '@adonisjs/lucid/types/relations'
import { UsersSchema } from '#database/schema'
import Skill from '#models/skill'

export default class User extends UsersSchema {
  @manyToMany(() => Skill)
  declare skills: ManyToMany<typeof Skill>
}
```

Both sides of a many-to-many relationship are typically declared. The `Skill` model declares `manyToMany(() => User)` to traverse back to its users.

See [relationships introduction](./introduction.md) for the migration that backs this relationship, including the pivot table layout and the composite unique index that prevents duplicate pairs.

## Options

The decorator accepts an options object as its second argument.

```ts
@manyToMany(() => Skill, {
  pivotTable: 'user_skills',
  pivotForeignKey: 'user_id',
  pivotRelatedForeignKey: 'skill_id',
  pivotColumns: ['proficiency', 'last_used_at'],
  pivotTimestamps: true,
})
declare skills: ManyToMany<typeof Skill>
```

<dl>

<dt>

pivotTable

</dt>

<dd>

The name of the pivot table. Defaults to snake_case of the two model names sorted alphabetically and joined with an underscore. `User` and `Skill` produce `skill_user`. Override when your pivot table uses a different name.

</dd>

<dt>

localKey

</dt>

<dd>

The column on this model that the pivot table's `pivotForeignKey` points at. Defaults to this model's primary key.

</dd>

<dt>

pivotForeignKey

</dt>

<dd>

The column on the pivot table that points at this model. Defaults to snake_case of `{ThisModel}_{primaryKey}`. For `User.primaryKey = 'id'`, the default is `user_id`.

</dd>

<dt>

relatedKey

</dt>

<dd>

The column on the related model that the pivot table's `pivotRelatedForeignKey` points at. Defaults to the related model's primary key.

</dd>

<dt>

pivotRelatedForeignKey

</dt>

<dd>

The column on the pivot table that points at the related model. Defaults to snake_case of `{RelatedModel}_{primaryKey}`. For `Skill.primaryKey = 'id'`, the default is `skill_id`.

</dd>

<dt>

pivotColumns

</dt>

<dd>

Array of additional pivot columns to select whenever the relationship is loaded. Selected columns land on `$extras.pivot_{column}` on each loaded related instance. See [Reading pivot data](#reading-pivot-data).

```ts
@manyToMany(() => Skill, {
  pivotColumns: ['proficiency', 'last_used_at'],
})
declare skills: ManyToMany<typeof Skill>
```

</dd>

<dt>

pivotTimestamps

</dt>

<dd>

Enables created and updated timestamps on pivot rows. Lucid sets these values automatically when rows are inserted through `attach`, `sync`, `save`, or `create`.

```ts
// Enable with default column names (created_at, updated_at)
@manyToMany(() => Skill, { pivotTimestamps: true })
declare skills: ManyToMany<typeof Skill>

// Customize the column names or disable one of them
@manyToMany(() => Skill, {
  pivotTimestamps: {
    createdAt: 'joined_at',
    updatedAt: false,
  },
})
declare skills: ManyToMany<typeof Skill>
```

When `pivotTimestamps` is enabled, the corresponding columns must exist in the pivot migration.

</dd>

<dt>

onQuery

</dt>

<dd>

A callback that runs on every read query Lucid generates for the relationship.

```ts
@manyToMany(() => Skill, {
  onQuery: (query) => query.whereNull('skills.deleted_at'),
})
declare skills: ManyToMany<typeof Skill>
```

Fires on `preload`, `related('skills').query()`, `related('skills').pivotQuery()`, and the subqueries used by `has`, `whereHas`, `withCount`, and `withAggregate`. Does not fire on `attach`, `detach`, `sync`, `save`, `saveMany`, `create`, or `createMany`, which write directly to the pivot table.

</dd>

<dt>

meta

</dt>

<dd>

Arbitrary metadata attached to the relationship definition. Lucid does not read this field; it is available for your own tooling that inspects relationship definitions at runtime.

</dd>

</dl>

## Loading the related rows

### Eager loading with preload

Call `preload('skills')` on the query builder to hydrate the relationship on every returned user. Lucid joins the pivot table automatically, so declared `pivotColumns` come along for free.

```ts
const users = await User.query().preload('skills')

users.forEach((user) => {
  user.skills.forEach((skill) => {
    console.log(skill.name, skill.$extras.pivot_proficiency)
  })
})
```

Pass a callback to filter or order the relationship query, and optionally select additional pivot columns at query time with `.pivotColumns([...])`.

```ts
await User.query().preload('skills', (skillsQuery) => {
  skillsQuery
    .wherePivot('proficiency', '>=', 3)
    .pivotColumns(['notes'])
    .orderBy('name', 'asc')
})
```

When no related rows exist, `user.skills` is an empty array.

### Lazy loading from an instance

When you already have a parent instance and only need the relationship in some code paths, build a query through `related('skills').query()`.

```ts
const user = await User.findOrFail(params.id)
const topSkills = await user
  .related('skills')
  .query()
  .wherePivot('proficiency', '>=', 4)
  .orderBy('name', 'asc')
```

### Reading pivot-only data

`related('skills').pivotQuery()` runs a query against the pivot table alone, without loading the related rows. Useful when you only need to check or update pivot attributes.

```ts
const user = await User.findOrFail(params.id)

// Count how many skills this user has tagged as expert
const expertCount = await user
  .related('skills')
  .pivotQuery()
  .wherePivot('proficiency', 5)
  .count('* as total')
```

## Filtering by the relationship

Use `has` and `whereHas` on the parent's query builder to restrict rows based on the presence of the related records. `manyToMany` supports count-based filtering with an operator and a value.

```ts
// Users with at least one skill
const skilled = await User.query().has('skills')

// Users with five or more skills
const highlySkilled = await User.query().has('skills', '>=', 5)

// Users who have at least one expert-level skill
const experts = await User.query().whereHas('skills', (skillsQuery) => {
  skillsQuery.wherePivot('proficiency', 5)
})
```

Variants for combining and inverting:

| Method | Description |
| --- | --- |
| `has` / `andHas` | The relationship has matching rows |
| `orHas` | OR-combined presence check |
| `doesntHave` / `andDoesntHave` | The relationship has no matching rows |
| `orDoesntHave` | OR-combined absence check |
| `whereHas` / `andWhereHas` | Relationship has matching rows with constraints |
| `orWhereHas` | OR-combined `whereHas` |
| `whereDoesntHave` / `andWhereDoesntHave` | Relationship has no matching rows with constraints |
| `orWhereDoesntHave` | OR-combined `whereDoesntHave` |

## Aggregates

Use `withCount` and `withAggregate` to load derived values from the relationship without loading the rows themselves. Results land on the parent's `$extras` object.

```ts
const users = await User.query().withCount('skills')

users.forEach((user) => {
  console.log(user.$extras.skills_count)
})
```

Override the alias through the callback when the default `{relation}_count` is not what you want.

```ts
const users = await User
  .query()
  .withCount('skills', (query) => {
    query.wherePivot('proficiency', '>=', 4).as('expertSkillsCount')
  })
```

`withAggregate` runs any aggregate function.

```ts
const users = await User
  .query()
  .withAggregate('skills', (query) => {
    query.max('pivot_last_used_at').as('lastSkillUsedAt')
  })
```

## Pivot-specific query clauses

Regular `where` clauses on a relationship query apply to the related model's columns. To apply clauses against the pivot table, use the `wherePivot` family.

```ts
const user = await User.findOrFail(params.id)
const experts = await user
  .related('skills')
  .query()
  .wherePivot('proficiency', 5)
  .whereInPivot('category', ['languages', 'frameworks'])
```

Full set of pivot-aware helpers:

| Method | Description |
| --- | --- |
| `wherePivot(key, op?, value)` / `andWherePivot` | Add a `WHERE` clause on a pivot column |
| `orWherePivot` | OR-combined `wherePivot` |
| `whereNotPivot` / `andWhereNotPivot` | `WHERE NOT` on a pivot column |
| `orWhereNotPivot` | OR-combined `whereNotPivot` |
| `whereInPivot(key, values)` / `andWhereInPivot` | `WHERE IN` on a pivot column |
| `orWhereInPivot` | OR-combined `whereInPivot` |
| `whereNotInPivot` / `andWhereNotInPivot` | `WHERE NOT IN` on a pivot column |
| `orWhereNotInPivot` | OR-combined `whereNotInPivot` |
| `pivotColumns([...])` | Select additional pivot columns for this query only |

## Reading pivot data

Pivot columns you declare through `pivotColumns` on the decorator or select through `.pivotColumns([...])` on a query land on each related instance under the `$extras.pivot_{column}` key.

```ts
const user = await User.query().preload('skills').firstOrFail()

user.skills.forEach((skill) => {
  console.log(skill.name, skill.$extras.pivot_proficiency, skill.$extras.pivot_last_used_at)
})
```

If `pivotTimestamps` is enabled, `$extras.pivot_created_at` and `$extras.pivot_updated_at` (or your custom column names) are available alongside.

For serializing pivot data into JSON responses, see the [serializing models guide](../models/serializing_models.md#many-to-many-and-pivot-attributes).

## Persisting through the relationship

Every persistence method below runs inside a managed transaction. The parent row is saved first, related rows are created or updated, and pivot rows are inserted or updated together. If anything fails, the entire batch rolls back.

### attach

`attach` inserts rows into the pivot table. Pass an array of related ids to attach, or an object whose keys are related ids and whose values are pivot attributes.

```ts
const user = await User.findOrFail(1)

// Attach by ids
await user.related('skills').attach([1, 2, 3])

// Attach with pivot attributes per relationship
await user.related('skills').attach({
  1: { proficiency: 5, notes: 'primary' },
  2: { proficiency: 3 },
  3: {},
})
```

`attach` does not deduplicate. Passing an id that already exists in the pivot table produces an error (or a duplicate row, if no unique index is defined). Use `sync` when you want idempotent behavior.

### detach

`detach` removes pivot rows. Pass an array of related ids to detach specific rows, or call without arguments to detach every related row for this parent.

```ts
// Detach specific skill ids
await user.related('skills').detach([2, 3])

// Detach all skills for this user
await user.related('skills').detach()
```

`detach` does not delete the related rows themselves. It only removes the rows from the pivot table.

### sync

`sync` reconciles the pivot state with a target set. Pass an array of ids or an object of ids-to-attributes. Lucid computes the diff and:

- Inserts pivot rows that are in the target but not yet in the database
- Updates pivot rows whose attributes changed
- Deletes pivot rows that are in the database but not in the target

```ts
// Replace the user's skills entirely with this set
await user.related('skills').sync([1, 2, 3])

// With pivot attributes
await user.related('skills').sync({
  1: { proficiency: 5 },
  2: { proficiency: 3 },
  3: { proficiency: 1 },
})
```

To add and update without removing missing rows, pass `false` as the second argument. This turns `sync` into an idempotent `attach` that also updates pivot attributes on existing rows.

```ts
await user.related('skills').sync([1, 2, 3], false)
// Skills 1, 2, 3 are attached if missing; other skills are left alone
```

### save and saveMany

`save(related)` persists a related model instance and attaches it. If the related row already exists and has a primary key, Lucid saves it (no-op when no columns changed) and ensures the pivot row exists through a sync. `saveMany(related[])` does the same for many.

```ts
const skill = new Skill()
skill.name = 'TypeScript'
await user.related('skills').save(skill)
```

Pass pivot attributes as a third argument on `save`, or as an array aligned with the related models on `saveMany`.

```ts
await user.related('skills').save(skill, true, { proficiency: 4 })

await user.related('skills').saveMany(
  [skillA, skillB],
  true,
  [{ proficiency: 5 }, { proficiency: 3 }]
)
```

The second argument (`performSync`) controls duplicate handling. `true` (the default) runs a `sync` step that avoids duplicate pivot rows. `false` falls back to a plain `attach`, which is faster but produces an error on duplicate pairs.

### create and createMany

`create(values)` builds a new related instance from the values, persists it, and attaches it to the parent. `createMany(values[])` does the same for many. Both accept pivot attributes as an additional argument.

```ts
const skill = await user.related('skills').create(
  { name: 'TypeScript' },
  { proficiency: 4 }
)
```

```ts
const skills = await user.related('skills').createMany(
  [{ name: 'TypeScript' }, { name: 'PostgreSQL' }],
  [{ proficiency: 5 }, { proficiency: 3 }]
)
```

## Pagination

`paginate(page, perPage)` works when you lazy-load the relationship through `related('skills').query()`. Paginating inside a preload callback throws, because a single paginator cannot express per-parent page boundaries.

```ts
const user = await User.findOrFail(params.id)
const skills = await user
  .related('skills')
  .query()
  .orderBy('name', 'asc')
  .paginate(page, 20)
```

See the [pagination guide](../guides/pagination.md) for the paginator API, URL customization, and transformer integration.
