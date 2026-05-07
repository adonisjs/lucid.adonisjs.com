---
summary: Inspect, open, close, register, and patch database connections at runtime with Lucid's connection manager, and listen to connection lifecycle events.
---

# Connection manager

This guide covers `db.manager`, the connection manager that tracks every registered database connection. You will learn how to:

- Inspect which connections are registered and which are currently open
- Open, close, and release named connections
- Register a new connection at runtime for multi-tenant workflows
- Replace an existing connection's config without dropping in-flight queries
- Subscribe to connection lifecycle events
- Reach the underlying knex instance and its pool

## Overview

When the app boots, Lucid reads every connection defined in `config/database.ts` and registers it with the manager. Registration records the config but does not open the pool. The pool is created lazily on the first query and reused for the rest of the process lifetime. AdonisJS closes every open pool during application shutdown.

Application code rarely reaches for `db.manager` directly. The three cases where you do are runtime connection management (for example, per-tenant databases), scripts and Ace commands that need to close pools before the process exits, and observability code that logs or reports connection events.

## Access the manager

Import the `db` service and read the `manager` property.

```ts
// title: app/services/tenant_service.ts
import db from '@adonisjs/lucid/services/db'

export default class TenantService {
  listRegistered() {
    return Array.from(db.manager.connections.keys())
  }
}
```

`db.manager.connections` is a `Map<string, ConnectionNode>`. Each node carries the connection `name`, its `config`, the current `state`, and the live `connection` instance once the pool has been opened. The `state` field is one of `registered`, `open`, `migrating`, `closing`, or `closed`, and describes where the connection sits in its lifecycle.

## Check registration and connection status

Use `has(name)` to find out whether a connection name is registered with the manager, and `isConnected(name)` to find out whether its pool has actually been opened. A connection can be registered without being connected, since registration happens at boot but the pool opens on first use.

```ts
// title: app/services/diagnostics_service.ts
import db from '@adonisjs/lucid/services/db'

export default class DiagnosticsService {
  status(name: string) {
    return {
      registered: db.manager.has(name),
      connected: db.manager.isConnected(name),
    }
  }
}
```

Use `get(name)` to read the full `ConnectionNode`, for example when you need to inspect the current `state` or the `config` the connection was registered with.

```ts
const node = db.manager.get('primary')

if (node) {
  logger.info({ state: node.state, client: node.config.client })
}
```

## Open a connection eagerly

The pool is created lazily, so `connect(name)` is rarely needed. Reach for it from scripts that should fail fast when the database is unreachable, or from health probes that expect the pool to exist before polling it.

```ts
// title: commands/warm_pools.ts
import { BaseCommand } from '@adonisjs/core/ace'
import db from '@adonisjs/lucid/services/db'

export default class WarmPools extends BaseCommand {
  static commandName = 'pools:warm'

  async run() {
    db.manager.connect('primary')
    db.manager.connect('analytics')
  }
}
```

`connect` is a no-op when the connection is already open, and throws `E_UNMANAGED_DB_CONNECTION` when the name has not been registered through `config/database.ts` or `add`.

## Close and release connections

`close(name)` disconnects the pool for a single connection, and `closeAll()` disconnects every pool at once. Both accept an optional `release` flag that also removes the entry from the manager, so the name must be registered again with `add` before it can be used.

```ts
// title: commands/reports.ts
import { BaseCommand } from '@adonisjs/core/ace'
import db from '@adonisjs/lucid/services/db'

export default class Reports extends BaseCommand {
  static commandName = 'reports:run'

  async run() {
    try {
      await db.connection('analytics').from('daily_reports').select('*')
    } finally {
      await db.manager.closeAll()
    }
  }
}
```

Call `release(name)` to remove a connection from the manager entirely. When the connection is open, `release` closes it first before removing the entry.

:::warning
Do not close connections from normal HTTP request handlers. Later code in the same process can try to reuse the pool and fail. Close connections only from scripts, workers, tests, and shutdown flows that own the process lifecycle.
:::

See the [Manage connections in scripts](./database_service.md#manage-connections-in-scripts) section for a walkthrough of the same pattern in context.

## Register connections at runtime

Use `add(name, config)` to register a connection after the app has booted. This is the entry point for multi-tenant workflows where each tenant resolves to a separate database.

```ts
// title: app/services/tenant_connections.ts
import db from '@adonisjs/lucid/services/db'
import type { ConnectionConfig } from '@adonisjs/lucid/types/database'

export default class TenantConnections {
  register(tenantId: string, config: ConnectionConfig) {
    const name = `tenant:${tenantId}`

    if (!db.manager.has(name)) {
      db.manager.add(name, config)
    }

    return db.connection(name)
  }

  async forget(tenantId: string) {
    await db.manager.release(`tenant:${tenantId}`)
  }
}
```

The `config` argument has the same shape as the entries in `config/database.ts`. See the [Knex configuration options](https://knexjs.org/guide/#configuration-options) for the list of options supported by the underlying driver.

`add` is a no-op when the name is already registered, so it does not overwrite an existing config. Use `patch` to change the config of a registered connection, or `release` the old one first and then `add` the new one.

## Replace a connection's config

`patch(name, config)` updates the config of a registered connection. When the connection is currently open, the live pool is moved to an internal orphan set and disconnected in the background, which lets queries already in flight drain cleanly. The next call to `connect` or the next query through `db.connection(name)` opens a fresh pool with the new config.

```ts
import db from '@adonisjs/lucid/services/db'

db.manager.patch('tenant:acme', {
  client: 'pg',
  connection: { host: 'db-new.internal', database: 'acme' },
})
```

Calling `patch` on a name that is not yet registered is equivalent to `add`.

## Subscribe to lifecycle events

The manager emits three events on the AdonisJS [emitter](https://docs.adonisjs.com/guides/digging-deeper/emitter). Subscribe to them to log connection churn or forward it to an observability system.

```ts
// title: start/events.ts
import emitter from '@adonisjs/core/services/emitter'
import logger from '@adonisjs/core/services/logger'

emitter.on('db:connection:connect', (connection) => {
  logger.info({ connection: connection.name }, 'db connection opened')
})

emitter.on('db:connection:disconnect', (connection) => {
  logger.info({ connection: connection.name }, 'db connection closed')
})

emitter.on('db:connection:error', ([error, connection]) => {
  logger.error({ err: error, connection: connection.name }, 'db connection error')
})
```

The `db:connection:error` payload is a tuple of `[error, connection]`, unlike the other two events that receive the connection directly.

## Reach the underlying Connection

The `connection` property on a node is Lucid's `Connection` instance, a thin wrapper around a [knex](https://knexjs.org/) client and its [tarn](https://github.com/vincit/tarn.js) pool. Access it through `db.manager.get(name)?.connection`.

```ts
// title: app/services/pool_inspector.ts
import db from '@adonisjs/lucid/services/db'

export default class PoolInspector {
  usedConnections(name: string) {
    const connection = db.manager.get(name)?.connection
    if (!connection?.pool) {
      return 0
    }
    return connection.pool.numUsed()
  }
}
```

The `Connection` instance exposes `client` and `readClient` as the underlying knex instances for the write and read replicas; when replicas are not configured, `readClient` is the same instance as `client`. The `pool` and `readPool` getters return the tarn pools behind those clients, and both are `null` until the connection opens. `name`, `config`, `clientName`, and `hasReadWriteReplicas` are read-only metadata, and `ready` becomes `true` once at least one knex client exists. `dialectName` is the deprecated alias for `clientName` and is kept only for backwards compatibility.

Application code should prefer `db.connection(name)`, which returns a query client with the full set of builders, transactions, and replica-aware mode selection. Drop down to the raw `Connection` only to inspect the pool, call a knex API that Lucid does not surface, or build tooling around the low-level client.

## Next steps

- [Database service guide](./database_service.md) for the `db` service entry points and runtime connection selection.
- [Configuration guide](./configuration.md) for the shape of `config/database.ts` and the connection options.
- [Debugging guide](./debugging.md) for connection-level debug mode and the `db:query` event.
- [Knex docs](https://knexjs.org/) for the connection and pool options Lucid passes through to the driver.
