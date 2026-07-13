# Structured Logging

Every log line is JSON. The SDK uses [Pino](https://github.com/pinojs/pino) under the hood and enriches each line with service metadata, request context, and trace IDs automatically.

---

## What You Get for Free

Once `ObservabilityModule.forRoot()` is wired up, every HTTP request automatically produces structured logs with zero application code:

| Log event | When it fires | Key fields |
|---|---|---|
| `request started` | Request enters the interceptor | `method`, `url` |
| `request completed` | Response sent successfully | `method`, `url`, `statusCode`, `duration_ms` |
| `request failed` | Unhandled error thrown | `method`, `url`, `error`, `duration_ms` |

Every log line also includes these context fields (injected via Pino's `mixin`):

- `service_name` -- from your config
- `environment` -- `production`, `staging`, etc.
- `version` -- your package version
- `request_id` -- from `X-Request-Id` header (or generated)
- `correlation_id` -- from `X-Correlation-Id` header (or falls back to `request_id`)
- `trace_id`, `span_id` -- from the active OpenTelemetry span
- `client_app` -- resolved from `X-Client-App` header or `Origin`/`Referer`

Unhandled exceptions are caught by the global `ObservabilityExceptionFilter`. It classifies errors by status code:

- **4xx** -- logged at `warn` level with a descriptive event (`bad_request`, `authentication_failed`, `authorization_failed`, `not_found`, `validation_failed`, `rate_limited`, etc.)
- **5xx** -- logged at `error` level as `server_error`, with the full stack trace attached

Health (`/health`) and metrics (`/metrics`) are excluded by default via `excludeRoutes`.

### What You Can Delete

With auto-request logging enabled, you **no longer need** manual request lifecycle logging in your controllers or middleware. Remove this code if you have it:

**Before (manual logging you can delete):**

```typescript
@Controller('loans')
export class LoanController {
  constructor(private logger: ObservabilityLogger) {}

  @Post()
  async createLoan(@Body() dto: CreateLoanDto) {
    this.logger.info('request started', { method: 'POST', url: '/loans' });  // DELETE THIS
    const start = Date.now();                                                  // DELETE THIS

    try {
      const result = await this.loanService.create(dto);

      this.logger.info('request completed', {                                // DELETE THIS
        method: 'POST', url: '/loans',                                        // DELETE THIS
        statusCode: 201, duration_ms: Date.now() - start,                     // DELETE THIS
      });                                                                      // DELETE THIS

      return result;
    } catch (error) {
      this.logger.error('request failed', {                                   // DELETE THIS
        method: 'POST', url: '/loans',                                        // DELETE THIS
        error: error.message, duration_ms: Date.now() - start,                // DELETE THIS
      });                                                                      // DELETE THIS
      throw error;
    }
  }
}
```

**After (the SDK handles it all):**

```typescript
@Controller('loans')
export class LoanController {
  constructor(private logger: ObservabilityLogger) {}

  @Post()
  async createLoan(@Body() dto: CreateLoanDto) {
    // Auto-logged: request_start with method, route, controller, handler
    const result = await this.loanService.create(dto);
    // Auto-logged: request_complete with statusCode, duration_ms
    // Auto-logged on error: request_error with error message, duration_ms

    // Only log BUSINESS events — things the SDK can't know about:
    this.logger.info('loan created', { loanId: result.id, amount: dto.amount });

    return result;
  }
}
```

The interceptor automatically captures: method, route, controller name (`LoanController`), handler name (`createLoan`), statusCode, and duration_ms. You only need to log domain-specific events.

---

## Auto-Request Logging Configuration

The logging interceptor and exception filter are registered as global providers automatically. You can configure logger behavior through the `logger` key:

```typescript
import { ObservabilityModule } from '@brdrwanda/observability';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'my-service',
      logger: {
        level: 'info',                // default: 'debug' in dev, 'info' in production
        prettyPrint: true,            // default: true in dev, false in production
        autoRequestLogging: true,     // default: true — log request_start/request_complete automatically
        autoErrorLogging: true,       // default: true — log errors from exception filter automatically
        logRequestBody: false,        // default: false — include req.body in request_start log
        logResponseBody: false,       // default: false — include response body in request_complete log
        excludeRoutes: ['/health', '/metrics'],  // default: ['/health', '/metrics'] — skip these routes
        redaction: {
          paths: ['*.password', '*.token'],  // default: see Sensitive Data Redaction section
          censor: '[REDACTED]',              // default: '[REDACTED]'
        },
      },
    }),
  ],
})
export class AppModule {}
```

### Auto-Request Logging Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoRequestLogging` | `boolean` | `true` | Log `request_start` and `request_complete` for every HTTP request |
| `autoErrorLogging` | `boolean` | `true` | Log errors caught by the global exception filter |
| `logRequestBody` | `boolean` | `false` | Include `req.body` in the `request_start` log entry |
| `logResponseBody` | `boolean` | `false` | Include the response body in the `request_complete` log entry |
| `excludeRoutes` | `string[]` | `['/health', '/metrics']` | Routes to skip entirely (no request_start/request_complete) |

Set `autoRequestLogging: false` to disable automatic request lifecycle logs while keeping your manual `logger.info()` calls. Set `autoErrorLogging: false` to disable exception filter logging while keeping the JSON error response and span recording.

### Example log output

**`request started`** (info):

```json
{
  "level": "info",
  "time": "2025-06-15T10:32:01.456Z",
  "name": "my-service",
  "msg": "request started",
  "service_name": "my-service",
  "environment": "production",
  "version": "1.2.0",
  "request_id": "req-abc-123",
  "correlation_id": "corr-xyz-789",
  "trace_id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "span_id": "1a2b3c4d5e6f7a8b",
  "method": "POST",
  "url": "/api/loans"
}
```

**`request completed`** (info):

```json
{
  "level": "info",
  "time": "2025-06-15T10:32:01.612Z",
  "msg": "request completed",
  "service_name": "my-service",
  "trace_id": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "method": "POST",
  "url": "/api/loans",
  "statusCode": 201,
  "duration_ms": 156.23
}
```

**`request_error`** -- 4xx (warn):

```json
{
  "level": "warn",
  "time": "2025-06-15T10:32:05.891Z",
  "msg": "authentication_failed",
  "service_name": "my-service",
  "trace_id": "f1e2d3c4b5a6f1e2d3c4b5a6f1e2d3c4",
  "event": "authentication_failed",
  "statusCode": 401,
  "message": "Invalid credentials",
  "method": "POST",
  "url": "/api/auth/login"
}
```

**`request_error`** -- 5xx (error):

```json
{
  "level": "error",
  "time": "2025-06-15T10:32:10.334Z",
  "msg": "server_error",
  "service_name": "my-service",
  "trace_id": "d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1",
  "event": "server_error",
  "statusCode": 500,
  "message": "Connection refused",
  "method": "GET",
  "url": "/api/accounts/ACC-001",
  "stack": "Error: Connection refused\n    at TCPConnectWrap..."
}
```

---

## Business Event Logging

Inject `ObservabilityLogger` into any service or controller to add domain-specific logs. The logger is registered globally, so it's available everywhere without extra imports.

```typescript
import { Injectable } from '@nestjs/common';
import { ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class LoanService {
  constructor(private logger: ObservabilityLogger) {}

  async approveLoan(loanId: string, amount: number, nationalId: string) {
    // ... business logic ...

    this.logger.info('loan approved', {
      loanId: 'LN-001',
      amount: 5000000,
      applicant: nationalId,
    });
  }

  async checkCreditScore(applicantId: string) {
    const score = await this.creditBureau.getScore(applicantId);

    if (score < 500) {
      this.logger.warn('credit score below threshold', {
        score: 320,
        threshold: 500,
      });
    }
  }

  async fetchPropertyData(propertyId: string) {
    try {
      return await this.esriClient.lookup(propertyId);
    } catch (err) {
      this.logger.error('external API timeout', {
        service: 'ESRI',
        timeout_ms: 15000,
      });
      throw err;
    }
  }
}
```

Every call to `info`, `warn`, `error`, etc. automatically includes all the context fields (service name, trace ID, request ID) -- you only pass the business-relevant metadata.

---

## Child Loggers

Use `child()` to create a logger with persistent bindings. Every log from the child includes the bound fields without you passing them each time.

```typescript
@Injectable()
export class OrderService {
  constructor(private logger: ObservabilityLogger) {}

  async processOrder(orderId: string) {
    const log = this.logger.child({ orderId });

    log.info('order processing started');
    // => { ..., "orderId": "ORD-456", "msg": "order processing started" }

    await this.validateInventory(orderId);
    log.info('inventory validated');
    // => { ..., "orderId": "ORD-456", "msg": "inventory validated" }

    await this.chargePayment(orderId);
    log.info('payment charged');
    // => { ..., "orderId": "ORD-456", "msg": "payment charged" }
  }
}
```

Child loggers are useful when a single request touches multiple steps and you want the same entity ID on every log line without repeating it.

---

## Error Logging

Use `logCaughtError()` for exceptions you catch yourself (e.g., in a try/catch). It extracts the status code and message, then routes to the correct log level:

- **4xx** -- logged at `warn` as `request_error`
- **5xx** (or unknown) -- logged at `error` as `request_error`, with the full stack trace

```typescript
import { ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class PaymentService {
  constructor(private logger: ObservabilityLogger) {}

  async charge(accountId: string, amount: number) {
    try {
      await this.gateway.charge(accountId, amount);
    } catch (error) {
      this.logger.logCaughtError(error);
      // 4xx => warn-level log with statusCode and message
      // 5xx => error-level log with statusCode, message, and stack trace
      throw error;
    }
  }
}
```

`logCaughtError` works with NestJS `HttpException` instances (calls `getStatus()`), plain errors with a `statusCode` property, and unknown errors (defaults to 500).

---

## Log Levels

| Level | When to use | Example |
|---|---|---|
| `debug` | Verbose detail, development only. Never enable in production. | `this.logger.debug('SQL query executed', { query, rows: 42 })` |
| `info` | Normal operations. Business events, request lifecycle. | `this.logger.info('loan approved', { loanId })` |
| `warn` | Degraded but not broken. 4xx errors, approaching limits. | `this.logger.warn('rate limit approaching', { current: 95, max: 100 })` |
| `error` | Something failed. 5xx errors, broken integrations. | `this.logger.error('database connection lost', { host })` |
| `fatal` | Process is about to die. Use sparingly. | `this.logger.fatal('out of memory, shutting down')` |

Set the level in config:

```typescript
ObservabilityModule.forRoot({
  serviceName: 'my-service',
  logger: { level: 'info' },  // suppresses debug logs
})
```

Default: `debug` in development, `info` in production (based on `NODE_ENV`).

---

## Querying Logs in Grafana / Loki

All logs ship as JSON, which means Loki can parse fields with `| json`. Here are the queries you'll use most:

**All logs from one service:**

```logql
{service_name="api-gateway"}
```

**Only errors:**

```logql
{service_name="api-gateway", level="error"}
```

**Filter by controller (parsed from JSON):**

```logql
{service_name="api-gateway"} | json | controller="LoanController"
```

**Slow requests (> 1 second):**

```logql
{service_name="api-gateway"} |= "request completed" | json | duration_ms > 1000
```

**Trace a single request across all services:**

```logql
{service_name=~".+"} | json | trace_id="a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
```

**Errors for a specific endpoint:**

```logql
{service_name="loan-service"} | json | level="error" | url="/api/loans"
```

**Validation failures:**

```logql
{service_name="api-gateway"} | json | event="validation_failed"
```

Tip: click any trace ID in Grafana to jump from logs to the full distributed trace in Tempo.

---

## Sensitive Data Redaction

Pino's built-in redaction removes sensitive fields before they reach the log output. The SDK ships with safe defaults.

### Default redacted paths

| Path pattern | What it covers |
|---|---|
| `req.headers.authorization` | Bearer tokens, Basic auth |
| `req.headers.cookie` | Session cookies |
| `req.headers["set-cookie"]` | Response cookies |
| `*.password` | Password fields at any depth |
| `*.secret` | Secret fields at any depth |
| `*.token`, `*.accessToken`, `*.refreshToken` | Auth tokens |
| `*.access_token`, `*.refresh_token` | Snake-case auth tokens |
| `*.apiKey`, `*.api_key` | API keys |
| `*.connectionString`, `*.connection_string` | Database connection strings |
| `*.creditCard`, `*.credit_card` | Card numbers |
| `*.ssn` | National ID / Social Security numbers |

### Adding custom redaction paths

Add your own paths alongside the defaults:

```typescript
ObservabilityModule.forRoot({
  serviceName: 'my-service',
  logger: {
    redaction: {
      paths: [
        // Add your custom paths
        'body.creditCard',
        'body.ssn',
        'headers.x-api-key',
        // You can also use wildcards
        '*.nationalId',
        '*.phoneNumber',
      ],
      censor: '[REDACTED]',
    },
  },
})
```

> **Note:** When you provide custom `paths`, they **replace** the defaults. If you want to keep the defaults and add more, spread them in:
>
> ```typescript
> import { DEFAULT_REDACTION_PATHS } from '@brdrwanda/observability';
>
> redaction: {
>   paths: [...DEFAULT_REDACTION_PATHS, 'body.nationalId', '*.phoneNumber'],
> }
> ```

### What redacted output looks like

```json
{
  "level": "info",
  "msg": "user registered",
  "password": "[REDACTED]",
  "token": "[REDACTED]",
  "email": "user@example.com",
  "name": "Jean Claude"
}
```

The `censor` value defaults to `[REDACTED]`. You can change it to any string (e.g., `***`, `[FILTERED]`).
