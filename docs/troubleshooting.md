# Troubleshooting & FAQ

Common issues, their causes, and how to fix them. If you don't find your answer here, check the [Getting Started](getting-started.md) and [SDK Explained](sdk-explained.md) guides.

---

## Startup Warnings

These messages appear in the console when your application boots. They are **informational** — not errors.

### `[observability] Install @opentelemetry/instrumentation-ioredis for Redis tracing`

The SDK detected that your service uses Redis but the optional tracing package for Redis is not installed. Redis will work normally — you just won't get Redis spans in your traces.

To fix (optional):

```bash
npm install @opentelemetry/instrumentation-ioredis
```

### `[observability] Install opentelemetry-instrumentation-sequelize for Sequelize tracing`

Same idea, but for Sequelize. Your database queries will work fine — you just won't see them as spans in Tempo.

To fix (optional):

```bash
npm install opentelemetry-instrumentation-sequelize
```

### `Swagger setup failed — skipping`

This is **not related to the observability SDK**. It means your Swagger/OpenAPI configuration has an issue (missing `DocumentBuilder`, incorrect path, etc.). The SDK will continue to function normally regardless of this message.

---

## No Logs Appearing

| Symptom | Cause | Fix |
|---------|-------|-----|
| No logs at all | Logger not wired in `main.ts` | Add `app.useLogger(app.get(NestPinoLogger))` after creating the app |
| Logs appear but no `trace_id` | Tracing disabled or not initialized | Check that `tracing.enabled` is `true` in your config |
| Pretty logs in production | `NODE_ENV` not set to `'production'` | Set `NODE_ENV=production` in your PM2 ecosystem file or Dockerfile |
| Health endpoint logs spam | `excludeRoutes` not configured | Set `logger: { excludeRoutes: ['/health', '/metrics'] }` — this is the default on latest version |

### Example: Wiring the logger in main.ts

```typescript
import { NestPinoLogger } from '@brdrwanda/observability';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(NestPinoLogger));
  await app.listen(3000);
}
```

---

## Tracing Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| No traces in Tempo | Exporter type is `'console'` or `'none'` | Change to `'otlp-http'` in your tracing config |
| Partial traces (missing services) | Trace context not propagated in outgoing HTTP | Add `propagation.inject(otelContext.active(), headers)` to your AxiosService |
| Missing DB spans | Instrumentation not registered | Add `sequelizeInstrumentation()` to your config's `instrumentations` array |
| Missing spans on first request | Tracing started after module import | Call `setupTracing()` in `main.ts` **before** `NestFactory.create` |
| `trace_id` in logs but not in Tempo | Exporter not sending or collector down | Check `curl http://otel-collector:4318/v1/traces` returns a response |

### Example: Propagating trace context in outgoing requests

```typescript
import { propagation, context as otelContext } from '@opentelemetry/api';

// In your AxiosService or HTTP client wrapper
async makeRequest(url: string, data: any) {
  const headers = {};
  propagation.inject(otelContext.active(), headers);

  return this.httpService.post(url, data, { headers });
}
```

### Example: Calling setupTracing() before NestFactory

```typescript
import { setupTracing } from '@brdrwanda/observability';

async function bootstrap() {
  setupTracing({
    serviceName: 'my-service',
    tracing: { exporter: { type: 'otlp-http' } },
  }); // Must come BEFORE NestFactory.create
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // ...
}
```

---

## Metrics Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `/metrics` returns 404 | `metrics.enabled` is `false` | Set `metrics: { enabled: true }` in your config |
| No custom metrics appearing | Metric created but never incremented | Call `.inc()` or `.observe()` on your metric after creating it |
| Prometheus can't scrape | Wrong port or network | Check your `prometheus.yml` targets match the actual host and port |

### Example: Enabling metrics

```typescript
ObservabilityModule.forRoot({
  serviceName: 'my-service',
  metrics: {
    enabled: true,
  },
  // ...
});
```

---

## PM2 Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Pretty-printed logs in PM2 | `NODE_ENV` not passed to child process | Use `ecosystem.config.js` with `env: { NODE_ENV: 'production' }` |
| Promtail not finding logs | Wrong log path | Point Promtail to `~/.pm2/logs/*-out.log` |
| Log files growing indefinitely | No log rotation | Install pm2-logrotate: `pm2 install pm2-logrotate` |

### Example: ecosystem.config.js

```javascript
module.exports = {
  apps: [
    {
      name: 'my-service',
      script: 'dist/main.js',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

### Example: Promtail config pointing to PM2 logs

```yaml
scrape_configs:
  - job_name: pm2
    static_configs:
      - targets: [localhost]
        labels:
          job: pm2
          __path__: ~/.pm2/logs/*-out.log
```

---

## FAQ

**Q: Can I use this SDK with Express (no NestJS)?**
A: Yes, use the standalone API:

```typescript
import { createObservability } from '@brdrwanda/observability';
```

---

**Q: Do I need to remove my existing Winston/Morgan logger?**
A: Yes, during migration. The SDK replaces both. See the [Migration Guide](migration.md).

---

**Q: Will this SDK work with NestJS 10 AND 11?**
A: Yes. Peer dependencies support both `^10.0.0 || ^11.0.0`.

---

**Q: How do I add logging to a service that doesn't use the SDK yet?**
A: Follow the [Getting Started](getting-started.md) guide — 3 steps, 10 minutes.

---

**Q: Can I disable auto-request logging but keep error logging?**
A: Yes:

```typescript
ObservabilityModule.forRoot({
  serviceName: 'my-service',
  logger: {
    autoRequestLogging: false,
    autoErrorLogging: true,
  },
});
```

---

**Q: How much overhead does the SDK add?**
A: Roughly ~0.1ms per request for the logging interceptor. Tracing adds ~0.2ms. Both are negligible compared to business logic, database queries, and network calls.

---

**Q: What happens if the OTel Collector is down?**
A: Traces are dropped silently. Logs and metrics continue working — they don't depend on the collector. Your application will not crash or hang.

---

**Q: How do I see logs from multiple services for one request?**
A: Query Loki with the `trace_id`. In Grafana's Explore view, use:

```
{service_name=~".+"} | json | trace_id="your-trace-id"
```

This returns every log line across all services that share that trace.

---

## Diagnostics

The SDK ships with a `DiagnosticsService` that reports its internal state. Use it to verify that the SDK is configured correctly in a running service.

```typescript
import { DiagnosticsService } from '@brdrwanda/observability';

@Controller('debug')
export class DebugController {
  constructor(private diagnostics: DiagnosticsService) {}

  @Get('diagnostics')
  getDiagnostics() {
    return this.diagnostics.getReport();
  }
}
```

The report includes:

- **SDK version** — the installed version of `@brdrwanda/observability`
- **Service info** — service name, environment, version
- **Active instrumentations** — which instrumentation plugins are loaded (HTTP, Redis, Kafka, Sequelize, etc.)
- **Tracing config** — exporter type, endpoint, sampling rate, whether tracing is enabled
- **Metrics config** — whether metrics are enabled, prefix, endpoint path

Hit `GET /debug/diagnostics` to see the full report. This is the fastest way to verify that everything is wired up correctly.

> **Tip:** Restrict access to the diagnostics endpoint in production — it may expose internal configuration details.
