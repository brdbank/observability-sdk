# Database & Service Instrumentation

The SDK provides instrumentation plugins that automatically create OpenTelemetry spans for database queries, Redis commands, and Kafka messages. Each plugin wraps an OTel instrumentation library and gracefully degrades if the peer dependency is missing.

---

## Overview

| Plugin | What It Instruments | Peer Dependency | Span Type |
|--------|-------------------|-----------------|-----------|
| `httpInstrumentation()` | Inbound/outbound HTTP | `@opentelemetry/instrumentation-http` (included) | `HTTP GET /api/loans` |
| `sequelizeInstrumentation()` | Sequelize ORM queries | `opentelemetry-instrumentation-sequelize` | `SELECT applications` |
| `kafkaInstrumentation()` | KafkaJS produce/consume | `@opentelemetry/instrumentation-kafkajs` | `topic send` / `topic process` |
| `redisInstrumentation()` | ioredis commands | `@opentelemetry/instrumentation-ioredis` | `GET`, `SET`, `HGET` |
| `mysqlInstrumentation()` | mysql2 queries | `@opentelemetry/instrumentation-mysql2` | `SELECT loans` |
| `pgInstrumentation()` | pg client queries | `@opentelemetry/instrumentation-pg` | `SELECT applications` |

Add plugins to your config:

```typescript
ObservabilityModule.forRoot({
  serviceName: 'loan-service',
  instrumentations: [
    httpInstrumentation(),
    sequelizeInstrumentation({ slowQueryThreshold: 1000 }),
    kafkaInstrumentation(),
    redisInstrumentation(),
  ],
})
```

---

## Sequelize

The most feature-rich plugin. Provides OTel tracing, structured query logging, slow query detection, and SQL sanitization.

### Install

```bash
npm install opentelemetry-instrumentation-sequelize
```

### Configuration

```typescript
import { sequelizeInstrumentation } from '@brdrwanda/observability';

sequelizeInstrumentation({
  logging: true,            // default: true — enable structured query logging
  tracing: true,            // default: true — create OTel spans for queries
  sanitizeQueries: true,    // default: true — strip literal values from SQL
  captureSqlText: false,    // default: false — include SQL in log metadata
  slowQueryThreshold: 500,  // default: 500ms — queries slower than this emit db.slow_query warning
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `logging` | `boolean` | `true` | Enable structured query logging via the SDK logger |
| `tracing` | `boolean` | `true` | Create OpenTelemetry spans for each query |
| `sanitizeQueries` | `boolean` | `true` | Replace literal values with `?` before logging |
| `captureSqlText` | `boolean` | `false` | Include the SQL statement in log metadata as `db.statement` |
| `slowQueryThreshold` | `number` (ms) | `500` | Queries slower than this emit a `db.slow_query` warning |

### Structured Query Logging

Wire the logging function into Sequelize:

```typescript
import { createSequelizeLogging, createSequelizeErrorLogging, ObservabilityLogger } from '@brdrwanda/observability';

const sequelize = new Sequelize({
  dialect: 'mysql',
  logging: createSequelizeLogging(logger, { slowQueryThreshold: 1000 }),
});
```

Normal queries log at `debug` level with event `db.query`:

```json
{
  "level": "debug",
  "msg": "query executed",
  "event": "db.query",
  "db.operation": "SELECT",
  "table": "applications",
  "duration_ms": 12,
  "success": true
}
```

Slow queries log at `warn` level with event `db.slow_query`:

```json
{
  "level": "warn",
  "msg": "slow query detected",
  "event": "db.slow_query",
  "db.operation": "SELECT",
  "table": "applications",
  "duration_ms": 2340,
  "success": true
}
```

### Error Logging

```typescript
import { createSequelizeErrorLogging } from '@brdrwanda/observability';

const sequelize = new Sequelize({
  dialect: 'mysql',
  logging: createSequelizeLogging(logger),
  dialectOptions: {
    // Sequelize doesn't have a built-in error logging hook,
    // but you can use createSequelizeErrorLogging in try/catch blocks
  },
});

// In your repository
try {
  await this.loanModel.create(data);
} catch (error) {
  createSequelizeErrorLogging(this.logger)(error, 'INSERT INTO loans ...');
  throw error;
}
```

Error log output:

```json
{
  "level": "error",
  "msg": "query failed",
  "event": "db.query_error",
  "db.operation": "INSERT",
  "table": "loans",
  "success": false,
  "error": "Duplicate entry 'LN-001' for key 'PRIMARY'"
}
```

---

## Kafka

Automatic span creation for KafkaJS producer and consumer operations, plus helpers for manual trace context propagation.

### Install

```bash
npm install @opentelemetry/instrumentation-kafkajs
```

### Configuration

```typescript
import { kafkaInstrumentation } from '@brdrwanda/observability';

// No options — the plugin wraps KafkaJsInstrumentation directly
kafkaInstrumentation()
```

### Trace Context Propagation

Inject trace headers when producing messages, extract them when consuming:

```typescript
import { injectKafkaHeaders, withKafkaContext } from '@brdrwanda/observability';

// Producer: inject traceparent into message headers
await producer.send({
  topic: 'loan-applications',
  messages: [{
    key: applicationId,
    value: JSON.stringify(payload),
    headers: injectKafkaHeaders(),
  }],
});

// Consumer: extract trace context and run in a linked span
await withKafkaContext(message.headers, 'process-loan-application', async () => {
  // This code runs inside a CONSUMER span linked to the producer's trace
  logger.info('processing application', { applicationId });
  await processApplication(message.value);
});
```

`injectKafkaHeaders()` reads the active OTel context and returns headers with `traceparent` injected. Pass existing headers as an argument to merge: `injectKafkaHeaders(existingHeaders)`.

`withKafkaContext(headers, spanName, fn)` extracts trace context from message headers, creates a CONSUMER span, and runs `fn` inside that context. If `fn` throws, the span is marked as ERROR and the exception is recorded.

---

## Redis

Automatic span creation for ioredis commands.

### Install

```bash
npm install @opentelemetry/instrumentation-ioredis
```

### Configuration

```typescript
import { redisInstrumentation } from '@brdrwanda/observability';

// No options — wraps IORedisInstrumentation directly
redisInstrumentation()
```

### What You Get

Every ioredis command creates a span with:

| Attribute | Example |
|-----------|---------|
| `db.system` | `redis` |
| `db.statement` | `GET session:abc123` |
| `net.peer.name` | `redis-host` |
| `net.peer.port` | `6379` |

If the ioredis package is not installed, the plugin logs a debug message and skips silently.

---

## MySQL

Automatic span creation for mysql2 queries.

### Install

```bash
npm install @opentelemetry/instrumentation-mysql2
```

### Configuration

```typescript
import { mysqlInstrumentation } from '@brdrwanda/observability';

// No options — wraps MySQL2Instrumentation directly
mysqlInstrumentation()
```

### What You Get

Every mysql2 query creates a span with:

| Attribute | Example |
|-----------|---------|
| `db.system` | `mysql` |
| `db.statement` | `SELECT * FROM loans WHERE id = ?` |
| `db.name` | `brd_loans` |
| `net.peer.name` | `mysql-host` |

---

## PostgreSQL

Automatic span creation for pg client queries.

### Install

```bash
npm install @opentelemetry/instrumentation-pg
```

### Configuration

```typescript
import { pgInstrumentation } from '@brdrwanda/observability';

// No options — wraps PgInstrumentation directly
pgInstrumentation()
```

### What You Get

Every pg query creates a span with:

| Attribute | Example |
|-----------|---------|
| `db.system` | `postgresql` |
| `db.statement` | `SELECT * FROM applications WHERE status = $1` |
| `db.name` | `brd_applications` |

---

## Graceful Degradation

All plugins use `try/catch` around the `require()` call for their peer dependency. If the package is not installed:

- A `console.debug` message is logged (e.g., `[observability] Install @opentelemetry/instrumentation-ioredis for Redis tracing`)
- The plugin returns `null` and is skipped
- Your application runs normally — you just don't get spans for that technology

This means you can safely include all plugins in your config even if not all peer dependencies are installed yet.

---

## See Also

- [Configuration Reference](configuration.md) — full instrumentation options table
- [Distributed Tracing](tracing.md) — how traces work, custom spans
- [Getting Started](getting-started.md) — which instrumentations to install
