# Testing with the SDK

How to mock SDK providers in unit tests, suppress log noise, and verify observability behavior in integration tests.

---

## Mocking ObservabilityLogger

In unit tests, mock the logger instead of importing the full module:

```typescript
import { Test } from '@nestjs/testing';
import { ObservabilityLogger } from '@brdrwanda/observability';
import { LoanService } from './loan.service';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  fatal: jest.fn(),
  logCaughtError: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

describe('LoanService', () => {
  let service: LoanService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        LoanService,
        { provide: ObservabilityLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get(LoanService);
    jest.clearAllMocks();
  });

  it('should log loan approval', async () => {
    await service.approveLoan('LN-001');

    expect(mockLogger.info).toHaveBeenCalledWith(
      'loan approved',
      expect.objectContaining({ loanId: 'LN-001' }),
    );
  });

  it('should log caught errors at appropriate level', async () => {
    await service.processWithFallback();

    expect(mockLogger.logCaughtError).toHaveBeenCalled();
  });
});
```

---

## Mocking ObservabilityMetrics

```typescript
import { ObservabilityMetrics } from '@brdrwanda/observability';

const mockCounter = { inc: jest.fn() };
const mockHistogram = { observe: jest.fn(), startTimer: jest.fn(() => jest.fn()) };
const mockGauge = { set: jest.fn(), inc: jest.fn(), dec: jest.fn() };

const mockMetrics = {
  createCounter: jest.fn().mockReturnValue(mockCounter),
  createHistogram: jest.fn().mockReturnValue(mockHistogram),
  createGauge: jest.fn().mockReturnValue(mockGauge),
};

// In your test module
{ provide: ObservabilityMetrics, useValue: mockMetrics }
```

---

## Mocking ObservabilityTracer

```typescript
import { ObservabilityTracer } from '@brdrwanda/observability';

const mockTracer = {
  startActiveSpan: jest.fn((name, fn) => fn({ end: jest.fn(), setAttribute: jest.fn() })),
  getActiveSpan: jest.fn(),
};

// In your test module
{ provide: ObservabilityTracer, useValue: mockTracer }
```

---

## Disabling Tracing and Metrics in Tests

For integration or e2e tests where you import the real module but don't want OTel overhead:

```typescript
const module = await Test.createTestingModule({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'test-service',
      tracing: { enabled: false },
      metrics: { enabled: false },
      logger: { level: 'warn', prettyPrint: false },
    }),
  ],
}).compile();
```

Setting `logger.level` to `'warn'` suppresses info/debug output. Set to `'fatal'` to silence everything.

---

## E2E Testing Error Handling

Verify the exception filter returns the expected JSON structure:

```typescript
import * as request from 'supertest';

describe('Error Handling (e2e)', () => {
  it('returns structured 404 response', async () => {
    const response = await request(app.getHttpServer())
      .get('/nonexistent')
      .expect(404);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 404,
        message: expect.any(String),
        timestamp: expect.any(String),
      }),
    );
  });

  it('returns structured validation error', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/loans')
      .send({})
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: expect.any(String),
      }),
    );
  });
});
```

---

## Verifying Trace Context in Tests

Check that trace_id appears in response or logs:

```typescript
it('includes traceId in error responses', async () => {
  const response = await request(app.getHttpServer())
    .get('/nonexistent')
    .expect(404);

  // traceId is included in error responses by the exception filter
  expect(response.body.traceId).toBeDefined();
});
```

---

## Tips

- **Unit tests**: Mock SDK providers, don't import the full module
- **Integration tests**: Use `tracing: { enabled: false }` and `metrics: { enabled: false }` to skip OTel setup
- **Suppress log noise**: Set `logger: { level: 'fatal' }` in test config
- **CI pipelines**: Set `NODE_ENV=test` — the SDK uses dev defaults (debug level, console exporter)
- **Don't mock what you're testing**: If you're testing that your service logs correctly, use the real logger with a captured transport, not a mock

---

## See Also

- [Structured Logging](logging.md) — logger API reference
- [Error Handling](error-handling.md) — exception filter behavior
- [Configuration Reference](configuration.md) — all config options
