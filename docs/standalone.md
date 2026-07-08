# Standalone Mode (Express / Fastify / Plain Node.js)

Use the SDK without NestJS. The `createObservability()` function gives you a logger, tracer, metrics, and middleware — no dependency injection required.

---

## Quick Start

```typescript
import { createObservability } from '@brdrwanda/observability';

const obs = createObservability({
  serviceName: 'my-worker',
  tracing: { exporter: { type: 'otlp-http' } },
});
```

### What you get back

| Property | Type | Description |
|----------|------|-------------|
| `obs.logger` | `ObservabilityLogger` | Structured logger with `info`, `warn`, `error`, `debug`, `fatal`, `logCaughtError`, `child` |
| `obs.tracer` | `ObservabilityTracer` | Create custom spans, start active spans |
| `obs.metrics` | `ObservabilityMetrics` | Create counters, histograms, gauges |
| `obs.config` | `ResolvedConfig` | The resolved configuration |
| `obs.middleware()` | Express-compatible middleware | Adds request context, logs request_start/request_complete |
| `obs.metricsHandler` | HTTP handler | Serves `/metrics` endpoint for Prometheus scraping |
| `obs.healthHandler` | HTTP handler | Serves health check endpoint |
| `obs.shutdown()` | `Promise<void>` | Graceful shutdown — flushes traces and plugins |

---

## Express Integration

```typescript
import express from 'express';
import { createObservability } from '@brdrwanda/observability';

const app = express();
const obs = createObservability({
  serviceName: 'loan-api',
  tracing: { exporter: { type: 'otlp-http', endpoint: 'http://otel-collector:4318' } },
});

// Add request context middleware (trace_id, request_id, request logging)
app.use(obs.middleware());

// Expose metrics for Prometheus
app.get('/metrics', (req, res) => obs.metricsHandler(req, res));

// Expose health check
app.get('/health', (req, res) => obs.healthHandler(req, res));

// Use the logger in your routes
app.post('/api/loans', (req, res) => {
  obs.logger.info('loan application received', { applicantId: req.body.applicantId });
  // ... business logic
  res.status(201).json({ status: 'created' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await obs.shutdown();
  process.exit(0);
});

app.listen(3000, () => {
  obs.logger.info('server started', { port: 3000 });
});
```

---

## Worker / CLI Usage

For Kafka consumers, cron jobs, or CLI scripts that don't serve HTTP:

```typescript
import { createObservability } from '@brdrwanda/observability';
import { withKafkaContext } from '@brdrwanda/observability';

const obs = createObservability({
  serviceName: 'notification-worker',
  tracing: { exporter: { type: 'otlp-http' } },
});

async function processMessage(message: KafkaMessage) {
  await withKafkaContext(message.headers, 'process-notification', async () => {
    obs.logger.info('processing notification', { topic: message.topic });
    // ... business logic
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  await obs.shutdown();
  process.exit(0);
});
```

---

## Configuration

Standalone mode accepts the same `ObservabilityConfig` as the NestJS version. See the [Configuration Reference](configuration.md) for all options.

```typescript
const obs = createObservability({
  serviceName: 'my-service',
  environment: 'production',
  logger: { level: 'info', prettyPrint: false },
  tracing: {
    exporter: { type: 'otlp-http', endpoint: 'http://otel-collector:4318' },
    sampling: { ratio: 0.1 },
  },
  metrics: { enabled: true },
  instrumentations: [httpInstrumentation()],
  clientOrigins: { 'https://tugane.brd.rw': 'tugane-web' },
});
```

---

## What the Middleware Does

`obs.middleware()` returns an Express-compatible `(req, res, next)` function that:

1. Creates a request context (request_id, correlation_id, client_app)
2. Reads `x-client-app` header and resolves via `clientOrigins`
3. Logs `request started` with method and URL
4. On response finish, logs `request completed` with statusCode and duration_ms
5. Runs the handler inside `runWithContext()` so trace_id propagates to all logs

---

## Limitations vs NestJS Mode

| Feature | NestJS | Standalone |
|---------|--------|------------|
| Auto-registered interceptors (request logging, metrics) | Yes | Use `obs.middleware()` manually |
| Auto-registered exception filter | Yes | No — handle errors yourself |
| Dependency injection | Yes | No — use `obs.logger` / `obs.tracer` directly |
| Health endpoint auto-registered | Yes | Use `obs.healthHandler` manually |
| Metrics endpoint auto-registered | Yes | Use `obs.metricsHandler` manually |
| Graceful shutdown | Module handles it | Call `obs.shutdown()` on process exit |
| Controller/handler names in logs | Yes | No — middleware only has req.method/url |

---

## See Also

- [Getting Started](getting-started.md) — NestJS setup
- [Configuration Reference](configuration.md) — all config options
- [Structured Logging](logging.md) — logger API and Loki queries
