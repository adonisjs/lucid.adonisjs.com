---
summary: A guide on debugging Lucid database queries.
---

# Debugging

Lucid emits the `db:query` event when debugging is enabled globally or for an individual query.

You can enable debugging globally by setting the `debug` flag to `true` inside the `config/database.ts` file.

```ts
{
  client: 'pg',
  connection: {},
  debug: true, // 👈
}
```

You can enable debugging for an individual query using the `debug` method on the query builder.

:::codegroup

```ts
// title: Select
db.query().select('*').debug(true) // 👈
```

```ts
// title: Insert
db.insertQuery()
  .debug(true) // 👈
  .insert({})
```

```ts
// title: Raw
db.rawQuery('select * from users').debug(true) // 👈
```

:::

## Listening to the Event

Once you have enabled debugging, you can listen for the `db:query` event using the [Event](../digging-deeper/events.md) module.

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
import emitter from '@adonisjs/core/services/emitter'
import db from '@adonisjs/lucid/services/db'

emitter.on('db:query', db.prettyPrint)
```

![](https://res.cloudinary.com/adonis-js/image/upload/q_auto,f_auto/v1618890917/v5/query-events.png)

## Debugging in production

Pretty printing queries add additional overhead to the process and can impact the performance of your application. Hence, we recommend using the [Logger](../digging-deeper/logger.md) to log the database queries during production.

Following is a complete example of switching the event listener based upon the application environment.

```ts
import db from '@adonisjs/lucid/services/db'
import emitter from '@adonisjs/core/services/emitter'

import logger from '@adonisjs/core/services/logger'
import app from '@adonisjs/core/services/app'

emitter.on('db:query', (query) => {
  if (app.inProduction) {
    logger.debug(query)
  } else {
    Database.prettyPrint(query)
  }
})
```
