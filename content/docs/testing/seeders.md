---
summary: Database seeders insert initial or sample data through Ace commands. Use them for reference tables, local development fixtures, and test setup.
---

# Database seeders

This guide covers database seeders. You will learn how to:

- Create a seeder and run it through Ace
- Limit a seeder to specific environments
- Write idempotent seeders that can run safely on every boot
- Target a specific database connection
- Control the order in which seeders run

## Overview

A seeder is a class that inserts data into the database. Use them for reference tables that ship with your application (countries, currencies, permissions), for local development fixtures, and for tests that need a consistent starting state.

Seeders are stored inside `database/seeders/`. Generate one with the `make:seeder` Ace command.

```sh
node ace make:seeder User
// CREATE: database/seeders/user_seeder.ts
```

Every seeder extends `BaseSeeder` and implements an async `run` method. Inside `run`, use Lucid models, the database query builder, or raw SQL. The seeder does not care which tool you reach for.

```ts
// title: database/seeders/user_seeder.ts
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'

export default class UserSeeder extends BaseSeeder {
  async run() {
    await User.createMany([
      { email: 'virk@adonisjs.com', password: 'secret' },
      { email: 'romain@adonisjs.com', password: 'supersecret' },
    ])
  }
}
```

## Running seeders

Run every seeder in `database/seeders` with the `db:seed` command.

```sh
node ace db:seed
```

Pass `--files` one or more times to run only specific seeder files. Use the full path so your shell's autocomplete can help.

```sh
node ace db:seed --files "./database/seeders/user_seeder.ts"
```

Use `--interactive` to pick seeders interactively at the prompt.

```sh
node ace db:seed -i
```

See the [commands reference](../guides/commands.md#db-seed) for the complete flag list, including `--connection` and `--compact-output`.

## Environment-specific seeders

Set the `static environment` property on a seeder to limit it to one or more environments. The seeder runs only when the application's environment matches one of the listed values.

```ts
import { BaseSeeder } from '@adonisjs/lucid/seeders'

export default class UserSeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {}
}
```

Without `environment`, a seeder runs in every environment. Use the flag to keep development fixtures and test data out of production runs.

## Idempotent seeders

Lucid does not track which seeders have already run. Calling `db:seed` twice executes every seeder twice, which is fine for seeders that create new rows each run but wrong for reference data that should exist exactly once.

For reference data, use `updateOrCreateMany` or `fetchOrCreateMany` to make the seeder idempotent. Lucid looks up existing rows by the unique key you provide and inserts only the missing ones.

```ts
// title: database/seeders/country_seeder.ts
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import Country from '#models/country'

export default class CountrySeeder extends BaseSeeder {
  async run() {
    await Country.updateOrCreateMany('isoCode', [
      { isoCode: 'IN', name: 'India' },
      { isoCode: 'FR', name: 'France' },
      { isoCode: 'TH', name: 'Thailand' },
    ])
  }
}
```

Running this seeder repeatedly never produces duplicates. The first run inserts three rows; subsequent runs update the existing rows with the provided values and insert any new entries.

## Targeting a specific connection

The `db:seed` command accepts a `--connection` flag. Every seeder receives the matching query client as `this.client`, which you forward to Lucid models through the `client` option on their static methods.

```ts
// title: database/seeders/user_seeder.ts
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'

export default class UserSeeder extends BaseSeeder {
  async run() {
    await User.create(
      { email: 'virk@adonisjs.com', password: 'secret' },
      { client: this.client }
    )
  }
}
```

Run the seeder against a specific connection with the command flag.

```sh
node ace db:seed --connection=tenant-a
```

`this.client` is a full `QueryClientContract`, so you can also drop down to the database query builder for raw operations on the same connection.

```ts
await this.client.table('users').insert({ email: 'virk@adonisjs.com' })
```

## Seeders config

Seeder configuration lives under the connection's `seeders` object in `config/database.ts`.

```ts
// title: config/database.ts
{
  postgres: {
    client: 'pg',
    seeders: {
      paths: ['./database/seeders'],
      naturalSort: true,
    },
  },
}
```

See the [configuration guide](../guides/configuration.md#seeders-config) for the complete field reference.

## Controlling seeder order

`db:seed` runs seeders in the order returned by the filesystem, which is not guaranteed to match the order you care about. Reference tables usually need to run before tables that reference them.

Two patterns solve this. Pick whichever suits the project.

### Number the filenames

Prefix seeder filenames with a counter so alphabetical sort produces the correct order.

```
database/seeders/
  01_category_seeder.ts
  02_user_seeder.ts
  03_post_seeder.ts
```

This works without any configuration and reads cleanly from the filesystem.

### Use a main seeder

For more complex orderings (conditional seeding, shared setup), create a single seeder that imports and invokes the others in the order you want, then configure `db:seed` to run only this seeder.

Create the main seeder.

```sh
node ace make:seeder main/index
// CREATE: database/seeders/main/index_seeder.ts
```

Point the seeders config at the `main` directory so `db:seed` only runs the index seeder.

```ts
// title: config/database.ts
{
  postgres: {
    client: 'pg',
    seeders: {
      paths: ['./database/seeders/main'],
    },
  },
}
```

Import and invoke each seeder inside the index. Use `app.nodeEnvironment` to respect each seeder's `environment` declaration yourself, since the runner only applies the `environment` check when invoking the top-level seeder (the index) directly.

```ts
// title: database/seeders/main/index_seeder.ts
import app from '@adonisjs/core/services/app'
import { BaseSeeder } from '@adonisjs/lucid/seeders'

export default class IndexSeeder extends BaseSeeder {
  private async seed(SeederModule: { default: typeof BaseSeeder }) {
    const Seeder = SeederModule.default

    if (Seeder.environment && !Seeder.environment.includes(app.nodeEnvironment)) {
      return
    }

    await new Seeder(this.client).run()
  }

  async run() {
    await this.seed(await import('#database/seeders/category_seeder'))
    await this.seed(await import('#database/seeders/user_seeder'))
    await this.seed(await import('#database/seeders/post_seeder'))
  }
}
```

Run the seeders as usual. Only the index seeder matches the configured paths, and it orchestrates the rest.

```sh
node ace db:seed
```
