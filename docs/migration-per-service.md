# SDK Integration & Migration Checklist

A step-by-step implementation guide for integrating `@brdrwanda/observability` into any BRD NestJS service. Each step documents the objective, files to modify, example code, what to verify, and common pitfalls.

For background on why this migration is needed, see the [Migration Guide](migration.md).

---

## Table of Contents

1. [Step 1: Install the SDK](#step-1-install-the-sdk)
2. [Step 2: Configure main.ts](#step-2-configure-maints)
3. [Step 3: Configure app.module.ts](#step-3-configure-appmodulets)
4. [Step 4: Remove old logging infrastructure](#step-4-remove-old-logging-infrastructure)
5. [Step 5: Replace logger usage in services and controllers](#step-5-replace-logger-usage-in-services-and-controllers)
6. [Step 6: Add database instrumentation](#step-6-add-database-instrumentation)
7. [Step 7: Add Kafka trace propagation](#step-7-add-kafka-trace-propagation)
8. [Step 8: Add external API tracing](#step-8-add-external-api-tracing)
9. [Step 9: Replace console.log statements](#step-9-replace-consolelog-statements)
10. [Step 10: Configure deployment (PM2 / Docker)](#step-10-configure-deployment-pm2--docker)
11. [Step 11: Final verification](#step-11-final-verification)
12. [Files to delete checklist](#files-to-delete-checklist)
13. [Common pitfalls](#common-pitfalls)

---

## Step 1: Install the SDK

### Objective
Add `@brdrwanda/observability` and any instrumentation peer dependencies your service needs.

### Files to modify
- `package.json`

### What to do

```bash
# Install the SDK
npm install @brdrwanda/observability

# Remove old logging packages
npm uninstall winston nest-winston winston-daily-rotate-file morgan

# Add optional peer dependencies based on your service's stack
npm install -D pino-pretty                                          # pretty dev logs
npm install opentelemetry-instrumentation-sequelize                 # if using Sequelize
npm install @opentelemetry/instrumentation-ioredis                  # if using Redis
npm install @opentelemetry/instrumentation-kafkajs                  # if using KafkaJS
npm install @opentelemetry/instrumentation-mysql2                   # if using MySQL
npm install @opentelemetry/instrumentation-pg                       # if using PostgreSQL
```

If replacing an older SDK version under a different npm scope:

```bash
npm uninstall @old-scope/observability
npm install @brdrwanda/observability
```

### How to verify
- `npm ls @brdrwanda/observability` shows the package installed
- No peer dependency warnings related to `@nestjs/common` or `@nestjs/core`
- `npm ls winston` shows "empty" (uninstalled)

### Pitfalls
- Don't remove `morgan` or `winston` before completing the other steps — the service will break if old code still references them
- If your service has `@opentelemetry/*` packages already installed, check for version conflicts

---

## Step 2: Configure main.ts

### Objective
Set up process error handlers (catches bootstrap crashes), enable log buffering, and replace the NestJS logger with the SDK's Pino logger.

### Files to modify
- `src/main.ts`

### Before (typical existing service)

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(3000);
  console.log('Service running on port 3000');
}
bootstrap();
```

### After

```typescript
import { NestFactory } from '@nestjs/core';
import { setupProcessErrorHandlers, NestPinoLogger } from '@brdrwanda/observability';
import { AppModule } from './app.module';

setupProcessErrorHandlers({ serviceName: 'your-service-name' });

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(NestPinoLogger));
  await app.listen(3000);
}
bootstrap();
```

### What changed
- `setupProcessErrorHandlers()` added **before** `bootstrap()` — catches `uncaughtException` and `unhandledRejection` as structured JSON
- `{ bufferLogs: true }` added — buffers logs during startup until the Pino logger is ready
- `app.useLogger(app.get(NestPinoLogger))` — replaces NestJS's default logger with the SDK
- `app.useGlobalFilters(new HttpExceptionFilter())` **removed** — the SDK registers its own global exception filter
- `console.log` **removed** — the SDK logs startup events automatically

### How to verify
1. Start the service: `npm run start:dev`
2. Check that logs are **structured JSON** (not plain text):
   ```json
   {"level":"info","time":"2026-07-02T10:00:00.000Z","service_name":"your-service-name","msg":"request started","method":"GET","url":"/health"}
   ```
3. If `prettyPrint` is enabled (default in dev), logs appear as colorized readable output
4. Kill the process with `kill -9` and verify that `setupProcessErrorHandlers` outputs a `fatal`-level JSON log

### Pitfalls
- `setupProcessErrorHandlers()` must be called **outside** `bootstrap()`, at the top level — otherwise it won't catch errors during module initialization
- Don't forget `{ bufferLogs: true }` — without it, early startup logs bypass the SDK
- Remove `app.useGlobalFilters(new HttpExceptionFilter())` — having two global filters causes double error logging
- If your service runs a Kafka microservice transport alongside HTTP, preserve the `app.connectMicroservice()` calls

---

## Step 3: Configure app.module.ts

### Objective
Add `ObservabilityModule.forRoot()` with service-specific configuration. Remove Morgan middleware and old exception filter providers.

### Files to modify
- `src/app.module.ts`

### Before

```typescript
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { MorganMiddleware } from './middlewares/morgan.middleware';
import { HttpExceptionFilter } from './filters/http.exception.filter';

@Module({
  imports: [/* ... */],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MorganMiddleware).forRoutes('*');
  }
}
```

### After

```typescript
import { Module } from '@nestjs/common';
import {
  ObservabilityModule,
  ObservabilityHealthModule,
  httpInstrumentation,
  sequelizeInstrumentation,   // add if using Sequelize
  kafkaInstrumentation,       // add if using Kafka
  redisInstrumentation,       // add if using Redis
} from '@brdrwanda/observability';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'your-service-name',
      instrumentations: [
        httpInstrumentation({ ignoreIncomingPaths: ['/health', '/metrics'] }),
        sequelizeInstrumentation({ slowQueryThreshold: 1000 }),  // if applicable
        kafkaInstrumentation(),                                   // if applicable
        redisInstrumentation(),                                   // if applicable
      ],
      clientOrigins: {
        'https://tugane.brd.rw': 'tugane-web',      // map frontend origins
        'https://admin.brd.rw': 'admin-web',
      },
    }),
    ObservabilityHealthModule,
    // ... your other modules
  ],
})
export class AppModule {}
```

### What changed
- `ObservabilityModule.forRoot()` added — wires up logging, tracing, metrics, context middleware
- `ObservabilityHealthModule` added — provides `/health` endpoint
- `APP_FILTER` with `HttpExceptionFilter` **removed** — SDK has its own
- `MorganMiddleware` **removed** — SDK's `LoggingInterceptor` replaces it with structured request logging
- `implements NestModule` + `configure()` **removed** — no middleware to register manually
- Instrumentations added for service's specific tech stack

### How to verify
1. Start the service and hit any endpoint:
   ```bash
   curl http://localhost:3000/health
   ```
2. Check that you see structured logs with `service_name`, `trace_id`, `request_id`
3. Check `http://localhost:3000/metrics` returns Prometheus metrics:
   ```
   http_requests_total{method="GET",route="/health",status_code="200"} 1
   ```
4. Check `http://localhost:3000/health` returns:
   ```json
   {"status":"ok","info":{},"error":{},"details":{}}
   ```

### Pitfalls
- Use the exact `serviceName` that matches your deployment name — it appears in every log and metric
- Don't add instrumentations for technologies your service doesn't use — they log debug warnings about missing packages
- If your service previously had `MorganMiddleware` in a `configure()` method and that was the only middleware, you can remove `implements NestModule` entirely

---

## Step 4: Remove old logging infrastructure

### Objective
Delete files that the SDK replaces. These files are now dead code.

### Files to delete

| File | Replaced by |
|------|-------------|
| `src/logger/logger.service.ts` | `ObservabilityLogger` from SDK |
| `src/logger/logger.module.ts` | `ObservabilityModule` (if this file exists) |
| `src/filters/http.exception.filter.ts` | `ObservabilityExceptionFilter` from SDK |
| `src/middlewares/morgan.middleware.ts` | `LoggingInterceptor` from SDK (auto-request logging) |
| `src/utils/logging.util.ts` | AsyncLocalStorage context from SDK (if `createLoggingContextWithId` exists) |

### How to verify
1. Run `npx tsc --noEmit` — no compilation errors referencing deleted files
2. Search for dangling imports:
   ```bash
   grep -rn "logger.service\|logger.module\|http.exception.filter\|morgan.middleware\|logging.util" src/ --include="*.ts"
   ```
3. Result should be empty — if not, fix the remaining imports

### Pitfalls
- Some services import `LoggerService` in the barrel `index.ts` files — check those too
- If `HttpExceptionFilter` was registered with `APP_FILTER` in `app.module.ts`, make sure you removed the provider (Step 3)
- If `LoggerModule` was a dynamic module used in other modules, remove those imports too

---

## Step 5: Replace logger usage in services and controllers

### Objective
Replace all `LoggerService`, `handleInfoLog`, `handlErrorLog`, and `createLoggingContextWithId` patterns with `ObservabilityLogger`.

### Files to modify
- Every service and controller that uses the old logger

### Find all files that need changes

```bash
grep -rn "LoggerService\|handleInfoLog\|handlErrorLog\|handleWarnLog\|createLoggingContextWithId" src/ --include="*.ts"
```

### Before

```typescript
import { LoggerService } from '../logger/logger.service';
import { createLoggingContextWithId } from '../utils/logging.util';

@Injectable()
export class LoanService {
  private loggerService = new LoggerService('LoanService');

  async approveLoan(loanId: string) {
    const loggingContext = createLoggingContextWithId('approveLoan', { loanId });
    this.loggerService.handleInfoLog('Processing loan approval', loggingContext);

    try {
      const result = await this.loanRepository.approve(loanId);
      this.loggerService.handleInfoLog('Loan approved successfully', {
        ...loggingContext,
        status: result.status,
      });
      return result;
    } catch (error) {
      this.loggerService.handlErrorLog('Loan approval failed', {
        ...loggingContext,
        error: error.message,
      });
      throw error;
    }
  }
}
```

### After

```typescript
import { ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class LoanService {
  constructor(private logger: ObservabilityLogger) {}

  async approveLoan(loanId: string) {
    this.logger.info('processing loan approval', { loanId });

    try {
      const result = await this.loanRepository.approve(loanId);
      this.logger.info('loan approved', { loanId, status: result.status });
      return result;
    } catch (error) {
      this.logger.logCaughtError(error);
      throw error;
    }
  }
}
```

### What changed
- `LoggerService` instantiation → constructor-injected `ObservabilityLogger`
- `handleInfoLog('message', context)` → `logger.info('message', metadata)`
- `handlErrorLog('message', context)` → `logger.logCaughtError(error)` or `logger.error('message', metadata)`
- `createLoggingContextWithId()` → **deleted** — the SDK injects `request_id`, `trace_id`, `correlation_id` automatically via AsyncLocalStorage
- No need for manual context objects — every log line automatically includes service_name, trace_id, request_id, span_id

### Method mapping

| Old pattern | New pattern |
|------------|-------------|
| `loggerService.handleInfoLog(msg, ctx)` | `logger.info(msg, metadata)` |
| `loggerService.handlErrorLog(msg, ctx)` | `logger.error(msg, metadata)` |
| `loggerService.handleWarnLog(msg, ctx)` | `logger.warn(msg, metadata)` |
| `createLoggingContextWithId(name, data)` | Not needed — context is automatic |
| `new LoggerService('ClassName')` | `constructor(private logger: ObservabilityLogger) {}` |
| `catch (e) { loggerService.handlErrorLog(...) }` | `catch (e) { logger.logCaughtError(e) }` |

### How to verify
1. Hit an endpoint and check that log lines include `trace_id`, `request_id`, `service_name`:
   ```bash
   curl http://localhost:3000/api/loans
   ```
2. Every log line should be structured JSON with automatic context fields
3. Error responses should include `traceId` and `requestId` in the JSON body:
   ```json
   {"statusCode": 404, "message": "Not found", "timestamp": "...", "requestId": "...", "traceId": "..."}
   ```
4. No remaining references to old patterns:
   ```bash
   grep -rn "handleInfoLog\|handlErrorLog\|createLoggingContextWithId\|LoggerService" src/ --include="*.ts"
   ```

### Pitfalls
- Watch for the typo `handlErrorLog` (missing 'e') — some services use this. Grep for both spellings
- Controllers that use `const loggerService = new LoggerService('name')` at module scope (not DI) need to be converted to constructor injection
- Don't replace `Logger` from `@nestjs/common` — that's NestJS's built-in logger and still works (it routes through `NestPinoLogger` to the SDK)

---

## Step 6: Add database instrumentation

### Objective
Enable automatic tracing and structured logging for database queries.

### Files to modify
- `src/app.module.ts` (add instrumentation to config)
- `src/database/database.module.ts` or wherever Sequelize is configured (add structured query logging)

### Sequelize setup

```typescript
// In your database module
import { createSequelizeLogging, ObservabilityLogger } from '@brdrwanda/observability';

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      inject: [ObservabilityLogger],
      useFactory: (logger: ObservabilityLogger) => ({
        dialect: 'mysql',
        // ... connection config
        logging: createSequelizeLogging(logger, { slowQueryThreshold: 1000 }),
        benchmark: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
```

### How to verify
1. Hit an endpoint that queries the database
2. Check logs for `db.query` events at `debug` level:
   ```json
   {"level":"debug","msg":"query executed","event":"db.query","db.operation":"SELECT","table":"applications","duration_ms":12}
   ```
3. For slow queries (>1000ms threshold), check for `db.slow_query` warnings:
   ```json
   {"level":"warn","msg":"slow query detected","event":"db.slow_query","duration_ms":2340}
   ```
4. If tracing is enabled, check Grafana Tempo for database spans in the trace waterfall

### Pitfalls
- Set `benchmark: true` in Sequelize config — without it, `duration_ms` will always be 0
- If your service uses raw SQL alongside Sequelize, those queries won't be captured by the instrumentation unless you use `sequelize.query()`

---

## Step 7: Add Kafka trace propagation

### Objective
Propagate trace context through Kafka messages so that producer → consumer traces are linked.

### Files to modify
- Producer services (where you call `producer.send()`)
- Consumer controllers/services (where you handle incoming messages)

### Producer: inject trace headers

```typescript
import { injectKafkaHeaders } from '@brdrwanda/observability';

// When producing messages, inject trace context into headers
await this.producer.send({
  topic: 'loan-applications',
  messages: [{
    key: applicationId,
    value: JSON.stringify(payload),
    headers: injectKafkaHeaders(),
  }],
});
```

### Consumer: extract trace context

```typescript
import { withKafkaContext, ObservabilityLogger } from '@brdrwanda/observability';

@Controller()
export class EventController {
  constructor(private logger: ObservabilityLogger) {}

  @EventPattern('loan-applications')
  async handleLoanApplication(@Payload() data: any, @Ctx() context: KafkaContext) {
    const message = context.getMessage();

    await withKafkaContext(message.headers, 'process-loan-application', async () => {
      this.logger.info('processing loan application', { applicationId: data.id });
      // All logs inside this block share the producer's trace_id
      await this.loanService.process(data);
    });
  }
}
```

### How to verify
1. Produce a message and consume it
2. Check that the consumer logs have the **same `trace_id`** as the producer logs
3. In Grafana Tempo, the trace should show both producer and consumer spans as part of one trace

### Pitfalls
- `injectKafkaHeaders()` reads from the **active OTel context** — call it inside a request handler or span, not at module initialization
- If using NestJS `ClientKafka` for log shipping (sending logs to Kafka topics), that pattern can be removed entirely — the SDK logs to stdout and Promtail collects them
- Services using the outbox pattern with direct KafkaJS (`new Kafka()`) need `injectKafkaHeaders()` added to the outbox producer

---

## Step 8: Add external API tracing

### Objective
Create spans for outgoing HTTP calls to external services and propagate trace context so downstream services can link traces.

### Files to modify
- HTTP client wrappers (e.g., `AxiosService`, `HttpService` usage)
- External API call utilities

### Add trace propagation to outgoing requests

```typescript
import { propagation, context as otelContext } from '@opentelemetry/api';
import { Span } from '@brdrwanda/observability';

@Injectable()
export class AxiosService {
  @Span('external-api-call')
  async makeRequest(url: string, data: any) {
    const headers: Record<string, string> = {};
    propagation.inject(otelContext.active(), headers);

    return this.httpService.post(url, data, { headers });
  }
}
```

### Add @Span to external API methods

```typescript
import { Span, ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class ExternalIntegrationService {
  constructor(private logger: ObservabilityLogger, private http: AxiosService) {}

  @Span('esri-lookup')
  async lookupLocation(upi: string) {
    this.logger.info('calling ESRI', { upi });
    const result = await this.http.get(`https://esri.gov.rw/api/parcels/${upi}`);
    this.logger.info('ESRI response received', { upi, status: result.status });
    return result.data;
  }

  @Span('nid-verification')
  async verifyNationalId(nid: string) {
    this.logger.info('calling NID service', { nid: nid.substring(0, 4) + '***' });
    return this.http.get(`https://nida.gov.rw/api/verify/${nid}`);
  }
}
```

### How to verify
1. Make a request that calls an external API
2. In Grafana Tempo, the trace waterfall should show a span named `esri-lookup` or `nid-verification` with duration
3. If the external service also supports W3C traceparent, the trace continues into their system
4. Check logs for the external call with matching `trace_id`

### Pitfalls
- `propagation.inject()` must be called inside an active span context — if called outside a request (e.g., in a cron job), wrap the call in `tracer.startActiveSpan()` first
- Don't log full request/response bodies for external APIs — they may contain PII. Log only what's needed for debugging

---

## Step 9: Replace console.log statements

### Objective
Replace all `console.log`, `console.error`, `console.warn` with structured logger calls.

### Find all console statements

```bash
grep -rn "console\.\(log\|error\|warn\|info\|debug\)" src/ --include="*.ts"
```

### Mapping

| Old | New | When to use |
|-----|-----|-------------|
| `console.log('message', data)` | `logger.info('message', { key: data })` | Normal operations |
| `console.log('Debug:', value)` | `logger.debug('description', { value })` | Dev-only verbose output |
| `console.error('Failed:', err)` | `logger.error('description', { error: err.message })` | Error conditions |
| `console.warn('Warning:', msg)` | `logger.warn('description', { detail: msg })` | Degraded but not broken |

### How to verify
1. `grep -rn "console\." src/ --include="*.ts"` returns no results
2. All output flows through the structured logger
3. In production (JSON mode), no unstructured text appears in stdout

### Pitfalls
- Kafka event handlers often use `console.log` as their primary logging — these need `ObservabilityLogger` injected via constructor
- Some `console.log` statements are inside `catch` blocks with no logger available — inject `ObservabilityLogger` into the class

---

## Step 10: Configure deployment (PM2 / Docker)

### Objective
Ensure the production environment passes `NODE_ENV=production` so the SDK uses production defaults (JSON logs, OTLP export, 10% sampling).

### PM2: ecosystem.config.js

```javascript
module.exports = {
  apps: [{
    name: 'your-service-name',
    script: 'dist/main.js',
    instances: 2,
    env: {
      NODE_ENV: 'production',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318',
    },
  }],
};
```

### Docker: Dockerfile

```dockerfile
ENV NODE_ENV=production
ENV OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
CMD ["node", "dist/main.js"]
```

### Promtail: Collect PM2 logs

If using PM2, point Promtail to PM2's log directory:

```yaml
scrape_configs:
  - job_name: pm2
    static_configs:
      - targets: [localhost]
        labels:
          __path__: ~/.pm2/logs/*-out.log
    pipeline_stages:
      - json:
          expressions:
            level: level
            service_name: service_name
      - labels:
          level:
          service_name:
```

### How to verify
1. Start the service with PM2: `pm2 start ecosystem.config.js`
2. Check logs are JSON (not pretty-printed): `pm2 logs your-service-name --lines 5`
3. Verify `NODE_ENV` is `production` in the log output (check `environment` field)
4. Verify `http://localhost:3000/metrics` is accessible for Prometheus scraping
5. If using Promtail → Loki → Grafana, query `{service_name="your-service-name"}` in Grafana Explore

### Pitfalls
- PM2 does **not** inherit shell environment variables — you must set `NODE_ENV` in `ecosystem.config.js` under `env`
- If the service has a `.env` file that sets `NODE_ENV=development`, it will override PM2's env — remove it or ensure it matches
- PM2 writes stdout to `~/.pm2/logs/<app-name>-out.log` — Promtail needs access to this path

---

## Step 11: Final verification

Run through this checklist to confirm the integration is complete.

### Structured logging

| Check | How to verify | Expected result |
|-------|--------------|-----------------|
| JSON logs in production | `NODE_ENV=production node dist/main.js` | Single-line JSON per log entry |
| Pretty logs in development | `npm run start:dev` | Colorized readable output |
| `service_name` in every log | Hit any endpoint, check log output | `"service_name": "your-service-name"` present |
| `trace_id` in every log | Hit any endpoint, check log output | 32-character hex `trace_id` present |
| `request_id` in every log | Hit any endpoint, check log output | UUID `request_id` present |
| Auto request logging | Hit any endpoint | `request started` and `request completed` log entries appear |
| Error classification | Trigger a 401 error | `"msg": "authentication_failed"` at warn level |
| 5xx error with stack | Trigger a 500 error | `"msg": "server_error"` at error level with `stack` field |

### Distributed tracing

| Check | How to verify | Expected result |
|-------|--------------|-----------------|
| Trace export | Check OTel collector or Tempo | Spans appear for each request |
| Cross-service traces | Call service A → service B | Same `trace_id` in both services' logs |
| Database spans | Query the database via an endpoint | DB spans visible in trace waterfall |
| Custom spans | Call a method with `@Span` decorator | Named span appears in trace |

### Metrics

| Check | How to verify | Expected result |
|-------|--------------|-----------------|
| Metrics endpoint | `curl http://localhost:3000/metrics` | Prometheus text format with `http_requests_total` |
| Request counter | Hit endpoints, then check `/metrics` | `http_requests_total` incremented |
| Duration histogram | Hit endpoints, then check `/metrics` | `http_request_duration_seconds_bucket` populated |
| Node.js metrics | Check `/metrics` | `nodejs_heap_size_used_bytes`, `nodejs_eventloop_lag_seconds` present |

### Health

| Check | How to verify | Expected result |
|-------|--------------|-----------------|
| Health endpoint | `curl http://localhost:3000/health` | `{"status":"ok"}` with 200 |

### Error handling

| Check | How to verify | Expected result |
|-------|--------------|-----------------|
| Error response format | Trigger any error | JSON with `statusCode`, `message`, `timestamp`, `requestId`, `traceId` |
| No old exception filter | Check `app.module.ts` | No `APP_FILTER` provider with `HttpExceptionFilter` |

### Cleanup

| Check | How to verify | Expected result |
|-------|--------------|-----------------|
| No old logger files | `ls src/logger/` | Directory doesn't exist or is empty |
| No old filter files | `ls src/filters/http.exception.filter.ts` | File doesn't exist |
| No Morgan middleware | `grep -rn "morgan" src/` | No results |
| No console.log | `grep -rn "console\." src/ --include="*.ts"` | No results |
| No old logger imports | `grep -rn "LoggerService\|handleInfoLog\|handlErrorLog" src/` | No results |
| Clean build | `npx tsc --noEmit` | No compilation errors |

---

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Two global exception filters | Errors logged twice | Remove `APP_FILTER` provider from `app.module.ts` |
| `NODE_ENV` not set in PM2 | Pretty-printed logs in production | Add `env: { NODE_ENV: 'production' }` to `ecosystem.config.js` |
| Missing `bufferLogs: true` | Early startup logs are unstructured | Add `{ bufferLogs: true }` to `NestFactory.create()` |
| `setupProcessErrorHandlers` inside bootstrap | Doesn't catch module init errors | Move call outside and above `bootstrap()` |
| Old logger still imported | Compilation error after deleting files | Search for and remove all imports of deleted files |
| `handlErrorLog` typo | Grep misses some files | Search for both `handleErrorLog` and `handlErrorLog` |
| Direct LoggerService instantiation | Not using DI, no trace context | Replace `new LoggerService('name')` with constructor-injected `ObservabilityLogger` |
| Kafka log shipping still active | Duplicate logs in Kafka topics | Remove `ClientKafka` logging producers — SDK logs to stdout, Promtail collects |
| Service name mismatch | Metrics/logs show wrong name | Use the same `serviceName` in `ObservabilityModule.forRoot()` and `setupProcessErrorHandlers()` |

---

## See Also

- [Migration Guide](migration.md) — background on why this migration is needed, with before/after comparisons
- [Getting Started](getting-started.md) — quick start for new services (not migrating)
- [Structured Logging](logging.md) — what auto-request logging gives you and what code you can delete
- [Configuration Reference](configuration.md) — all SDK config options
- [Troubleshooting](troubleshooting.md) — common issues after migration
