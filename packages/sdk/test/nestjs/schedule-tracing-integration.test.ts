import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import 'reflect-metadata';
import { Module, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { ObservabilityModule } from '../../src/nestjs/observability.module';

const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';
const SCHEDULER_TYPE = 'SCHEDULER_TYPE';
const SCHEDULER_NAME = 'SCHEDULER_NAME';

function Cron(cronTime: string, options: { name?: string } = {}) {
  return (target: object, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(SCHEDULE_CRON_OPTIONS, { ...options, cronTime }, descriptor.value);
    Reflect.defineMetadata(SCHEDULER_NAME, options.name, descriptor.value);
    Reflect.defineMetadata(SCHEDULER_TYPE, 'CRON', descriptor.value);
    return descriptor;
  };
}

@Injectable()
class JobService {
  callLog: string[] = [];

  @Cron('*/30 * * * *', { name: 'sendApplications' })
  async sendApplicationsToMinecofin() {
    this.callLog.push('minecofin');
    return { sent: 5 };
  }

  @Cron('0 0 * * *', { name: 'dailyReconciliation' })
  async checkMissedApplications() {
    this.callLog.push('reconciliation');
    return { checked: 10 };
  }

  @Cron('*/15 * * * *', { name: 'failingJob' })
  async failingJob() {
    throw new Error('External API timeout');
  }

  async regularMethod() {
    this.callLog.push('regular');
    return 'not-scheduled';
  }
}

@Module({
  providers: [JobService],
  exports: [JobService],
})
class JobModule {}

describe('Schedule Tracing Integration', () => {
  let jobService: JobService;
  let moduleRef: Awaited<ReturnType<typeof Test.createTestingModule extends (...a: unknown[]) => infer R ? R extends { compile: () => infer C } ? never : never : never>>;

  const spans: Array<{
    name: string;
    status: { code: number; message?: string };
    attributes: Record<string, unknown>;
    exceptions: Error[];
    ended: boolean;
  }> = [];

  beforeAll(async () => {
    vi.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: vi.fn((name: string, options: unknown, fn?: Function) => {
        const span = {
          name,
          status: { code: 0 },
          attributes: (typeof options === 'object' && options && 'attributes' in options)
            ? { ...(options as { attributes: Record<string, unknown> }).attributes }
            : {},
          exceptions: [] as Error[],
          ended: false,
          setStatus(s: { code: number; message?: string }) { this.status = s; },
          recordException(e: Error) { this.exceptions.push(e); },
          end() { this.ended = true; },
          setAttribute(k: string, v: unknown) { this.attributes[k] = v; },
          setAttributes(attrs: Record<string, unknown>) { Object.assign(this.attributes, attrs); },
        };
        spans.push(span);
        const callback = typeof options === 'function' ? options : fn;
        return callback!(span);
      }),
      startSpan: vi.fn(),
    } as never);

    const mod = await Test.createTestingModule({
      imports: [
        ObservabilityModule.forRoot({
          serviceName: 'test-scheduler',
          tracing: { enabled: true, exporter: { type: 'none' } },
        }),
        JobModule,
      ],
    }).compile();

    await mod.init();
    jobService = mod.get(JobService);
    moduleRef = mod as never;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (moduleRef && typeof (moduleRef as { close?: () => Promise<void> }).close === 'function') {
      await (moduleRef as { close: () => Promise<void> }).close();
    }
  });

  it('should wrap @Cron methods and create spans on execution', async () => {
    spans.length = 0;
    const result = await jobService.sendApplicationsToMinecofin();

    expect(result).toEqual({ sent: 5 });
    expect(jobService.callLog).toContain('minecofin');

    const span = spans.find((s) => s.name.includes('sendApplications'));
    expect(span).toBeDefined();
    expect(span!.name).toBe('scheduled/cron/sendApplications');
    expect(span!.attributes['schedule.type']).toBe('cron');
    expect(span!.attributes['schedule.cron_expression']).toBe('*/30 * * * *');
    expect(span!.status.code).toBe(SpanStatusCode.OK);
    expect(span!.ended).toBe(true);
  });

  it('should trace multiple cron jobs independently', async () => {
    spans.length = 0;
    await jobService.sendApplicationsToMinecofin();
    await jobService.checkMissedApplications();

    const minecofinSpan = spans.find((s) => s.name.includes('sendApplications'));
    const reconSpan = spans.find((s) => s.name.includes('dailyReconciliation'));

    expect(minecofinSpan).toBeDefined();
    expect(reconSpan).toBeDefined();
    expect(minecofinSpan!.name).not.toBe(reconSpan!.name);
  });

  it('should record errors on span when job throws', async () => {
    spans.length = 0;
    await expect(jobService.failingJob()).rejects.toThrow('External API timeout');

    const span = spans.find((s) => s.name.includes('failingJob'));
    expect(span).toBeDefined();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.exceptions.length).toBeGreaterThan(0);
    expect(span!.exceptions[0].message).toBe('External API timeout');
    expect(span!.ended).toBe(true);
  });

  it('should not wrap regular methods', async () => {
    spans.length = 0;
    const result = await jobService.regularMethod();
    expect(result).toBe('not-scheduled');
    expect(spans.length).toBe(0);
  });

  it('should set correct span attributes', async () => {
    spans.length = 0;
    await jobService.checkMissedApplications();

    const span = spans.find((s) => s.name.includes('dailyReconciliation'));
    expect(span!.attributes).toMatchObject({
      'schedule.type': 'cron',
      'schedule.job_name': 'dailyReconciliation',
      'schedule.method': 'checkMissedApplications',
      'schedule.class': 'JobService',
      'schedule.cron_expression': '0 0 * * *',
    });
  });
});
