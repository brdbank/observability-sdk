import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'reflect-metadata';
import { trace, SpanStatusCode, context as otelContext } from '@opentelemetry/api';
import { resolveConfig } from '../../src/core/config';
import { ObservabilityMetrics } from '../../src/metrics/metrics.service';
import { ScheduleTracingService } from '../../src/nestjs/schedule-tracing.service';

const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';
const SCHEDULE_INTERVAL_OPTIONS = 'SCHEDULE_INTERVAL_OPTIONS';
const SCHEDULE_TIMEOUT_OPTIONS = 'SCHEDULE_TIMEOUT_OPTIONS';

class TestService {
  async handleCron() {
    return 'cron-result';
  }

  async handleInterval() {
    return 'interval-result';
  }

  async handleTimeout() {
    return 'timeout-result';
  }

  async handleFailingCron() {
    throw new Error('cron job failed');
  }

  undecorated() {
    return 'not-scheduled';
  }
}

function applyScheduleMetadata(prototype: object) {
  Reflect.defineMetadata(
    SCHEDULE_CRON_OPTIONS,
    { cronTime: '*/30 * * * *', name: 'sendApplications' },
    prototype.handleCron,
  );
  Reflect.defineMetadata(
    SCHEDULE_INTERVAL_OPTIONS,
    { name: 'pollStatus', timeout: 60000 },
    prototype.handleInterval,
  );
  Reflect.defineMetadata(
    SCHEDULE_TIMEOUT_OPTIONS,
    { name: 'initialSync', timeout: 5000 },
    prototype.handleTimeout,
  );
  Reflect.defineMetadata(
    SCHEDULE_CRON_OPTIONS,
    { cronTime: '0 0 * * *', name: 'failingJob' },
    prototype.handleFailingCron,
  );
}

function createMockDiscovery(instances: object[]) {
  return {
    getProviders: () =>
      instances.map((instance) => ({
        instance,
        metatype: instance.constructor,
      })),
  };
}

function createMockScanner() {
  return {
    getAllMethodNames: (prototype: object) =>
      Object.getOwnPropertyNames(prototype).filter(
        (name) => name !== 'constructor' && typeof (prototype as Record<string, unknown>)[name] === 'function',
      ),
  };
}

describe('ScheduleTracingService', () => {
  let service: ScheduleTracingService;
  let testInstance: TestService;
  let mockSpan: {
    setStatus: ReturnType<typeof vi.fn>;
    recordException: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    setAttribute: ReturnType<typeof vi.fn>;
    setAttributes: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    testInstance = new TestService();
    applyScheduleMetadata(TestService.prototype);

    mockSpan = {
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
    };

    vi.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: vi.fn((name, options, fn) => {
        if (typeof options === 'function') {
          return options(mockSpan);
        }
        return fn(mockSpan);
      }),
      startSpan: vi.fn(() => mockSpan),
    } as never);

    const config = resolveConfig({ serviceName: 'test-scheduler' });
    const metrics = new ObservabilityMetrics(config);

    service = new ScheduleTracingService(
      createMockDiscovery([testInstance]) as never,
      createMockScanner() as never,
      config,
      metrics,
    );
  });

  it('should discover and wrap @Cron-decorated methods', () => {
    const original = testInstance.handleCron;
    service.onModuleInit();
    expect(testInstance.handleCron).not.toBe(original);
  });

  it('should discover and wrap @Interval-decorated methods', () => {
    const original = testInstance.handleInterval;
    service.onModuleInit();
    expect(testInstance.handleInterval).not.toBe(original);
  });

  it('should discover and wrap @Timeout-decorated methods', () => {
    const original = testInstance.handleTimeout;
    service.onModuleInit();
    expect(testInstance.handleTimeout).not.toBe(original);
  });

  it('should not wrap undecorated methods', () => {
    const originalUndecorated = testInstance.undecorated;
    service.onModuleInit();
    expect(testInstance.undecorated).toBe(originalUndecorated);
  });

  it('should create span and return result on success', async () => {
    service.onModuleInit();
    const result = await (testInstance as Record<string, () => Promise<string>>).handleCron();
    expect(result).toBe('cron-result');
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('should record error on span when job fails', async () => {
    service.onModuleInit();
    await expect(
      (testInstance as Record<string, () => Promise<string>>).handleFailingCron(),
    ).rejects.toThrow('cron job failed');

    expect(mockSpan.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ code: SpanStatusCode.ERROR }),
    );
    expect(mockSpan.recordException).toHaveBeenCalled();
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('should skip providers with no instance', () => {
    const discovery = {
      getProviders: () => [{ instance: null }, { instance: undefined }],
    };
    const config = resolveConfig({ serviceName: 'test-scheduler' });
    const metrics = new ObservabilityMetrics(config);
    const svc = new ScheduleTracingService(
      discovery as never,
      createMockScanner() as never,
      config,
      metrics,
    );
    expect(() => svc.onModuleInit()).not.toThrow();
  });

  it('should use span name with schedule type and job name', async () => {
    const startActiveSpanSpy = vi.fn((name, options, fn) => fn(mockSpan));
    vi.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: startActiveSpanSpy,
      startSpan: vi.fn(() => mockSpan),
    } as never);

    const config = resolveConfig({ serviceName: 'test-scheduler' });
    const metrics = new ObservabilityMetrics(config);
    service = new ScheduleTracingService(
      createMockDiscovery([testInstance]) as never,
      createMockScanner() as never,
      config,
      metrics,
    );

    service.onModuleInit();
    await (testInstance as Record<string, () => Promise<string>>).handleCron();

    expect(startActiveSpanSpy).toHaveBeenCalledWith(
      'scheduled/cron/sendApplications',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'schedule.type': 'cron',
          'schedule.job_name': 'sendApplications',
          'schedule.cron_expression': '*/30 * * * *',
        }),
      }),
      expect.any(Function),
    );
  });
});

describe('ScheduleTracingService - orchestrator patching', () => {
  let mockSpan: {
    setStatus: ReturnType<typeof vi.fn>;
    recordException: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    setAttribute: ReturnType<typeof vi.fn>;
    setAttributes: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSpan = {
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
    };

    vi.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: vi.fn((name, options, fn) => {
        if (typeof options === 'function') {
          return options(mockSpan);
        }
        return fn(mockSpan);
      }),
      startSpan: vi.fn(() => mockSpan),
    } as never);
  });

  it('should wrap stored cron callbacks on SchedulerOrchestrator', async () => {
    const originalCronFn = vi.fn().mockResolvedValue('cron-done');

    class SchedulerOrchestrator {
      cronJobs: Record<string, { target: Function; options: Record<string, unknown> }> = {
        testCron: {
          target: originalCronFn,
          options: { cronTime: '* * * * *', name: 'testCron' },
        },
      };
      intervals = {};
      timeouts = {};
    }

    const orchestratorInstance = new SchedulerOrchestrator();
    const discovery = {
      getProviders: () => [
        { instance: orchestratorInstance, metatype: SchedulerOrchestrator },
      ],
    };

    const config = resolveConfig({ serviceName: 'test-scheduler' });
    const metrics = new ObservabilityMetrics(config);
    const service = new ScheduleTracingService(
      discovery as never,
      createMockScanner() as never,
      config,
      metrics,
    );

    service.onModuleInit();

    expect(orchestratorInstance.cronJobs['testCron'].target).not.toBe(originalCronFn);
    await orchestratorInstance.cronJobs['testCron'].target();
    expect(originalCronFn).toHaveBeenCalled();
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('should wrap stored interval callbacks on SchedulerOrchestrator', async () => {
    const originalIntervalFn = vi.fn().mockResolvedValue('interval-done');

    class SchedulerOrchestrator {
      cronJobs = {};
      intervals: Record<string, { target: Function; timeout: number }> = {
        testInterval: { target: originalIntervalFn, timeout: 5000 },
      };
      timeouts = {};
    }

    const orchestratorInstance = new SchedulerOrchestrator();
    const discovery = {
      getProviders: () => [
        { instance: orchestratorInstance, metatype: SchedulerOrchestrator },
      ],
    };

    const config = resolveConfig({ serviceName: 'test-scheduler' });
    const metrics = new ObservabilityMetrics(config);
    const service = new ScheduleTracingService(
      discovery as never,
      createMockScanner() as never,
      config,
      metrics,
    );

    service.onModuleInit();

    expect(orchestratorInstance.intervals['testInterval'].target).not.toBe(originalIntervalFn);
    await orchestratorInstance.intervals['testInterval'].target();
    expect(originalIntervalFn).toHaveBeenCalled();
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('should handle missing orchestrator gracefully', () => {
    const discovery = {
      getProviders: () => [
        { instance: { constructor: { name: 'SomeOtherService' } }, metatype: class {} },
      ],
    };

    const config = resolveConfig({ serviceName: 'test-scheduler' });
    const metrics = new ObservabilityMetrics(config);
    const service = new ScheduleTracingService(
      discovery as never,
      createMockScanner() as never,
      config,
      metrics,
    );

    expect(() => service.onModuleInit()).not.toThrow();
  });
});
