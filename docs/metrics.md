# Metrics & Dashboards Guide

This guide covers how to collect, expose, and visualize metrics with the `@brdrwanda/observability` SDK.

## Table of Contents

- [Auto HTTP metrics](#auto-http-metrics)
- [Custom business metrics](#custom-business-metrics)
- [Exemplars (metrics to traces)](#exemplars-metrics--traces)
- [Metrics configuration](#metrics-configuration)
- [Prometheus scraping](#prometheus-scraping)
- [Grafana dashboard queries](#grafana-dashboard-queries)

---

## Auto HTTP metrics

When you import `ObservabilityModule.forRoot()`, the SDK automatically registers a `MetricsInterceptor` that tracks every HTTP request. You get three things out of the box with zero code:

### 1. `http_requests_total` counter

Labels: `method`, `route`, `status_code`

Counts every HTTP request that enters your service. Incremented on both success and error responses.

### 2. `http_request_duration_seconds` histogram

Labels: `method`, `route`, `status_code`

Measures how long each request takes in seconds. Default buckets: `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10`.

When tracing is enabled, each histogram observation includes a `trace_id` exemplar so you can jump from a slow data point straight to its trace in Grafana Tempo.

### 3. Node.js default metrics

Standard `prom-client` default metrics are collected automatically:

- `process_cpu_user_seconds_total` — CPU time spent in user mode
- `process_cpu_system_seconds_total` — CPU time spent in system mode
- `process_resident_memory_bytes` — Resident memory size
- `nodejs_heap_size_total_bytes` — V8 total heap size
- `nodejs_heap_size_used_bytes` — V8 used heap size
- `nodejs_eventloop_lag_seconds` — Event loop lag
- `nodejs_active_handles_total` — Active libuv handles
- `nodejs_active_requests_total` — Active libuv requests

### 4. `/metrics` endpoint

A `MetricsController` is auto-registered at `/metrics`. Prometheus scrapes this endpoint. The controller negotiates content type — it returns OpenMetrics format when the client sends `Accept: application/openmetrics-text`, and Prometheus text format otherwise.

### Example Prometheus output

Hit `GET /metrics` on a running service to see output like this:

```
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/api/loans",status_code="200",service="loan-service",environment="production"} 1524
http_requests_total{method="POST",route="/api/loans/apply",status_code="201",service="loan-service",environment="production"} 312
http_requests_total{method="GET",route="/api/loans/:id",status_code="404",service="loan-service",environment="production"} 7

# HELP http_request_duration_seconds HTTP request duration in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="0.01"} 980
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="0.025"} 1350
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="0.05"} 1480
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="0.1"} 1510
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="0.25"} 1520
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="0.5"} 1524
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="1"} 1524
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="2.5"} 1524
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="5"} 1524
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="10"} 1524
http_request_duration_seconds_bucket{method="GET",route="/api/loans",status_code="200",le="+Inf"} 1524
http_request_duration_seconds_sum{method="GET",route="/api/loans",status_code="200"} 18.274
http_request_duration_seconds_count{method="GET",route="/api/loans",status_code="200"} 1524

# HELP process_resident_memory_bytes Resident memory size in bytes.
# TYPE process_resident_memory_bytes gauge
process_resident_memory_bytes 98304000

# HELP nodejs_eventloop_lag_seconds Lag of event loop in seconds.
# TYPE nodejs_eventloop_lag_seconds gauge
nodejs_eventloop_lag_seconds 0.0024
```

---

## Custom business metrics

Inject `ObservabilityMetrics` to create counters, histograms, and gauges for your domain-specific data.

```typescript
import { Injectable } from '@nestjs/common';
import { ObservabilityMetrics } from '@brdrwanda/observability';
import type { Counter, Histogram, Gauge } from 'prom-client';

@Injectable()
export class LoanService {
  private loansApproved: Counter;
  private loanProcessingTime: Histogram;
  private activeApplications: Gauge;

  constructor(private metrics: ObservabilityMetrics) {
    this.loansApproved = metrics.createCounter(
      'loans_approved_total',
      'Total number of approved loans',
      ['loan_type'],
    );
    this.loanProcessingTime = metrics.createHistogram(
      'loan_processing_duration_seconds',
      'Time to process a loan application',
      ['loan_type'],
      [0.1, 0.5, 1, 2, 5, 10, 30],
    );
    this.activeApplications = metrics.createGauge(
      'active_loan_applications',
      'Currently active loan applications',
      ['status'],
    );
  }

  async approveLoan(application: LoanApplication) {
    this.loansApproved.inc({ loan_type: application.type });
    this.activeApplications.dec({ status: 'pending' });
    this.activeApplications.inc({ status: 'approved' });
  }
}
```

### API reference

| Method | What it creates | Use case |
|--------|----------------|----------|
| `createCounter(name, help, labels?)` | A counter that only goes up | Request counts, errors, events |
| `createHistogram(name, help, labels?, buckets?, enableExemplars?)` | A histogram with configurable buckets | Durations, sizes, latencies |
| `createGauge(name, help, labels?)` | A value that goes up and down | Active connections, queue depth, temperature |

### Counter

```typescript
const errors = metrics.createCounter('payment_errors_total', 'Payment errors', ['error_type']);
errors.inc({ error_type: 'timeout' });        // increment by 1
errors.inc({ error_type: 'validation' }, 3);  // increment by 3
```

### Histogram

```typescript
const duration = metrics.createHistogram(
  'external_api_duration_seconds',
  'External API call duration',
  ['api_name'],
  [0.1, 0.5, 1, 2, 5, 10],  // custom bucket boundaries
);
duration.observe({ api_name: 'esri' }, 1.234);  // record an observation

// Or use a timer
const end = duration.startTimer({ api_name: 'esri' });
await callExternalApi();
end();  // automatically records the elapsed time
```

If no `buckets` array is provided, the SDK uses these defaults: `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`.

### Gauge

```typescript
const queue = metrics.createGauge('job_queue_size', 'Pending jobs in queue', ['priority']);
queue.set({ priority: 'high' }, 42);  // set to absolute value
queue.inc({ priority: 'high' });      // increment by 1
queue.dec({ priority: 'high' });      // decrement by 1
```

---

## Exemplars (metrics &rarr; traces)

Exemplars link a specific metric data point to the trace that produced it. When you see a latency spike on a Grafana histogram panel, you can click the exemplar dot and jump directly to the trace in Tempo that caused it.

### How it works

The SDK's `MetricsInterceptor` automatically attaches `trace_id` as an exemplar on every `http_request_duration_seconds` histogram observation. This happens when tracing is enabled — no extra configuration needed.

```typescript
// This is what the interceptor does internally (you don't write this code):
this.httpRequestDuration.observe({
  labels: { method, route, status_code: statusCode },
  value: duration,
  exemplarLabels: traceId ? { trace_id: traceId } : undefined,
});
```

### Adding exemplars to custom histograms

To add exemplars to your own histograms, pass `enableExemplars: true` when creating them:

```typescript
import { getContext } from '@brdrwanda/observability';

const processingTime = metrics.createHistogram(
  'loan_processing_duration_seconds',
  'Time to process a loan application',
  ['loan_type'],
  [0.1, 0.5, 1, 2, 5, 10, 30],
  true, // enableExemplars
);

// When observing, include the trace_id as an exemplar label
const traceId = getContext()?.traceId;
processingTime.observe({
  labels: { loan_type: 'personal' },
  value: 2.45,
  exemplarLabels: traceId ? { trace_id: traceId } : undefined,
});
```

### Viewing exemplars in Grafana

1. Prometheus must be started with `--enable-feature=exemplar-storage` (the sandbox docker-compose already does this)
2. In a Grafana histogram or heatmap panel, enable **Exemplars** in the query options
3. Small diamonds appear on the graph at data points that have exemplars
4. Click a diamond to see its `trace_id`, then click through to Tempo

### Prometheus format with exemplar

```
http_request_duration_seconds_bucket{method="POST",route="/api/loans/apply",status_code="201",le="5"} 312 # {trace_id="8cf631b00df8e35a403e57823ac58eee"} 3.21 1719900000.000
```

---

## Metrics configuration

```typescript
ObservabilityModule.forRoot({
  serviceName: 'loan-service',
  metrics: {
    enabled: true,          // default: true — set to false to disable all metrics
    prefix: '',             // prefix for all metric names (e.g., 'lending' → 'lending_http_requests_total')
    defaultMetrics: true,   // default: true — collect Node.js runtime metrics
    endpoint: '/metrics',   // default: '/metrics' — Prometheus scrape endpoint path
    labels: {               // default labels applied to every metric
      team: 'lending',
    },
  },
})
```

### Configuration options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | When `false`, no metrics interceptor or controller is registered |
| `prefix` | `string` | `''` | Prepended to all metric names. If set to `'lending'`, a metric `http_requests_total` becomes `lending_http_requests_total` |
| `defaultMetrics` | `boolean` | `true` | Collect Node.js runtime metrics (memory, CPU, event loop lag) |
| `endpoint` | `string` | `'/metrics'` | The HTTP path where Prometheus scrapes metrics |
| `labels` | `Record<string, string>` | `{}` | Default labels attached to every metric. `service` and `environment` are always included automatically |

### Automatic default labels

The SDK always adds these labels to every metric, regardless of your config:

```typescript
{
  service: config.serviceName,    // e.g., 'loan-service'
  environment: config.environment // e.g., 'production'
}
```

Any labels you add in `metrics.labels` are merged on top of these.

### Disabling metrics

```typescript
ObservabilityModule.forRoot({
  serviceName: 'my-service',
  metrics: {
    enabled: false,  // no MetricsController, no MetricsInterceptor
  },
})
```

When disabled, `ObservabilityMetrics` is still provided as a dependency (so injected constructors don't break), but the `/metrics` endpoint and auto-collection interceptor are not registered.

---

## Prometheus scraping

### prometheus.yml

Add your service as a scrape target in your Prometheus configuration:

```yaml
scrape_configs:
  - job_name: "loan-service"
    metrics_path: /metrics
    scrape_interval: 15s
    static_configs:
      - targets: ["localhost:3000"]

  - job_name: "api-gateway"
    metrics_path: /metrics
    static_configs:
      - targets: ["localhost:7070"]

  - job_name: "authentication-service"
    metrics_path: /metrics
    static_configs:
      - targets: ["localhost:9001"]
```

### Enable exemplar storage

To use exemplars (metrics-to-trace linking), Prometheus must be started with the exemplar feature flag:

```yaml
# docker-compose.yml
prometheus:
  image: prom/prometheus:v2.52.0
  command:
    - '--config.file=/etc/prometheus/prometheus.yml'
    - '--enable-feature=exemplar-storage'
```

### OpenMetrics content negotiation

The SDK's `/metrics` endpoint supports both Prometheus text format and OpenMetrics format. Add the OpenMetrics scrape protocol in your Prometheus config for exemplar support:

```yaml
global:
  scrape_interval: 15s
  scrape_protocols:
    - OpenMetricsText1.0.0
    - OpenMetricsText0.0.1
    - PrometheusProto
    - PrometheusText0.0.4
```

### Verify scraping works

```bash
# Check that the service exposes metrics
curl http://localhost:3000/metrics

# Check that Prometheus is scraping successfully
curl http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'
```

---

## Grafana dashboard queries

Practical PromQL queries for building dashboards. All examples assume the default metric names (no prefix).

### Request rate

Total requests per second across all routes:

```promql
rate(http_requests_total[5m])
```

Request rate for a specific service:

```promql
rate(http_requests_total{service="loan-service"}[5m])
```

Request rate grouped by route:

```promql
sum by (route) (rate(http_requests_total{service="loan-service"}[5m]))
```

### Error rate

5xx errors per second:

```promql
rate(http_requests_total{status_code=~"5.."}[5m])
```

Error percentage (useful for SLO dashboards):

```promql
sum(rate(http_requests_total{status_code=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))
* 100
```

Error rate by route (find which endpoints are failing):

```promql
sum by (route) (rate(http_requests_total{status_code=~"5.."}[5m]))
```

### Latency

P95 latency (95th percentile request duration):

```promql
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

P99 latency:

```promql
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))
```

P95 latency per route:

```promql
histogram_quantile(0.95, sum by (route, le) (rate(http_request_duration_seconds_bucket[5m])))
```

Average request duration:

```promql
rate(http_request_duration_seconds_sum[5m])
/
rate(http_request_duration_seconds_count[5m])
```

### Custom business metrics

Loan approvals per hour:

```promql
rate(loans_approved_total[1h])
```

Loan approvals by type:

```promql
sum by (loan_type) (rate(loans_approved_total[1h]))
```

Currently active loan applications:

```promql
active_loan_applications
```

P95 loan processing time:

```promql
histogram_quantile(0.95, rate(loan_processing_duration_seconds_bucket[5m]))
```

### Node.js runtime

Memory usage:

```promql
process_resident_memory_bytes{service="loan-service"} / 1024 / 1024
```

Event loop lag (should stay under ~100ms):

```promql
nodejs_eventloop_lag_seconds{service="loan-service"}
```

CPU usage rate:

```promql
rate(process_cpu_user_seconds_total{service="loan-service"}[5m])
```

### Alert-worthy queries

High error rate alert (more than 5% of requests are 5xx):

```promql
sum(rate(http_requests_total{status_code=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))
> 0.05
```

High latency alert (P95 above 2 seconds):

```promql
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
> 2
```

Memory usage alert (above 512 MB):

```promql
process_resident_memory_bytes > 536870912
```
