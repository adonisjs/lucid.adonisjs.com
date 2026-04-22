---
summary: Offset-based pagination for queries, models, and relationships, with guidance for API responses, Inertia apps, and Edge templates.
---

# Pagination

This guide covers Lucid's offset-based pagination. You will learn how to:

- Paginate database queries, model queries, and related records
- Work with the paginator object in application code
- Customize pagination URLs with a base URL and query-string values
- Render pagination data for API endpoints, Inertia apps, and Edge templates
- Understand the performance tradeoff of offset pagination

## Overview

Lucid supports **offset-based pagination**, where a page number and a page size determine which rows to return. The `paginate` method on any query builder runs your query with `LIMIT` and `OFFSET`, executes a separate `COUNT` query to compute the total number of matching rows, and returns a `SimplePaginator` instance containing the page's rows and the metadata needed to build pagination UI.

Offset pagination is the right choice for most administrative and user-facing interfaces. It breaks down for very large tables where the `COUNT` query becomes expensive. See [Performance considerations](#performance-considerations) for the tradeoff.

## Basic usage

Call `.paginate(page, perPage)` on any query builder. The method returns a paginator containing the page's rows and the metadata.

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import Post from '#models/post'

export default class PostsController {
  async index({ request }: HttpContext) {
    const page = request.input('page', 1)
    const perPage = 20

    return Post.query()
      .orderBy('created_at', 'desc')
      .paginate(page, perPage)
  }
}
```

You can also paginate a raw table query through the `db` service.

```ts
// title: app/services/posts_service.ts
import db from '@adonisjs/lucid/services/db'

export async function listPosts(page: number) {
  return db
    .from('posts')
    .orderBy('created_at', 'desc')
    .paginate(page, 20)
}
```

`perPage` defaults to `20` when omitted. Always include an `orderBy` clause so that pagination returns stable results across page boundaries. Without an explicit order, the database is free to return rows in any order, which can cause the same row to appear on multiple pages or be skipped entirely.

## The paginator object

The object returned by `paginate` is an instance of `SimplePaginator`. It extends `Array`, so you can iterate it directly or use any array method on it without calling `.all()` first.

```ts
const posts = await Post.query().paginate(page, 20)

for (const post of posts) {
  console.log(post.title)
}

const titles = posts.map((post) => post.title)
```

The paginator exposes the following properties and methods.

<dl>

<dt>

perPage

</dt>

<dd>

Number of rows requested per page.

</dd>

<dt>

currentPage

</dt>

<dd>

The page number passed to `paginate`.

</dd>

<dt>

firstPage

</dt>

<dd>

Always `1`.

</dd>

<dt>

lastPage

</dt>

<dd>

Computed as `Math.max(Math.ceil(total / perPage), 1)`.

</dd>

<dt>

total

</dt>

<dd>

Total number of matching rows reported by the `COUNT` query.

</dd>

<dt>

hasTotal

</dt>

<dd>

`true` when the table has at least one matching row. This is not the same as `isEmpty`: `hasTotal` reports on the whole result set, while `isEmpty` reports on the current page.

</dd>

<dt>

isEmpty

</dt>

<dd>

`true` when the current page returned no rows.

</dd>

<dt>

hasPages

</dt>

<dd>

`true` when the result spans more than one page.

</dd>

<dt>

hasMorePages

</dt>

<dd>

`true` when pages exist after the current page.

</dd>

<dt>

all()

</dt>

<dd>

Returns the raw rows array. Equivalent to iterating the paginator directly, which also works because it extends `Array`.

</dd>

<dt>

getMeta()

</dt>

<dd>

Returns the pagination metadata as a plain object with `total`, `perPage`, `currentPage`, `lastPage`, `firstPage`, `firstPageUrl`, `lastPageUrl`, `nextPageUrl`, and `previousPageUrl` fields.

</dd>

<dt>

getUrl(page)

</dt>

<dd>

Returns the URL for a given page number, built from the configured base URL and query string.

</dd>

<dt>

getNextPageUrl() / getPreviousPageUrl()

</dt>

<dd>

Returns the URL for the next or previous page, or `null` when the current page is at the boundary.

</dd>

<dt>

getUrlsForRange(start, end)

</dt>

<dd>

Returns an array of `{ url, page, isActive }` objects for pages between `start` and `end` (inclusive). Useful for building numbered link lists in templates.

</dd>

</dl>

## Customize pagination URLs

The paginator builds URLs from a base URL and an optional query-string object. By default, the base URL is `/`. Call `baseUrl` to change it, and `queryString` to preserve additional query parameters across the generated page links.

```ts
const posts = await Post.query()
  .where('status', 'published')
  .paginate(page, 20)

posts.baseUrl('/posts')
posts.queryString({ status: 'published', sort: 'newest' })
```

With the settings above, `posts.getUrl(2)` returns `/posts?status=published&sort=newest&page=2`, and `getUrlsForRange`, `getNextPageUrl`, and `getPreviousPageUrl` all honor the same base URL and query-string values.

## Transform and serialize responses

Pagination responses travel through three common shapes in AdonisJS applications: API endpoints that return JSON, Inertia endpoints that pass data to the frontend as props, and Edge templates that render pagination links. The first two are best handled by AdonisJS transformers, which keep the response shape explicit and preserve type safety end-to-end.

Given a paginator, pass its rows and metadata into your transformer's `paginate` method.

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import Post from '#models/post'
import PostTransformer from '#transformers/post_transformer'

export default class PostsController {
  async index({ request, inertia }: HttpContext) {
    const page = request.input('page', 1)
    const posts = await Post.query()
      .orderBy('created_at', 'desc')
      .paginate(page, 20)

    return inertia.render('posts/index', {
      posts: PostTransformer.paginate(posts.all(), posts.getMeta()),
    })
  }
}
```

For a plain JSON API, wrap the transformer result with the `serialize` helper available on `HttpContext`. The serializer controls how the response is wrapped (for example, under a `data` key) and how the metadata is shaped.

```ts
// title: app/controllers/api/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import Post from '#models/post'
import PostTransformer from '#transformers/post_transformer'

export default class PostsController {
  async index({ request, serialize }: HttpContext) {
    const page = request.input('page', 1)
    const posts = await Post.query()
      .orderBy('created_at', 'desc')
      .paginate(page, 20)

    return serialize(
      PostTransformer.paginate(posts.all(), posts.getMeta())
    )
  }
}
```

See the [AdonisJS transformers documentation](https://docs.adonisjs.com/guides/frontend/transformers) for the full workflow of defining transformers and configuring a serializer.

## Rendering pagination in Edge templates

For hypermedia applications that render HTML, the paginator's `getUrlsForRange` method returns the data needed to build a numbered link list.

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import Post from '#models/post'

export default class PostsController {
  async index({ request, view }: HttpContext) {
    const page = request.input('page', 1)
    const posts = await Post.query()
      .orderBy('created_at', 'desc')
      .paginate(page, 20)

    posts.baseUrl('/posts')

    return view.render('posts/index', { posts })
  }
}
```

```edge
{{-- title: resources/views/posts/index.edge --}}
<div>
  @each(post in posts)
    <h2>{{ post.title }}</h2>
    <p>{{ excerpt(post.body, 200) }}</p>
  @endeach
</div>

@if(posts.hasPages)
  <nav>
    @if(posts.getPreviousPageUrl())
      <a href="{{ posts.getPreviousPageUrl() }}">Previous</a>
    @endif

    @each(link in posts.getUrlsForRange(1, posts.lastPage))
      <a href="{{ link.url }}" class="{{ link.isActive ? 'active' : '' }}">
        {{ link.page }}
      </a>
    @endeach

    @if(posts.getNextPageUrl())
      <a href="{{ posts.getNextPageUrl() }}">Next</a>
    @endif
  </nav>
@endif
```

Each object returned by `getUrlsForRange` has `url`, `page`, and `isActive` fields. Use `isActive` to style the current page link differently from the others. For result sets with many pages, compose a narrower range yourself by passing explicit bounds to `getUrlsForRange` rather than rendering every page as a link.

## Paginating related records

`paginate` also works on model relationships. The canonical use case is showing a paginated slice of records that belong to a single parent, such as the comments on a post.

```ts
// title: app/controllers/comments_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import Post from '#models/post'

export default class CommentsController {
  async index({ params, request }: HttpContext) {
    const post = await Post.findOrFail(params.postId)
    const page = request.input('page', 1)

    return post
      .related('comments')
      .query()
      .orderBy('created_at', 'desc')
      .paginate(page, 20)
  }
}
```

Pagination is supported on `hasMany`, `manyToMany`, and `hasManyThrough` relationships. Calling `paginate` on a `belongsTo` or `hasOne` relationship throws, because those relationships return a single record by definition.

## Performance considerations

`paginate` runs a separate `COUNT` query that wraps your main query as a subquery, with orders, limits, and offsets stripped. On small and medium tables this cost is negligible. On very large tables the `COUNT` query can become the slowest part of the request, because the database scans the entire result set to compute the total.

A few patterns work well when `COUNT` is too expensive:

- Cache the total count and refresh it on a schedule, so every page view does not pay the full cost.
- Use an approximate count from the database's system tables (for example, `pg_class.reltuples` on PostgreSQL) when a precise total is not required.
- Switch to keyset (cursor) pagination, which orders by an indexed column and uses a `where id > lastId` clause to move forward. Keyset pagination does not require a `COUNT` query and scales to arbitrarily large tables, but it does not support jumping to a specific page number. Lucid does not include a built-in helper for keyset pagination; compose it with the query builder directly.

## Next steps

- [Select query builder guide](../query_builders/select.md) for the filtering and ordering options you will combine with pagination.
- [Models guide](../models/introduction.md) for the full model workflow around `Model.query().paginate()`.
