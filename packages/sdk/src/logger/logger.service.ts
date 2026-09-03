import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { getContext } from '../core/context';
import type { ResolvedConfig } from '../core/types';

export class ObservabilityLogger {
  private pino: pino.Logger;

  constructor(private config: ResolvedConfig) {
    this.pino = this.createLogger(config);
  }

  private createLogger(config: ResolvedConfig): pino.Logger {
    const baseOptions: pino.LoggerOptions = {
      name: config.serviceName,
      level: config.logger.level,
      redact: {
        paths: config.logger.redaction.paths,
        censor: config.logger.redaction.censor,
      },
      serializers: {
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
        err: pino.stdSerializers.err,
      },
      mixin: () => this.getContextFields(),
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
    };

    const transport = this.buildTransport(config);
    if (!transport) return pino(baseOptions);

    try {
      const logger = pino({ ...baseOptions, transport });

      // Listen for worker thread errors — if OTLP transport crashes,
      // fall back to stdout-only logger instead of taking down the service
      const dest = (logger as unknown as Record<symbol, NodeJS.WritableStream>)[pino.symbols.streamSym];
      if (dest?.on) {
        dest.on('error', (err: Error) => {
          console.error(`[observability] Transport worker error, falling back to stdout: ${err.message}`);
          this.pino = pino(baseOptions);
        });
      }

      return logger;
    } catch (err) {
      console.error(`[observability] Failed to init transport, falling back to stdout: ${(err as Error).message}`);
      return pino(baseOptions);
    }
  }

  private buildTransport(config: ResolvedConfig): pino.TransportSingleOptions | pino.TransportMultiOptions | undefined {
    const targets: pino.TransportTargetOptions[] = [];

    if (config.logger.otlpExport) {
      targets.push({
        target: 'pino-opentelemetry-transport',
        options: {
          resourceAttributes: {
            'service.name': config.serviceName,
            'deployment.environment': config.environment,
            'service.version': config.version,
            'log.pipeline': 'otlp',
          },
        },
      });
    }

    if (config.logger.prettyPrint) {
      targets.push({
        target: 'pino-pretty',
        options: { colorize: true },
      });
    }

    // No transports — write to stdout directly (fastest)
    if (targets.length === 0) return undefined;

    // Single transport
    if (targets.length === 1) return { target: targets[0].target, options: targets[0].options };

    // Multiple transports
    return { targets };
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.pino.debug(meta || {}, message);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.pino.info(meta || {}, message);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.pino.warn(meta || {}, message);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.pino.error(meta || {}, message);
  }

  fatal(message: string, meta?: Record<string, unknown>): void {
    this.pino.fatal(meta || {}, message);
  }

  logCaughtError(error: unknown): void {
    const err = error as Record<string, any>;
    const status = err?.getStatus?.() ?? err?.statusCode ?? 500;
    const message = err?.response?.message ?? err?.message ?? 'Unknown error';
    const meta: Record<string, unknown> = { statusCode: status, message };

    if (status >= 500) {
      meta.stack = err?.stack;
      this.pino.error(meta, 'request_error');
    } else {
      this.pino.warn(meta, 'request_error');
    }
  }

  child(bindings: Record<string, unknown>): ObservabilityLogger {
    const child = Object.create(this) as ObservabilityLogger;
    child.pino = this.pino.child(bindings);
    return child;
  }

  getPinoInstance(): pino.Logger {
    return this.pino;
  }

  private getContextFields(): Record<string, unknown> {
    const ctx = getContext();
    const span = trace.getActiveSpan();
    const spanCtx = span?.spanContext();

    return {
      service_name: this.config.serviceName,
      environment: this.config.environment,
      version: this.config.version,
      ...(ctx && {
        request_id: ctx.requestId,
        correlation_id: ctx.correlationId,
        ...(ctx.clientApp && { client_app: ctx.clientApp }),
      }),
      ...(spanCtx && {
        trace_id: spanCtx.traceId,
        span_id: spanCtx.spanId,
      }),
    };
  }
}
