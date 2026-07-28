import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { trace, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { OBSERVABILITY_CONFIG, OBSERVABILITY_METRICS } from '../core/constants';
import { createRequestContext, runWithContext, enrichContextFromSpan } from '../core/context';
import type { ResolvedConfig } from '../core/types';
import type { ObservabilityMetrics } from '../metrics/metrics.service';

const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';
const SCHEDULE_INTERVAL_OPTIONS = 'SCHEDULE_INTERVAL_OPTIONS';
const SCHEDULE_TIMEOUT_OPTIONS = 'SCHEDULE_TIMEOUT_OPTIONS';

interface ScheduleMetadata {
  type: 'cron' | 'interval' | 'timeout';
  cronTime?: string;
  name?: string;
  interval?: number;
  timeout?: number;
}

@Injectable()
export class ScheduleTracingService implements OnModuleInit {
  private readonly tracer = trace.getTracer('@ivymurage/observability');
  private scheduledJobDuration: ReturnType<ObservabilityMetrics['createHistogram']> | null = null;
  private scheduledJobErrors: ReturnType<ObservabilityMetrics['createCounter']> | null = null;

  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
    @Inject(OBSERVABILITY_CONFIG) private readonly config: ResolvedConfig,
    @Inject(OBSERVABILITY_METRICS) private readonly metrics: ObservabilityMetrics,
  ) {
    if (config.metrics.enabled) {
      this.scheduledJobDuration = metrics.createHistogram(
        'scheduled_job_duration_seconds',
        'Duration of scheduled job executions',
        ['job_name', 'job_type', 'status'],
        [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 300],
      );
      this.scheduledJobErrors = metrics.createCounter(
        'scheduled_job_errors_total',
        'Total scheduled job execution errors',
        ['job_name', 'job_type'],
      );
    }
  }

  onModuleInit(): void {
    this.discoverAndWrapMethods();
    this.patchOrchestratorCallbacks();
  }

  private discoverAndWrapMethods(): void {
    const providers = this.discovery.getProviders();

    for (const wrapper of providers) {
      const instance = wrapper.instance;
      if (!instance || typeof instance !== 'object') continue;

      const prototype = Object.getPrototypeOf(instance);
      if (!prototype) continue;

      const methodNames = this.scanner.getAllMethodNames(prototype);

      for (const methodName of methodNames) {
        const metadata = this.extractScheduleMetadata(prototype, methodName);
        if (!metadata) continue;

        this.wrapMethod(instance as Record<string, unknown>, prototype, methodName, metadata);
      }
    }
  }

  private patchOrchestratorCallbacks(): void {
    const providers = this.discovery.getProviders();
    const orchestratorWrapper = providers.find(
      (p) => p.instance?.constructor?.name === 'SchedulerOrchestrator',
    );

    if (!orchestratorWrapper?.instance) return;

    const orchestrator = orchestratorWrapper.instance as Record<string, Record<string, { target: Function; timeout?: number; options?: Record<string, unknown> }>>;

    this.wrapStoredCallbacks(orchestrator['cronJobs'], 'cron');
    this.wrapStoredCallbacks(orchestrator['intervals'], 'interval');
    this.wrapStoredCallbacks(orchestrator['timeouts'], 'timeout');
  }

  private wrapStoredCallbacks(
    store: Record<string, { target: Function; timeout?: number; options?: Record<string, unknown> }> | undefined,
    type: 'cron' | 'interval' | 'timeout',
  ): void {
    if (!store) return;

    for (const name of Object.keys(store)) {
      const entry = store[name];
      if (!entry?.target) continue;

      const original = entry.target;
      const spanName = `scheduled/${type}/${name}`;
      const cronExpression = type === 'cron' ? String(entry.options?.['cronTime'] ?? '') : undefined;
      const self = this;

      entry.target = async function (this: unknown, ...args: unknown[]) {
        const ctx = createRequestContext(
          self.config.serviceName,
          self.config.environment,
          self.config.version,
        );

        return runWithContext(ctx, () => {
          return self.tracer.startActiveSpan(
            spanName,
            {
              kind: SpanKind.INTERNAL,
              attributes: {
                'schedule.type': type,
                'schedule.job_name': name,
                ...(cronExpression && { 'schedule.cron_expression': cronExpression }),
              },
            },
            async (span) => {
              enrichContextFromSpan();
              const start = performance.now();

              try {
                const result = await original.apply(this, args);
                span.setStatus({ code: SpanStatusCode.OK });

                self.scheduledJobDuration?.observe(
                  { job_name: name, job_type: type, status: 'success' },
                  (performance.now() - start) / 1000,
                );

                return result;
              } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
                span.recordException(err);

                self.scheduledJobDuration?.observe(
                  { job_name: name, job_type: type, status: 'error' },
                  (performance.now() - start) / 1000,
                );
                self.scheduledJobErrors?.inc({ job_name: name, job_type: type });

                throw error;
              } finally {
                span.end();
              }
            },
          );
        });
      };
    }
  }

  private extractScheduleMetadata(prototype: object, methodName: string): ScheduleMetadata | null {
    const method = (prototype as Record<string, unknown>)[methodName];
    if (typeof method !== 'function') return null;

    const cronOptions = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, method);
    if (cronOptions) {
      return {
        type: 'cron',
        cronTime: cronOptions.cronTime,
        name: cronOptions.name,
      };
    }

    const intervalOptions = Reflect.getMetadata(SCHEDULE_INTERVAL_OPTIONS, method);
    if (intervalOptions) {
      return {
        type: 'interval',
        name: intervalOptions.name,
        interval: intervalOptions.timeout ?? intervalOptions,
      };
    }

    const timeoutOptions = Reflect.getMetadata(SCHEDULE_TIMEOUT_OPTIONS, method);
    if (timeoutOptions) {
      return {
        type: 'timeout',
        name: timeoutOptions.name,
        timeout: timeoutOptions.timeout ?? timeoutOptions,
      };
    }

    return null;
  }

  private wrapMethod(
    instance: Record<string, unknown>,
    prototype: object,
    methodName: string,
    metadata: ScheduleMetadata,
  ): void {
    const original = (prototype as Record<string, Function>)[methodName];
    const className = instance.constructor?.name || 'UnknownProvider';
    const jobName = metadata.name || `${className}.${methodName}`;
    const spanName = `scheduled/${metadata.type}/${jobName}`;

    const self = this;

    const wrapped = async function (this: unknown, ...args: unknown[]) {
      const ctx = createRequestContext(
        self.config.serviceName,
        self.config.environment,
        self.config.version,
      );

      return runWithContext(ctx, () => {
        return self.tracer.startActiveSpan(
          spanName,
          {
            kind: SpanKind.INTERNAL,
            attributes: {
              'schedule.type': metadata.type,
              'schedule.job_name': jobName,
              'schedule.method': methodName,
              'schedule.class': className,
              ...(metadata.cronTime && { 'schedule.cron_expression': metadata.cronTime }),
              ...(metadata.interval != null && { 'schedule.interval_ms': metadata.interval }),
              ...(metadata.timeout != null && { 'schedule.timeout_ms': metadata.timeout }),
            },
          },
          async (span) => {
            enrichContextFromSpan();
            const start = performance.now();

            try {
              const result = await original.apply(this, args);
              span.setStatus({ code: SpanStatusCode.OK });

              self.scheduledJobDuration?.observe(
                { job_name: jobName, job_type: metadata.type, status: 'success' },
                (performance.now() - start) / 1000,
              );

              return result;
            } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
              span.recordException(err);

              self.scheduledJobDuration?.observe(
                { job_name: jobName, job_type: metadata.type, status: 'error' },
                (performance.now() - start) / 1000,
              );
              self.scheduledJobErrors?.inc({ job_name: jobName, job_type: metadata.type });

              throw error;
            } finally {
              span.end();
            }
          },
        );
      });
    };

    (prototype as Record<string, unknown>)[methodName] = wrapped;
    instance[methodName] = wrapped;
  }
}
