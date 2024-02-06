---
summary: A guide on debugging Lucid database queries.
---

# Debugging

Lucid emits the `db:query` event when debugging is enabled globally or for an individual query.

You can enable debugging globally by setting the `debug` flag to `true` inside the `config/database.ts` file.

```ts
// title: config/database.ts
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
      },
      // highlight-start
      debug: true
      // highlight-end
    },
  },
})
```

You can enable debugging for an individual query using the `debug` method on the query builder.

:::codegroup

```ts
// title: Select
db
  .query()
  .select('*')
  // highlight-start
  .debug(true)
  // highlight-end
```

```ts
// title: Insert
db
  .insertQuery()
  // highlight-start
  .debug(true)
  // highlight-end
  .insert({})
```

```ts
// title: Raw
db
  .rawQuery('select * from users')
  // highlight-start
  .debug(true)
  // highlight-end
```

:::

## Listening to the Event

Once you have enabled debugging, you can listen for the `db:query` event using the [emitter](https://docs.adonisjs.com/emitter) service.

```ts
// title: start/events.ts
import emitter from '@adonisjs/core/services/emitter'

emitter.on('db:query', function ({ sql, bindings }) {
  console.log(sql, bindings)
})
```

### Pretty print queries

You can use the `db.prettyPrint` method as the event listener to pretty-print the queries on the console.

```ts
// title: start/events.ts
import emitter from '@adonisjs/core/services/emitter'
import db from '@adonisjs/lucid/services/db'

emitter.on('db:query', db.prettyPrint)
```

## Debugging in production

Pretty printing queries add additional overhead to the process and can impact the performance of your application. Hence, we recommend using the [Logger](https://docs.adonisjs.com/logger) to log the database queries during production.

Following is a complete example of switching the event listener based upon the application environment.

```ts
// title: start/events.ts
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'

import logger from '@adonisjs/core/services/logger'
import app from '@adonisjs/core/services/app'

emitter.on('db:query', (query) => {
  if (app.inProduction) {
    logger.debug(query)
  } else {
    db.prettyPrint(query)
  }
})
```
