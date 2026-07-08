# Error Handling

The `@brdrwanda/observability` SDK provides automatic error classification, structured error logging, span error recording, and process-level crash handlers -- all out of the box. This guide covers every error-handling feature and how to configure them.

---

## Table of Contents

1. [Automatic Error Classification](#automatic-error-classification)
2. [What's Included in Error Logs](#whats-included-in-error-logs)
3. [Error Response Format](#error-response-format)
4. [logCaughtError() for Try/Catch](#logcaughterror-for-trycatch)
5. [Disabling Auto Error Logging](#disabling-auto-error-logging)
6. [Span Error Recording](#span-error-recording)
7. [Process Error Handlers](#process-error-handlers)

---

## Automatic Error Classification

The SDK registers a global `ObservabilityExceptionFilter` (via `APP_FILTER`) that catches **all** unhandled exceptions thrown from your controllers, guards, pipes, and interceptors. Each exception is classified by HTTP status code into a named event, and logged at the appropriate level.

### Classification Table

| Status | Event                  | Log Level |
| ------ | ---------------------- | --------- |
| 400    | `bad_request`          | `warn`    |
| 400 + validation errors | `validation_failed` | `warn` |
| 401    | `authentication_failed`| `warn`    |
| 403    | `authorization_failed` | `warn`    |
| 404    | `not_found`            | `warn`    |
| 409    | `conflict`             | `warn`    |
| 422    | `validation_failed`    | `warn`    |
| 429    | `rate_limited`         | `warn`    |
| 500+   | `server_error`         | `error`   |

Any other 4xx status not listed above is classified as `client_error` at `warn` level.

### Example Log Output

**400 -- Bad Request**

```json
{
  "level": "warn",
  "time": "2026-07-02T10:00:00.000Z",
  "service_name": "payment-service",
  "request_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "msg": "bad_request",
  "event": "bad_request",
  "statusCode": 400,
  "message": "Missing required field: amount",
  "method": "POST",
  "url": "/api/payments"
}
```

**400 + Validation Errors (class-validator)**

```json
{
  "level": "warn",
  "time": "2026-07-02T10:00:00.000Z",
  "service_name": "payment-service",
  "request_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "msg": "validation_failed",
  "event": "validation_failed",
  "statusCode": 400,
  "message": "amount must be a positive number, currency must be a valid ISO 4217 code",
  "method": "POST",
  "url": "/api/payments",
  "validationErrors": [
    "amount must be a positive number",
    "currency must be a valid ISO 4217 code"
  ]
}
```

**401 -- Authentication Failed**

```json
{
  "level": "warn",
  "time": "2026-07-02T10:00:00.000Z",
  "service_name": "payment-service",
  "request_id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  "trace_id": "5cf93f4688c45eb7b4df030e1f1f5847",
  "msg": "authentication_failed",
  "event": "authentication_failed",
  "statusCode": 401,
  "message": "Invalid token",
  "method": "GET",
  "url": "/api/payments/txn-123"
}
```

**403 -- Authorization Failed**

```json
{
  "level": "warn",
  "time": "2026-07-02T10:00:00.000Z",
  "service_name": "payment-service",
  "request_id": "c3d4e5f6-a7b8-9012-cdef-123456789012",
  "trace_id": "6dg04g5799d56fc8c5eg141f2g2g6958",
  "msg": "authorization_failed",
  "event": "authorization_failed",
  "statusCode": 403,
  "message": "Insufficient permissions to access this resource",
  "method": "DELETE",
  "url": "/api/payments/txn-456"
}
```

**404 -- Not Found**

```json
{
  "level": "warn",
  "time": "2026-07-02T10:00:00.000Z",
  "service_name": "payment-service",
  "request_id": "d4e5f6a7-b8c9-0123-defa-234567890123",
  "trace_id": "7eh15h6800e67gd9d6fh252g3h3h7069",
  "msg": "not_found",
  "event": "not_found",
  "statusCode": 404,
  "message": "Payment txn-999 not found",
  "method": "GET",
  "url": "/api/payments/txn-999"
}
```

**409 -- Conflict**

```json
{
  "level": "warn",
  "time": "2026-07-02T10:00:00.000Z",
  "service_name": "payment-service",
  "request_id": "e5f6a7b8-c9d0-1234-efab-345678901234",
  "trace_id": "8fi26i7911f78he0e7gi363h4i4i8170",
  "msg": "conflict",
  "event": "conflict",
  "statusCode": 409,
  "message": "Payment txn-123 has already been processed",
  "method": "POST",
  "url": "/api/payments/txn-123/capture"
}
```

**422 -- Validation Failed**

```json
{
  "level": "warn",
  "time": "2026-07-02T10:00:00.000Z",
  "service_name": "payment-service",
  "request_id": "f6a7b8c9-d0e1-2345-fabc-456789012345",
  "trace_id": "9gj37j8022g89if1f8hj474i5j5j9281",
  "msg": "validation_failed",
  "event": "validation_failed",
  "statusCode": 422,
  "message": "Cannot refund more than the original amount",
  "method": "POST",
  "url": "/api/payments/txn-123/refund"
}
```

**429 -- Rate Limited**

```json
{
  "level": "warn",
  "time": "2026-07-02T10:00:00.000Z",
  "service_name": "payment-service",
  "request_id": "a7b8c9d0-e1f2-3456-abcd-567890123456",
  "trace_id": "0hk48k9133h90jg2g9ik585j6k6k0392",
  "msg": "rate_limited",
  "event": "rate_limited",
  "statusCode": 429,
  "message": "Too many requests, please try again later",
  "method": "POST",
  "url": "/api/payments"
}
```

**500+ -- Server Error**

```json
{
  "level": "error",
  "time": "2026-07-02T10:00:00.000Z",
  "service_name": "payment-service",
  "request_id": "b8c9d0e1-f2a3-4567-bcde-678901234567",
  "trace_id": "1il59l0244i01kh3h0jl696k7l7l1403",
  "msg": "server_error",
  "event": "server_error",
  "statusCode": 500,
  "message": "Connection to database timed out",
  "method": "POST",
  "url": "/api/payments",
  "stack": "Error: Connection to database timed out\n    at PaymentService.create (/app/src/payment.service.ts:42:11)\n    at PaymentController.create (/app/src/payment.controller.ts:18:30)\n    ..."
}
```

> **Note:** The `stack` field is only included for 5xx errors. Client errors (4xx) never expose stack traces.

---

## What's Included in Error Logs

Every error log entry is automatically enriched with these fields:

| Field              | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `event`            | Classified event name (`bad_request`, `server_error`, etc.) from the table above |
| `statusCode`       | HTTP status code (e.g. `400`, `401`, `500`)                                 |
| `message`          | Human-readable error message extracted from the exception                   |
| `method`           | HTTP method of the request (`GET`, `POST`, `PUT`, `DELETE`, etc.)           |
| `url`              | Request URL path that triggered the error                                   |
| `validationErrors` | Array of validation error strings (only present for class-validator errors with array messages) |
| `stack`            | Full stack trace (only present for 5xx server errors)                       |
| `trace_id`         | OpenTelemetry trace ID for correlating with distributed traces in Tempo     |
| `span_id`          | OpenTelemetry span ID for the active span                                   |
| `request_id`       | Unique request identifier for correlating all logs within a single request lifecycle |
| `correlation_id`   | Propagated correlation ID for tracking requests across services             |
| `service_name`     | Name of the service that produced the log                                   |
| `environment`      | Current environment (`development`, `staging`, `production`)                |
| `version`          | Service version                                                             |

The `trace_id` and `request_id` fields are critical for debugging. Use `trace_id` to jump from a log line in Grafana/Loki directly to the corresponding trace in Tempo. Use `request_id` to find every log line produced during a single HTTP request.

---

## Error Response Format

When the exception filter catches an error, it sends a structured JSON response to the client:

```json
{
  "statusCode": 401,
  "message": "Invalid token",
  "timestamp": "2026-07-02T10:00:00.000Z",
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

| Field       | Description                                                        |
| ----------- | ------------------------------------------------------------------ |
| `statusCode`| The HTTP status code                                               |
| `message`   | The error message (from the exception, never a raw stack trace)    |
| `timestamp` | ISO 8601 timestamp of when the error occurred                      |
| `requestId` | The request's unique ID (from the context middleware)              |
| `traceId`   | The OpenTelemetry trace ID (if tracing is enabled)                 |

The `requestId` and `traceId` are included so that when a client reports an error, your team can immediately look up the full request lifecycle in Loki and Tempo without asking "what time did this happen?" or guessing.

**Example: 500 response**

```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "timestamp": "2026-07-02T10:05:23.456Z",
  "requestId": "c9d0e1f2-a3b4-5678-cdef-789012345678",
  "traceId": "2jm60m1355j12li4i1km707l8m8m2514"
}
```

> **Security note:** The response never includes stack traces or internal details. The `message` for unrecognized exceptions defaults to `"Internal server error"`. Detailed error information is only available in your internal logs.

---

## logCaughtError() for Try/Catch

Not every error should be unhandled. When you catch errors in business logic (e.g., calling an external API, processing a queue message), use `logCaughtError()` to get the same structured, classified logging:

```typescript
import { Injectable } from '@nestjs/common';
import { ObservabilityLogger } from '@brdrwanda/observability';

@Injectable()
export class PaymentService {
  constructor(private readonly logger: ObservabilityLogger) {}

  async processPayment(paymentId: string) {
    try {
      await this.externalPaymentGateway.charge(paymentId);
    } catch (error) {
      this.logger.logCaughtError(error);
      // Return a fallback, queue for retry, or rethrow
      throw error;
    }
  }
}
```

### How It Works

`logCaughtError()` extracts the status code and message from the error, then routes it to the correct log level:

1. **Status extraction** -- checks `error.getStatus()` (NestJS `HttpException`), then `error.statusCode`, then defaults to `500`.
2. **Message extraction** -- checks `error.response.message` (NestJS response shape), then `error.message`, then falls back to `"Unknown error"`.
3. **Log routing:**
   - **4xx** errors are logged at `warn` level (no stack trace).
   - **5xx** errors are logged at `error` level with the full `stack` trace.

**Example output for a caught 502 error:**

```json
{
  "level": "error",
  "time": "2026-07-02T10:03:00.000Z",
  "service_name": "payment-service",
  "request_id": "d0e1f2a3-b4c5-6789-defa-890123456789",
  "trace_id": "3kn71n2466k23mj5j2ln818m9n9n3625",
  "msg": "request_error",
  "statusCode": 502,
  "message": "Payment gateway connection refused",
  "stack": "Error: Payment gateway connection refused\n    at PaymentGateway.charge (/app/src/gateway.ts:55:11)\n    ..."
}
```

**Example output for a caught 404 error:**

```json
{
  "level": "warn",
  "time": "2026-07-02T10:03:00.000Z",
  "service_name": "payment-service",
  "request_id": "e1f2a3b4-c5d6-7890-efab-901234567890",
  "trace_id": "4lo82o3577l34nk6k3mo929n0o0o4736",
  "msg": "request_error",
  "statusCode": 404,
  "message": "Upstream resource not found"
}
```

---

## Disabling Auto Error Logging

By default, the exception filter both logs the error and returns the JSON response. If your team has custom error logging middleware and you want to prevent duplicate logs, disable automatic error logging:

```typescript
ObservabilityModule.forRoot({
  serviceName: 'payment-service',
  logger: {
    autoErrorLogging: false,
  },
});
```

When `autoErrorLogging` is `false`:

- The exception filter **still catches** all unhandled exceptions
- The exception filter **still returns** the structured JSON response (with `statusCode`, `message`, `timestamp`, `requestId`, `traceId`)
- The exception filter **still records** the error on the active OpenTelemetry span (see [Span Error Recording](#span-error-recording))
- The exception filter **does not** call `logger.warn()` or `logger.error()`

> **Tip:** Even with auto error logging disabled, `logCaughtError()` in your own try/catch blocks still works — it's independent of the exception filter.

---

## Span Error Recording

Every error caught by the exception filter is also recorded on the active OpenTelemetry span. This means errors appear in **both** your logs (Loki) and your traces (Tempo), giving you two independent ways to find and investigate issues.

The filter performs three operations on the active span:

```typescript
// 1. Mark the span status as ERROR
span.setStatus({ code: SpanStatusCode.ERROR, message: 'Invalid token' });

// 2. Tag the span with the classified event
span.setAttribute('error.event', 'authentication_failed');

// 3. Record the exception with stack trace (if error is an Error instance)
span.recordException(exception);
```

Additionally, the HTTP status code is set on the span:

```typescript
span.setAttribute('http.status_code', 401);
```

### What This Means in Practice

| Destination | What You See                                                    |
| ----------- | --------------------------------------------------------------- |
| **Loki**    | Structured JSON log with `event`, `statusCode`, `message`, `trace_id` |
| **Tempo**   | Span marked as error with `error.event` attribute, exception recorded with stack trace |
| **Grafana** | Click the `trace_id` in a Loki log line to jump directly to the trace in Tempo |

This dual recording is automatic. You do not need to manually record errors on spans in your application code -- the exception filter handles it.

---

## Process Error Handlers

Node.js can crash from `uncaughtException` or `unhandledRejection` events (e.g., a forgotten `await`, a thrown error in a callback). By default, Node.js prints these to stderr and may or may not exit, often leaving the process in a broken state.

`setupProcessErrorHandlers()` catches these events, logs them as structured `fatal`-level JSON, and exits the process so your process manager (PM2, Docker, Kubernetes) can restart it cleanly.

### Setup

Call this in your `main.ts` **before** starting the NestJS application:

```typescript
import { setupProcessErrorHandlers } from '@brdrwanda/observability';

setupProcessErrorHandlers({
  serviceName: 'my-service',
  exitOnUncaught: true,           // default: true
  exitOnUnhandledRejection: true, // default: true
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

bootstrap();
```

### Options

| Option                    | Type      | Default                         | Description                                     |
| ------------------------- | --------- | ------------------------------- | ----------------------------------------------- |
| `serviceName`             | `string`  | `process.env.npm_package_name`  | Service name included in the fatal log entry    |
| `exitOnUncaught`          | `boolean` | `true`                          | Exit the process after an uncaught exception    |
| `exitOnUnhandledRejection`| `boolean` | `true`                          | Exit the process after an unhandled rejection   |

### Output Format

Fatal errors are written to `stderr` as single-line JSON:

**Uncaught exception:**

```json
{
  "level": "fatal",
  "time": 1751450400000,
  "service_name": "my-service",
  "msg": "uncaught_exception: Cannot read properties of undefined (reading 'id')",
  "error": {
    "name": "TypeError",
    "message": "Cannot read properties of undefined (reading 'id')",
    "stack": "TypeError: Cannot read properties of undefined (reading 'id')\n    at processJob (/app/src/worker.ts:23:18)\n    ..."
  }
}
```

**Unhandled rejection:**

```json
{
  "level": "fatal",
  "time": 1751450400000,
  "service_name": "my-service",
  "msg": "unhandled_rejection: Connection refused: redis://localhost:6379",
  "error": {
    "name": "Error",
    "message": "Connection refused: redis://localhost:6379",
    "stack": "Error: Connection refused: redis://localhost:6379\n    at RedisClient.connect (/app/node_modules/redis/lib/client.ts:88:11)\n    ..."
  }
}
```

### Why Exit?

After an uncaught exception, the Node.js process may be in an inconsistent state (open database connections, partial writes, corrupted in-memory state). The safest path is to exit immediately and let PM2 or your container orchestrator restart the process. This is why `exitOnUncaught` and `exitOnUnhandledRejection` both default to `true`.

If you need to keep the process alive (e.g., during development), set the options to `false`:

```typescript
setupProcessErrorHandlers({
  serviceName: 'my-service',
  exitOnUncaught: false,
  exitOnUnhandledRejection: false,
});
```

> **Warning:** Running with `exitOnUncaught: false` in production is not recommended. A process that survives an uncaught exception may silently corrupt data or stop processing requests.
