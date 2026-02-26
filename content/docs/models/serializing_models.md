---
summary: Learn how to serialize model instances using transformers for type-safe API responses.
---

# Serializing models with transformers

In this guide, you will learn:

- How to create and use transformers to serialize models to JSON
- How to handle computed properties and field transformations
- How to serialize relationships and paginated results
- How to create multiple output variants for different contexts
- How to generate TypeScript types for your frontend

## Overview

When building API servers, you need to convert model instances (which are rich TypeScript class instances) to plain JSON objects before sending them to clients. This process is called serialization.

Transformers provide an explicit, type-safe approach to serialization in AdonisJS. Instead of relying on implicit model serialization methods, transformers give you complete control over what data gets exposed in your API responses. They live in separate classes, making it easy to test and reuse serialization logic across your application.

The transformer system automatically generates TypeScript types that your frontend can import. This ensures type safety between your API and client code, eliminating manual type definitions and keeping your frontend in sync with your backend.

Transformers are designed for API responses. There's no need to use them when rendering models inside Edge templates, as templates can work directly with model instances.

## Creating your first transformer

Let's create a transformer for a `Post` model. Generate the transformer using the `make:transformer` command.

```bash
node ace make:transformer post
# CREATE: app/transformers/post_transformer.ts
```

This creates a basic transformer with the following structure.

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import type Post from '#models/post'

export default class PostTransformer extends BaseTransformer<Post> {
  /**
   * The toObject method defines the default serialized output
   */
  toObject() {
    return this.pick(this.resource, [
      'id',
      'title',
      'content',
      'createdAt',
      'updatedAt'
    ])
  }
}
```

A few important things to know. The transformer extends `BaseTransformer` and receives the model type as a generic parameter. The `toObject` method defines what gets serialized, and it has access to the model instance via `this.resource`. The `pick` helper method selects specific fields from the model.

## Using transformers in controllers

Once you've created a transformer, you can use it in your controllers by calling the `serialize` method from the HTTP context. The `serialize` method accepts the transformed data and returns it as a JSON response.

```ts
// title: app/controllers/posts_controller.ts
import Post from '#models/post'
import type { HttpContext } from '@adonisjs/core/http'
import PostTransformer from '#transformers/post_transformer'

export default class PostsController {
  /**
   * Serialize a single model instance
   */
  async show({ serialize, params }: HttpContext) {
    const post = await Post.findOrFail(params.id)
    
    return serialize(PostTransformer.transform(post))
  }

  /**
   * Serialize an array of model instances
   */
  async index({ serialize }: HttpContext) {
    const posts = await Post.all()
    
    return serialize(PostTransformer.transform(posts))
  }
}
```

The `PostTransformer.transform()` method accepts either a single model instance or an array of instances, automatically handling both cases. The serialized output will be a JSON response with the fields you defined in the `toObject` method.

### What you learned

You now know how to:
- Generate a transformer using `make:transformer`
- Define serialized fields using the `toObject` method
- Use `this.pick()` to select specific model properties
- Transform data in controllers with `PostTransformer.transform()`
- Return serialized responses with the `serialize()` context method

## Common serialization patterns

### Renaming properties

You can rename properties by defining them explicitly in your `toObject` method instead of using `pick`. This gives you complete control over the output structure.

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import type Post from '#models/post'

export default class PostTransformer extends BaseTransformer<Post> {
  toObject() {
    return {
      id: this.resource.id,
      title: this.resource.title,
      /**
       * Rename 'body' to 'content' in the output
       */
      content: this.resource.body,
      createdAt: this.resource.createdAt,
      updatedAt: this.resource.updatedAt
    }
  }
}
```

The output will use `content` as the property name even though the model property is named `body`. This is useful when your API naming conventions differ from your database column names.

### Hiding sensitive properties

To hide sensitive data from API responses, simply don't include those properties in your `toObject` method. For example, excluding a password field.

```ts
// title: app/transformers/user_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import type User from '#models/user'

export default class UserTransformer extends BaseTransformer<User> {
  toObject() {
    /**
     * The password property is not included, so it won't
     * appear in the serialized output
     */
    return this.pick(this.resource, [
      'id',
      'fullName',
      'email',
      'createdAt'
    ])
  }
}
```

This approach is more secure than model-based serialization because you explicitly define what gets exposed. There's no risk of accidentally exposing sensitive fields.

### Adding computed properties

You can add computed values to your serialized output by calculating them within the `toObject` method.

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import type Post from '#models/post'
import string from '@adonisjs/core/helpers/string'

export default class PostTransformer extends BaseTransformer<Post> {
  toObject() {
    return {
      ...this.pick(this.resource, [
        'id',
        'title',
        'content',
        'createdAt'
      ]),
      /**
       * Add a computed excerpt property that doesn't exist
       * on the model
       */
      excerpt: string.truncate(this.resource.content, 100),
      wordCount: this.resource.content.split(' ').length,
      readingTime: Math.ceil(this.resource.content.split(' ').length / 200)
    }
  }
}
```

Computed properties appear in the output alongside the model's actual properties, allowing you to add derived data without modifying your models.

### Transforming values

You can transform property values during serialization by manually defining how each field should be formatted.

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import type Post from '#models/post'

export default class PostTransformer extends BaseTransformer<Post> {
  toObject() {
    return {
      id: this.resource.id,
      title: this.resource.title,
      /**
       * Transform the DateTime instance to an ISO string in UTC.
       * Guard against null values to prevent runtime errors.
       */
      createdAt: this.resource.createdAt 
        ? this.resource.createdAt.setZone('utc').toISO()
        : null,
      updatedAt: this.resource.updatedAt
        ? this.resource.updatedAt.setZone('utc').toISO()
        : null
    }
  }
}
```

This pattern is useful for formatting dates, converting enums to human-readable strings, or applying any other transformations to your data.

### Including query extras

When your queries select additional columns that aren't defined on the model, those values are stored in the `$extras` object. You can include them in your serialized output.

```ts
// title: app/controllers/posts_controller.ts
import Post from '#models/post'
import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'
import PostTransformer from '#transformers/post_transformer'

export default class PostsController {
  async index({ serialize }: HttpContext) {
    /**
     * Select category name using a subquery. This value
     * will be available in post.$extras.categoryName
     */
    const posts = await Post.query()
      .select('*')
      .select(
        db.from('categories')
          .select('name')
          .whereColumn('posts.category_id', 'categories.id')
          .limit(1)
          .as('categoryName')
      )
    
    return serialize(PostTransformer.transform(posts))
  }
}
```

Access and include the extra values in your transformer.

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import type Post from '#models/post'

export default class PostTransformer extends BaseTransformer<Post> {
  toObject() {
    return {
      ...this.pick(this.resource, ['id', 'title']),
      /**
       * Include the categoryName from the $extras object
       */
      category: {
        name: this.resource.$extras.categoryName
      }
    }
  }
}
```

This gives you full control over how extra query data gets structured in your API responses.

## Serializing relationships

Transformers can reference other transformers to handle relationships, maintaining type safety across your entire object graph.

### Basic relationship serialization

Create transformers for both the parent and related models.

```ts
// title: app/transformers/user_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import type User from '#models/user'

export default class UserTransformer extends BaseTransformer<User> {
  toObject() {
    return this.pick(this.resource, [
      'id',
      'fullName',
      'email'
    ])
  }
}
```

Reference the relationship transformer in the parent transformer.

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import type Post from '#models/post'
import UserTransformer from '#transformers/user_transformer'

export default class PostTransformer extends BaseTransformer<Post> {
  toObject() {
    return {
      ...this.pick(this.resource, ['id', 'title', 'content']),
      /**
       * Transform the author relationship using UserTransformer
       */
      author: UserTransformer.transform(this.resource.author)
    }
  }
}
```

:::warning

**Why this matters**: Transformers don't load relationships automatically. You must eager-load relationships in your controller queries before transforming, or the relationship will be undefined.

**What happens if ignored**: You'll see a runtime error saying "Cannot transform undefined values. Use this.whenLoaded to guard against undefined values."

**The solution**: Always preload relationships you plan to serialize.

```ts
// title: app/controllers/posts_controller.ts
async show({ serialize, params }: HttpContext) {
  const post = await Post.query()
    .where('id', params.id)
    .preload('author')  // Must preload the relationship
    .firstOrFail()
  
  return serialize(PostTransformer.transform(post))
}
```

:::

### Conditional relationships

For optional relationships that may or may not be loaded, use `this.whenLoaded()` to guard against undefined values.

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import type Post from '#models/post'
import UserTransformer from '#transformers/user_transformer'

export default class PostTransformer extends BaseTransformer<Post> {
  toObject() {
    return {
      ...this.pick(this.resource, ['id', 'title']),
      /**
       * Only include the author if it was preloaded.
       * Returns undefined if not loaded, preventing errors.
       */
      author: UserTransformer.transform(
        this.whenLoaded(this.resource.author)
      )
    }
  }
}
```

Now the author will only be included in the output when it's been preloaded. If it hasn't been preloaded, the property will be omitted from the response.

### Nested relationship depth

By default, relationship transformers serialize one level deep. You can control this with the `depth` method.

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import type Post from '#models/post'
import CommentTransformer from '#transformers/comment_transformer'

export default class PostTransformer extends BaseTransformer<Post> {
  toObject() {
    return {
      ...this.pick(this.resource, ['id', 'title']),
      /**
       * Serialize comments and their nested relationships
       * up to 2 levels deep
       */
      comments: CommentTransformer
        .transform(this.resource.comments)
        .depth(2)
    }
  }
}
```

This ensures that if your comments have their own relationships (like authors), those will also be serialized.

### Multiple relationships

You can serialize multiple relationships by referencing their respective transformers.

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import type Post from '#models/post'
import UserTransformer from '#transformers/user_transformer'
import CommentTransformer from '#transformers/comment_transformer'
import CategoryTransformer from '#transformers/category_transformer'

export default class PostTransformer extends BaseTransformer<Post> {
  toObject() {
    return {
      ...this.pick(this.resource, ['id', 'title', 'content']),
      author: UserTransformer.transform(this.resource.author),
      category: CategoryTransformer.transform(this.resource.category),
      comments: CommentTransformer.transform(this.resource.comments)
    }
  }
}
```

Remember to preload all relationships in your controller.

```ts
// title: app/controllers/posts_controller.ts
async show({ serialize, params }: HttpContext) {
  const post = await Post.query()
    .where('id', params.id)
    .preload('author')
    .preload('category')
    .preload('comments')
    .firstOrFail()
  
  return serialize(PostTransformer.transform(post))
}
```

## Serializing paginated results

When working with paginated data, transformers provide a `paginate` method that handles both the data and pagination metadata.

```ts
// title: app/controllers/posts_controller.ts
import Post from '#models/post'
import type { HttpContext } from '@adonisjs/core/http'
import PostTransformer from '#transformers/post_transformer'

export default class PostsController {
  async index({ serialize, request }: HttpContext) {
    const page = request.input('page', 1)
    
    /**
     * Get paginated results from Lucid
     */
    const posts = await Post.query().paginate(page, 20)
    
    /**
     * Extract the data and metadata from the paginator
     */
    const data = posts.all()
    const metadata = posts.getMeta()
    
    /**
     * Use the paginate method to serialize both data and metadata
     */
    return serialize(PostTransformer.paginate(data, metadata))
  }
}
```

The serialized output will have this structure.

```json
{
  "data": [
    {
      "id": 1,
      "title": "First post",
      "content": "..."
    }
  ],
  "meta": {
    "total": 100,
    "perPage": 20,
    "currentPage": 1,
    "lastPage": 5,
    "firstPage": 1,
    "firstPageUrl": "/?page=1",
    "lastPageUrl": "/?page=5",
    "nextPageUrl": "/?page=2",
    "previousPageUrl": null
  }
}
```

The `data` array contains your transformed models, while `meta` provides all the pagination information your frontend needs to build page navigation.

## Creating output variants

Sometimes you need different serialization formats for the same model in different contexts. Transformers support variants, which are additional methods that define alternative output shapes.

### Defining variants

Create variant methods in your transformer alongside the default `toObject` method.

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import type Post from '#models/post'
import UserTransformer from '#transformers/user_transformer'

export default class PostTransformer extends BaseTransformer<Post> {
  /**
   * Default variant for list views - minimal data
   */
  toObject() {
    return this.pick(this.resource, [
      'id',
      'title',
      'excerpt',
      'createdAt'
    ])
  }

  /**
   * Detailed variant for single post views - full data.
   * Variant methods can be async if needed.
   */
  async forDetailedView() {
    return {
      ...this.pick(this.resource, [
        'id',
        'title',
        'content',
        'createdAt',
        'updatedAt'
      ]),
      author: UserTransformer.transform(this.resource.author),
      wordCount: this.resource.content.split(' ').length
    }
  }

  /**
   * Minimal variant for dropdowns - just essentials
   */
  forDropdown() {
    return this.pick(this.resource, ['id', 'title'])
  }
}
```

### Using variants in controllers

Select which variant to use by calling `useVariant` on the transformed data.

```ts
// title: app/controllers/posts_controller.ts
import Post from '#models/post'
import type { HttpContext } from '@adonisjs/core/http'
import PostTransformer from '#transformers/post_transformer'

export default class PostsController {
  /**
   * List view uses the default variant (minimal data)
   */
  async index({ serialize }: HttpContext) {
    const posts = await Post.all()
    
    return serialize(PostTransformer.transform(posts))
  }

  /**
   * Detail view uses the forDetailedView variant
   */
  async show({ serialize, params }: HttpContext) {
    const post = await Post.query()
      .where('id', params.id)
      .preload('author')
      .firstOrFail()
    
    return serialize(
      PostTransformer.transform(post).useVariant('forDetailedView')
    )
  }

  /**
   * Dropdown endpoint uses the forDropdown variant
   */
  async dropdown({ serialize }: HttpContext) {
    const posts = await Post.all()
    
    return serialize(
      PostTransformer.transform(posts).useVariant('forDropdown')
    )
  }
}
```

Variants let you maintain a single transformer while supporting multiple output formats, keeping your code organized and DRY.

### Variants with dependency injection

Variant methods can use dependency injection to access the HTTP context or other services. Use the `@inject` decorator to declare dependencies.

```ts
// title: app/transformers/post_transformer.ts
import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { BaseTransformer } from '@adonisjs/core/transformers'
import type Post from '#models/post'

export default class PostTransformer extends BaseTransformer<Post> {
  toObject() {
    return this.pick(this.resource, ['id', 'title'])
  }

  /**
   * This variant receives the HTTP context to determine
   * what actions the current user can perform
   */
  @inject()
  async withPermissions({ auth }: HttpContext) {
    const isOwner = auth.user?.id === this.resource.userId
    const isAdmin = auth.user?.role === 'admin'
    
    return {
      ...this.toObject(),
      content: this.resource.content,
      /**
       * Include authorization data in the response
       */
      can: {
        edit: isOwner || isAdmin,
        delete: isOwner || isAdmin,
        publish: isAdmin
      }
    }
  }
}
```

Use this variant normally in your controller.

```ts
// title: app/controllers/posts_controller.ts
async show({ serialize, params }: HttpContext) {
  const post = await Post.findOrFail(params.id)
  
  return serialize(
    PostTransformer.transform(post).useVariant('withPermissions')
  )
}
```

The HTTP context will be automatically injected when the `serialize` method resolves the variant.

## TypeScript type generation

One of the most powerful features of transformers is automatic TypeScript type generation for your frontend applications.

### How type generation works

When you run your development server, AdonisJS automatically scans your transformers and generates TypeScript types in the `.adonisjs/client/data.d.ts` file.

```bash
node ace serve --hmr
```

For the `PostTransformer` example, this generates the following types.

```ts
// title: .adonisjs/client/data.d.ts (auto-generated)
import type { InferData, InferVariants } from '@adonisjs/core/types/transformers'
import type PostTransformer from '#transformers/post_transformer'

export namespace Data {
  /**
   * The base type for the default variant
   */
  export type Post = InferData<PostTransformer>
  
  export namespace Post {
    /**
     * Types for all variants
     */
    export type Variants = InferVariants<PostTransformer>
  }
}
```

### Using generated types in your frontend

Import the generated types in your frontend code.

```ts
// title: resources/js/types.ts
import { Data } from '~/generated/data'

/**
 * Use the base transformer type
 */
type Post = Data.Post

/**
 * Use a specific variant type
 */
type DetailedPost = Data.Post.Variants['forDetailedView']
type DropdownPost = Data.Post.Variants['forDropdown']

/**
 * Example: React component with typed props
 */
interface PostCardProps {
  post: Post
}

function PostCard({ post }: PostCardProps) {
  return (
    <div>
      <h2>{post.title}</h2>
      <p>{post.excerpt}</p>
    </div>
  )
}
```

The generated types ensure your frontend and backend stay in sync. If you change what fields your transformer returns, TypeScript will immediately flag any mismatches in your frontend code.

### What you learned

You now know how to:
- Create variants for different serialization contexts
- Use async variants for computed or database operations
- Inject dependencies into variants with `@inject()`
- Generate TypeScript types automatically for frontend use
- Import and use generated types in your client code
- Maintain type safety across your entire application

## Migration from model serialization

If you have existing code using model serialization methods (like `serialize()`, `toJSON()`, `serializeAs`, etc.), here's how to migrate to transformers.

### Before (model serialization)

```ts
// title: app/models/post.ts
import { DateTime } from 'luxon'
import { BaseModel, column, computed } from '@adonisjs/lucid/orm'

export default class Post extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column({ serializeAs: 'content' })
  declare body: string

  @column({ serializeAs: null })
  declare internalNotes: string

  @computed()
  get excerpt() {
    return this.body.substring(0, 100)
  }
}
```

```ts
// title: app/controllers/posts_controller.ts
async show({ params }: HttpContext) {
  const post = await Post.findOrFail(params.id)
  
  return post.serialize()  // Old approach
}
```

### After (transformers)

```ts
// title: app/transformers/post_transformer.ts
import { BaseTransformer } from '@adonisjs/core/transformers'
import type Post from '#models/post'

export default class PostTransformer extends BaseTransformer<Post> {
  toObject() {
    return {
      id: this.resource.id,
      /**
       * Rename body to content (was serializeAs: 'content')
       */
      content: this.resource.body,
      /**
       * Add computed excerpt (was @computed)
       */
      excerpt: this.resource.body.substring(0, 100),
      /**
       * internalNotes is excluded (was serializeAs: null)
       */
    }
  }
}
```

```ts
// title: app/controllers/posts_controller.ts
import PostTransformer from '#transformers/post_transformer'

async show({ serialize, params }: HttpContext) {
  const post = await Post.findOrFail(params.id)
  
  return serialize(PostTransformer.transform(post))  // New approach
}
```

```ts
// title: app/models/post.ts (simplified)
import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class Post extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  /**
   * Remove serialization decorators - transformers
   * handle all serialization now
   */
  @column()
  declare body: string

  @column()
  declare internalNotes: string
}
```

### Key migration points

The main differences when migrating.

**Model decorators**: Remove `serializeAs`, `@computed`, and `serialize` callback options from your models. Transformers handle all serialization logic.

**Field selection**: Instead of marking fields with `serializeAs: null`, simply don't include them in your transformer's `toObject` method.

**Computed properties**: Move computed properties from model getters to calculated fields in your transformer.

**Relationships**: Replace `serializeAs` on relationships with transformer references in your parent transformer.

**Cherry-picking**: Instead of passing field/relation trees to `serialize()`, create variants in your transformer for different contexts.

## See also

- [Pagination guide](../guides/pagination.md) for learning about paginating query results
- [Lucid relationships](./relationships.md) for understanding model relationships
