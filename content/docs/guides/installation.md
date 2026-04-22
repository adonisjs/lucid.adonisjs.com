---
summary: Get Lucid running in an AdonisJS application, create your first table, and start querying with a model.
---

# Installation and usage

This guide walks you through getting Lucid set up in an AdonisJS application. You will learn how to:

- Install Lucid into an existing application
- Review the database configuration produced by the configure command
- Create and run your first migration
- Build a model and query it from a controller
- Drop down to the raw query builder when you need to

## Overview

Lucid is included with new AdonisJS applications and configured to use SQLite out of the box. If your application was created with the starter kit, you already have a working database setup and can skip ahead to [Create your first table](#create-your-first-table).

If you are adding Lucid to an existing AdonisJS application, or you removed it earlier and want it back, follow the install section below. For applications that need PostgreSQL, MySQL, or another database from day one, see the [configuration guide](./configuration.md) for the complete set of driver and connection options.

## Install into an existing application

Install Lucid from the npm registry.

:::codegroup

```sh
// title: npm
npm i @adonisjs/lucid
```

```sh
// title: yarn
yarn add @adonisjs/lucid
```

```sh
// title: pnpm
pnpm add @adonisjs/lucid
```

:::

Run the configure command to register Lucid with the framework. The `--db` flag chooses the database driver, and SQLite is the fastest option for local verification.

```sh
// title: terminal
node ace configure @adonisjs/lucid --db=sqlite
```

:::disclosure{title="See steps performed by the configure command"}

1. Registers the Lucid service provider inside `adonisrc.ts`.

   ```ts
   // title: adonisrc.ts
   export default defineConfig({
     providers: [
       () => import('@adonisjs/lucid/database_provider'),
     ],
   })
   ```

2. Registers Lucid commands inside `adonisrc.ts`.

   ```ts
   // title: adonisrc.ts
   export default defineConfig({
     commands: [
       () => import('@adonisjs/lucid/commands'),
     ],
   })
   ```

3. Creates `config/database.ts` with the selected driver.

4. Adds environment variables and validations for the selected database.

5. Installs the required database driver.

:::

## Your database config

The configure command generates `config/database.ts` based on the driver you selected. The SQLite setup looks like this.

```ts
// title: config/database.ts
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'sqlite',
  connections: {
    sqlite: {
      client: 'better-sqlite3',
      connection: {
        filename: env.get('DB_DATABASE', 'tmp/db.sqlite3'),
      },
      useNullAsDefault: true,
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
    },
  },
})

export default dbConfig
```

The generator also adds the database file path to your `.env` file.

```dotenv
// title: .env
DB_DATABASE=tmp/db.sqlite3
```

The default path stores the SQLite database inside the `tmp/` directory that ships with every AdonisJS starter kit, so no further filesystem setup is required.

For connection strings, multiple connections, read/write replicas, pooling options, and driver-specific setup, see the [configuration guide](./configuration.md).

## Create your first table

Use the `make:migration` command to scaffold a migration file. The `--create` flag produces a migration that creates a new table.

```sh
// title: terminal
node ace make:migration posts --create=posts
```

Open the generated file and describe the columns for the `posts` table.

```ts
// title: database/migrations/1720000000000_create_posts_table.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'posts'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('title').notNullable()
      table.text('body').nullable()
      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
```

Run the migration to create the table in the database.

```sh
// title: terminal
node ace migration:run
```

Lucid applies any pending migration files, prints a confirmation for each one, and regenerates `database/schema.ts` with a typed schema class for every table that now exists. Your model will extend that schema class in the next step.

## Use a model

Lucid's primary workflow uses class-based models. A model maps a TypeScript class to a database table, inherits its column types from the generated schema, and lets you add relationships, lifecycle hooks, and domain methods alongside the data.

Generate a model for the `posts` table.

```sh
// title: terminal
node ace make:model Post
```

The generated model extends the schema class for the `posts` table, so you do not need to redeclare columns on the model itself.

```ts
// title: app/models/post.ts
import { PostsSchema } from '#database/schema'

export default class Post extends PostsSchema {}
```

Use the model inside a controller. `Post.create()` inserts a row and returns a model instance, and `Post.query()` returns a typed query builder scoped to the `posts` table.

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import Post from '#models/post'

export default class PostsController {
  async store({ request }: HttpContext) {
    return Post.create({
      title: request.input('title'),
      body: request.input('body'),
    })
  }

  async index() {
    return Post.query().orderBy('id', 'desc')
  }
}
```

Wire the controller up in `start/routes.ts` so you can call it over HTTP.

```ts
// title: start/routes.ts
import router from '@adonisjs/core/services/router'

const PostsController = () => import('#controllers/posts_controller')

router.get('/posts', [PostsController, 'index'])
router.post('/posts', [PostsController, 'store'])
```

Start the dev server and send a request to `POST /posts` to create your first row, then `GET /posts` to read it back. You now have a working end-to-end Lucid setup.

Define columns directly on the model only when you need to override generated schema behavior, such as custom serialization, `prepare` and `consume` transformations, or accessors with custom logic. For everything else, the generated schema class remains the source of truth.

## Query without a model

You can also use the `db` service directly to insert and read rows without going through a model. This path is useful for one-off queries, reports, or internal scripts where the full model machinery is more than you need.

```ts
// title: app/controllers/posts_controller.ts
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class PostsController {
  async store({ request }: HttpContext) {
    const [post] = await db
      .table('posts')
      .insert({
        title: request.input('title'),
        body: request.input('body'),
      })
      .returning(['id', 'title', 'body'])

    return post
  }

  async index() {
    return db
      .from('posts')
      .select('id', 'title', 'body')
      .orderBy('id', 'desc')
  }
}
```

See the [database service guide](./database_service.md) for the full set of entry points on the `db` service.

## Next steps

- [Configuration guide](./configuration.md) for all database config options, connection strings, replicas, and pooling.
- [Database service guide](./database_service.md) for the `db` service entry points.
- [Select query builder guide](../query_builders/select.md) for detailed select, update, delete, and pagination APIs.
- [Models guide](../models/introduction.md) for the full Active Record workflow, relationships, hooks, and scopes.
