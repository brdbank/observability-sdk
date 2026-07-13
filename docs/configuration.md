# Configuration Reference

Complete reference for every configuration option available in `@brdrwanda/observability`.

The SDK is configured through `ObservabilityModule.forRoot(config)`, where `config` implements the `ObservabilityConfig` interface. Every option except `serviceName` has a sensible default, so you can start with a single line and add options as needed.

---

## Table of Contents

- [Minimal Configuration](#minimal-configuration)
- [Full Configuration Example](#full-configuration-example)
- [Environment-Aware Defaults](#environment-aware-defaults)
- [Logger Options](#logger-options)
- [Tracing Options](#tracing-options)
- [Metrics Options](#metrics-options)
- [Health Options](#health-options)
- [Redaction Options](#redaction-options)
- [Instrumentation Plugins](#instrumentation-plugins)
- [Client Origins](#client-origins)

---

## Minimal Configuration

```typescript
import { ObservabilityModule } from '@brdrwanda/observability';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'my-service',
    }),
  ],
})
export class AppModule {}
```

`serviceName` is the only required option. Everything else is assigned a sensible default based on the current environment. In development you get pretty-printed logs at `debug` level with console trace export; in production you get structured JSON logs at `info` level with OTLP export and 10% sampling.

---

## Full Configuration Example

```typescript
import {
  ObservabilityModule,
  httpInstrumentation,
  sequelizeInstrumentation,
  kafkaInstrumentation,
  redisInstrumentation,
} from '@brdrwanda/observability';

ObservabilityModule.forRoot({
  serviceName: 'my-service',
  environment: 'production',        // default: process.env.NODE_ENV || 'development'
  version: '1.2.3',                 // default: process.env.npm_package_version || '0.0.0'

  logger: {
    level: 'info',                  // 'debug' | 'info' | 'warn' | 'error' | 'fatal'
    prettyPrint: false,             // true in dev, false in prod
    autoRequestLogging: true,       // log request_start/request_complete automatically
    autoErrorLogging: true,         // log errors from exception filter
    logRequestBody: false,          // include req.body in request_start
    logResponseBody: false,         // include response body in request_complete
    excludeRoutes: ['/health', '/metrics'],  // skip these routes
    redaction: {
      paths: ['password', 'token'], // JSON paths to redact from logs
      censor: '[REDACTED]',         // replacement string for redacted values
    },
  },

  tracing: {
    enabled: true,
    exporter: {
      type: 'otlp-http',           // 'otlp-http' | 'otlp-grpc' | 'console' | 'none'
      endpoint: 'http://otel-collector:4318',
      headers: {},                  // additional headers (e.g. auth tokens)
    },
    sampling: {
      type: 'parent-based',        // 'always' | 'never' | 'probabilistic' | 'parent-based'
      ratio: 0.1,                  // 0-1, used by probabilistic and parent-based
    },
  },

  metrics: {
    enabled: true,
    prefix: '',
    defaultMetrics: true,
    endpoint: '/metrics',
    labels: { team: 'lending' },
  },

  health: {
    enabled: true,
    endpoint: '/health',
  },

  instrumentations: [
    httpInstrumentation(),
    sequelizeInstrumentation({ slowQueryThreshold: 1000 }),
    kafkaInstrumentation(),
    redisInstrumentation(),
  ],

  clientOrigins: {
    'http://localhost:3000': 'admin-frontend',
    'https://tugane.brd.rw': 'tugane-web',
  },

  redaction: {
    paths: ['password', 'token', 'authorization'],
    censor: '[REDACTED]',
  },
})
```

---

## Environment-Aware Defaults

The SDK detects the environment from `config.environment`, falling back to `process.env.NODE_ENV`, then `'development'`. Several defaults change automatically between development and production:

| Setting | Development | Production |
|---|---|---|
| `logger.level` | `'debug'` | `'info'` |
| `logger.prettyPrint` | `true` | `false` |
| `tracing.exporter.type` | `'console'` | `'otlp-http'` |
| `tracing.sampling.ratio` | `1.0` (all traces) | `0.1` (10% of traces) |
| Span processor | `SimpleSpanProcessor` | `BatchSpanProcessor` |

Any explicit value you provide always takes precedence over these environment-based defaults.

---

## Logger Options

Configured under the `logger` key. The logger is built on [pino](https://github.com/pinojs/pino) and automatically enriches every log entry with `service_name`, `environment`, `version`, `request_id`, `correlation_id`, `trace_id`, `span_id`, and `client_app`.

| Option | Type | Default | Description |
|---|---|---|---|
| `level` | `'debug' \| 'info' \| 'warn' \| 'error' \| 'fatal'` | `'debug'` in dev, `'info'` in prod | Minimum log level that will be emitted |
| `prettyPrint` | `boolean` | `true` in dev, `false` in prod | Enable colorized, human-readable output via `pino-pretty` |
| `autoRequestLogging` | `boolean` | `true` | Automatically log `request_start` and `request_complete` for every HTTP request |
| `autoErrorLogging` | `boolean` | `true` | Automatically log errors caught by the global exception filter |
| `logRequestBody` | `boolean` | `false` | Include `req.body` in the `request_start` log entry |
| `logResponseBody` | `boolean` | `false` | Include the response body in the `request_complete` log entry |
| `excludeRoutes` | `string[]` | `['/health', '/metrics']` | Routes to skip entirely — no request lifecycle logs emitted |
| `redaction.paths` | `string[]` | `DEFAULT_REDACTION_PATHS` (see [Redaction Options](#redaction-options)) | JSON paths to redact from log output |
| `redaction.censor` | `string` | `'[REDACTED]'` | Replacement string used for redacted values |

**Redaction precedence:** `logger.redaction` takes priority over the top-level `redaction` config. If `logger.redaction` is not set, the logger falls back to the top-level `redaction`, then to `DEFAULT_REDACTION_PATHS`.

---

## Tracing Options

Configured under the `tracing` key. Tracing uses OpenTelemetry under the hood.

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable or disable distributed tracing entirely |
| `exporter.type` | `'otlp-http' \| 'otlp-grpc' \| 'console' \| 'none'` | `'console'` in dev, `'otlp-http'` in prod | How trace data is exported |
| `exporter.endpoint` | `string` | `process.env.OTEL_EXPORTER_OTLP_ENDPOINT` or `'http://localhost:4318'` | The OpenTelemetry collector endpoint |
| `exporter.headers` | `Record<string, string>` | `{}` | Additional HTTP headers sent with each export (e.g. authentication) |
| `sampling.type` | `'always' \| 'never' \| 'probabilistic' \| 'parent-based'` | `'parent-based'` | Sampling strategy for root spans |
| `sampling.ratio` | `number` (0 to 1) | `1.0` in dev, `0.1` in prod | Fraction of traces to sample (used by `probabilistic` and `parent-based`) |

### Sampling Strategies

| Type | Behavior |
|---|---|
| `always` | Every trace is recorded (`AlwaysOnSampler`) |
| `never` | No traces are recorded (`AlwaysOffSampler`) |
| `probabilistic` | Each trace has a `ratio` chance of being recorded (`TraceIdRatioBasedSampler`) |
| `parent-based` | Respects the parent span's sampling decision; root spans use `ratio` (`ParentBasedSampler` wrapping `TraceIdRatioBasedSampler`) |

### Exporter Types

| Type | Package Required | Notes |
|---|---|---|
| `otlp-http` | `@opentelemetry/exporter-trace-otlp-http` (included) | Sends traces over HTTP to the collector's `/v1/traces` path |
| `otlp-grpc` | `@opentelemetry/exporter-trace-otlp-grpc` (install separately) | Sends traces over gRPC |
| `console` | None (built-in) | Prints spans to stdout; useful for local development |
| `none` | None | Disables trace export entirely (tracing still creates spans in-process) |

---

## Metrics Options

Configured under the `metrics` key. Metrics are exposed via a Prometheus-compatible HTTP endpoint.

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable or disable the metrics system and endpoint |
| `prefix` | `string` | `''` | Prefix prepended to all metric names (e.g. `'myapp_'`) |
| `defaultMetrics` | `boolean` | `true` | Collect default Node.js process metrics (CPU, memory, event loop, etc.) |
| `endpoint` | `string` | `'/metrics'` | HTTP path where Prometheus can scrape metrics |
| `labels` | `Record<string, string>` | `{ service: serviceName, environment }` | Default labels attached to every metric |

**Note:** The `service` and `environment` labels are always added automatically from the top-level config. Any labels you provide in `metrics.labels` are merged on top.

---

## Health Options

Configured under the `health` key. Provides a simple health check endpoint.

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable or disable the health check endpoint |
| `endpoint` | `string` | `'/health'` | HTTP path for the health check |

---

## Redaction Options

Configured at the top-level `redaction` key. These settings act as the global default for redaction across the SDK. The `logger.redaction` option can override these for log output specifically.

| Option | Type | Default | Description |
|---|---|---|---|
| `paths` | `string[]` | `DEFAULT_REDACTION_PATHS` (see below) | JSON paths whose values will be replaced with the censor string |
| `censor` | `string` | `'[REDACTED]'` | The replacement string used in place of sensitive values |

### Default Redaction Paths

The SDK ships with 17 default redaction paths that cover common sensitive fields:

| # | Path | What It Catches |
|---|---|---|
| 1 | `req.headers.authorization` | Authorization header on incoming requests |
| 2 | `req.headers.cookie` | Cookie header on incoming requests |
| 3 | `req.headers["set-cookie"]` | Set-Cookie header on incoming requests |
| 4 | `*.password` | Password fields at any depth |
| 5 | `*.secret` | Secret fields at any depth |
| 6 | `*.token` | Token fields at any depth |
| 7 | `*.accessToken` | Access token fields (camelCase) |
| 8 | `*.refreshToken` | Refresh token fields (camelCase) |
| 9 | `*.access_token` | Access token fields (snake_case) |
| 10 | `*.refresh_token` | Refresh token fields (snake_case) |
| 11 | `*.apiKey` | API key fields (camelCase) |
| 12 | `*.api_key` | API key fields (snake_case) |
| 13 | `*.connectionString` | Database connection strings (camelCase) |
| 14 | `*.connection_string` | Database connection strings (snake_case) |
| 15 | `*.creditCard` | Credit card numbers (camelCase) |
| 16 | `*.credit_card` | Credit card numbers (snake_case) |
| 17 | `*.ssn` | Social security numbers |

In addition to path-based redaction, the SDK sanitizes these HTTP headers at the middleware level (replaced with the censor string regardless of redaction config):

| Header |
|---|
| `authorization` |
| `cookie` |
| `set-cookie` |
| `x-api-key` |
| `x-auth-token` |
| `proxy-authorization` |

### Overriding Redaction

To replace the defaults entirely, set `redaction.paths` to your own array. To extend the defaults, import and spread them:

```typescript
import { DEFAULT_REDACTION_PATHS } from '@brdrwanda/observability';

ObservabilityModule.forRoot({
  serviceName: 'my-service',
  redaction: {
    paths: [...DEFAULT_REDACTION_PATHS, '*.nationalId', '*.bankAccount'],
  },
})
```

---

## Instrumentation Plugins

Configured under the `instrumentations` array. Each plugin wraps an OpenTelemetry instrumentation library and registers it with the tracer provider. Plugins that depend on an optional package will log a debug message and gracefully degrade if the package is not installed.

| Factory Function | Plugin Name | What It Instruments | Required Peer Dependency |
|---|---|---|---|
| `httpInstrumentation()` | `http` | Inbound and outbound HTTP requests | `@opentelemetry/instrumentation-http` (included) |
| `sequelizeInstrumentation()` | `sequelize` | Sequelize ORM queries | `opentelemetry-instrumentation-sequelize` |
| `kafkaInstrumentation()` | `kafka` | KafkaJS producer/consumer | `@opentelemetry/instrumentation-kafkajs` |
| `redisInstrumentation()` | `redis` | ioredis client commands | `@opentelemetry/instrumentation-ioredis` |
| `pgInstrumentation()` | `pg` | PostgreSQL queries via `pg` | `@opentelemetry/instrumentation-pg` |
| `mysqlInstrumentation()` | `mysql` | MySQL queries via `mysql2` | `@opentelemetry/instrumentation-mysql2` |

### HTTP Instrumentation Options

```typescript
httpInstrumentation({
  ignoreIncomingPaths: ['/health', '/metrics', /^\/internal\//],
  ignoreOutgoingUrls: ['metadata.google.internal'],
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `ignoreIncomingPaths` | `(string \| RegExp)[]` | `undefined` | Incoming request paths to exclude from tracing |
| `ignoreOutgoingUrls` | `(string \| RegExp)[]` | `undefined` | Outgoing request URLs to exclude from tracing |

### Sequelize Instrumentation Options

```typescript
sequelizeInstrumentation({
  slowQueryThreshold: 1000,
  captureSqlText: true,
  sanitizeQueries: true,
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `logging` | `boolean` | `true` | Enable structured query logging via the SDK logger |
| `tracing` | `boolean` | `true` | Enable OpenTelemetry span creation for queries |
| `sanitizeQueries` | `boolean` | `true` | Strip literal values from SQL before logging |
| `captureSqlText` | `boolean` | `false` | Include the SQL statement text in log metadata |
| `slowQueryThreshold` | `number` (ms) | `500` | Queries slower than this emit a `db.slow_query` warning |

### Kafka Helpers

Beyond the instrumentation plugin, the SDK exports two helper functions for Kafka context propagation:

```typescript
import { injectKafkaHeaders, withKafkaContext } from '@brdrwanda/observability';

// Producer: inject trace context into message headers
await producer.send({
  topic: 'orders',
  messages: [{ value: payload, headers: injectKafkaHeaders() }],
});

// Consumer: extract trace context from message headers
await withKafkaContext(message.headers, 'process-order', async () => {
  // this code runs inside a CONSUMER span linked to the producer trace
});
```

---

## Client Origins

Configured under the `clientOrigins` key as a `Record<string, string>`.

This mapping translates raw `Origin` or `Referer` request headers into human-readable application names. The resolved name is stored as `client_app` in the request context and automatically appears in every log entry for that request.

```typescript
clientOrigins: {
  'http://localhost:3000': 'admin-frontend',
  'https://admin.brd.rw': 'admin-web',
  'https://tugane.brd.rw': 'tugane-web',
  'https://mobile-api.brd.rw': 'mobile-app',
}
```

### How Resolution Works

1. The `ContextMiddleware` checks the `x-client-app` header first — if present, it wins immediately.
2. If `x-client-app` is not set, it reads the `Origin` header.
3. If `Origin` is not present, it extracts the origin from the `Referer` header.
4. The resolved origin string is looked up in the `clientOrigins` map.
5. If a match is found, the friendly name becomes `client_app`.
6. If no match is found, the raw origin string is used as `client_app`.

This makes it easy to filter and group logs by the calling application:

```json
{
  "level": "info",
  "msg": "request completed",
  "service_name": "loan-service",
  "client_app": "tugane-web",
  "request_id": "abc-123",
  "method": "POST",
  "url": "/api/loans",
  "statusCode": 201,
  "duration_ms": 42.17
}
```
