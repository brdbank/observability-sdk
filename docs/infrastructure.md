# Observability Infrastructure Guide

This guide documents the full observability stack running on Kubernetes, how each component fits together, and how to add Grafana Tempo for distributed tracing.

## Table of Contents

- [Stack overview](#stack-overview)
- [Architecture diagram](#architecture-diagram)
- [Component reference](#component-reference)
  - [Prometheus](#prometheus)
  - [Loki](#loki)
  - [Promtail](#promtail)
  - [Tempo](#tempo)
  - [Grafana](#grafana)
- [Installing Tempo](#installing-tempo)
- [Connecting Tempo to Grafana](#connecting-tempo-to-grafana)
- [Connecting Loki and Tempo](#connecting-loki-and-tempo)
- [SDK exporter configuration](#sdk-exporter-configuration)
- [Verifying the pipeline](#verifying-the-pipeline)
- [Service endpoints reference](#service-endpoints-reference)
- [Troubleshooting](#troubleshooting)

---

## Stack overview

All observability components run in the `observability` namespace. The stack collects three signal types:

| Signal | Collector | Storage | Query |
|--------|-----------|---------|-------|
| **Metrics** | Prometheus scrapes `/metrics` endpoints | Prometheus TSDB | PromQL via Grafana |
| **Logs** | Promtail ships container stdout/stderr | Loki | LogQL via Grafana |
| **Traces** | SDK sends OTLP to Tempo | Tempo | TraceQL via Grafana |

Grafana is the single pane of glass — it queries all three backends and can correlate between them (click a trace ID in logs → see the full trace, click a trace → see matching logs).

---

## Architecture diagram

```
┌─────────────────────────────────────────────────────────────┐
│  Kubernetes Cluster                                         │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │  api-gateway     │  │  auth-service    │  ... (services)  │
│  │                  │  │                  │                   │
│  │  stdout (logs) ──┼──┼── Promtail ─────────► Loki          │
│  │  /metrics ───────┼──┼── Prometheus ◄──────┐               │
│  │  OTLP (traces) ──┼──┼──────────────────► Tempo           │
│  └─────────────────┘  └─────────────────┘                   │
│                                                             │
│                     ┌────────────┐                           │
│                     │  Grafana   │                           │
│                     │            │                           │
│                     │  Loki DS ──┼── LogQL                   │
│                     │  Prom DS ──┼── PromQL                  │
│                     │  Tempo DS ─┼── TraceQL                 │
│                     └────────────┘                           │
│                                                             │
│  Namespace: observability                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Component reference

### Prometheus

**What it does:** Scrapes metrics endpoints (`/metrics`) from all services at regular intervals and stores time-series data. Also scrapes node-level metrics via `node-exporter` on every cluster node.

**Helm chart:** `kube-prometheus-stack` (includes Prometheus, Grafana, node-exporter, kube-state-metrics, and the Prometheus Operator)

**Key pods:**

| Pod | Role |
|-----|------|
| `prometheus-prometheus-kube-prometheus-prometheus-0` | Prometheus server — scrapes and stores metrics |
| `prometheus-kube-prometheus-operator-*` | Manages Prometheus CRDs (ServiceMonitor, PodMonitor, PrometheusRule) |
| `prometheus-kube-state-metrics-*` | Exports Kubernetes object state as metrics (pod count, deployment status, etc.) |
| `prometheus-prometheus-node-exporter-*` | DaemonSet — one per node, exports CPU/memory/disk/network metrics |
| `prometheus-grafana-*` | Grafana instance (bundled with kube-prometheus-stack) |

**Services:**

| Service | Port | Purpose |
|---------|------|---------|
| `prometheus-kube-prometheus-prometheus` | 9090 | Prometheus query API (PromQL) |
| `prometheus-grafana` | 80 | Grafana web UI |
| `prometheus-kube-state-metrics` | 8080 | Kubernetes state metrics exporter |
| `prometheus-prometheus-node-exporter` | 9100 | Node hardware metrics |

**How the SDK connects:** The SDK exposes a `/metrics` endpoint on each service (via `MetricsController`). Prometheus discovers and scrapes these endpoints. No push configuration needed — Prometheus pulls.

**Adding a new service to Prometheus:** Create a `ServiceMonitor` CRD:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api-gateway
  namespace: observability
  labels:
    release: prometheus
spec:
  namespaceSelector:
    matchNames: [default]
  selector:
    matchLabels:
      app: api-gateway
  endpoints:
    - port: http
      path: /metrics
      interval: 30s
```

---

### Loki

**What it does:** Log aggregation system. Receives logs from Promtail, indexes them by labels (namespace, pod, container), and serves log queries via LogQL.

**Helm chart:** `loki` (Grafana Loki)

**Key pods:**

| Pod | Role |
|-----|------|
| `loki-0`, `loki-1`, `loki-2` | Loki instances (3-replica StatefulSet for HA) |
| `loki-gateway-*` | Nginx gateway — routes read/write traffic to Loki instances |
| `loki-chunks-cache-0` | Memcached — caches log chunks for faster queries |
| `loki-results-cache-0` | Memcached — caches query results |
| `loki-canary-*` | DaemonSet — writes test logs and verifies they can be read back (health check) |

**Services:**

| Service | Port | Purpose |
|---------|------|---------|
| `loki` | 3100 | Loki HTTP API (direct) |
| `loki-gateway` | 80 | Nginx gateway (use this for Grafana datasource) |
| `loki-headless` | 3100 | Headless service for StatefulSet peer discovery |
| `loki-memberlist` | 7946 | Memberlist gossip protocol for ring coordination |

**Grafana datasource URL:** `http://loki-gateway.observability.svc.cluster.local:80`

---

### Promtail

**What it does:** DaemonSet agent that runs on every node. Tails container log files from `/var/log/pods`, attaches Kubernetes labels (namespace, pod name, container name), and ships them to Loki.

**Helm chart:** `promtail`

**Key pods:**

| Pod | Role |
|-----|------|
| `promtail-*` (6 pods) | DaemonSet — one per node, ships logs to Loki |

**How it works:** Promtail reads container stdout/stderr from the node filesystem. When the SDK's `ObservabilityLogger` writes structured JSON to stdout, Promtail picks it up automatically — no service-level configuration needed. The JSON fields (`trace_id`, `span_id`, `request_id`, `level`, `msg`) are preserved and queryable in Loki via LogQL:

```logql
{namespace="default", app="api-gateway"} | json | trace_id != "" | level = "error"
```

---

### Tempo

**What it does:** Distributed tracing backend. Receives trace data via OTLP (OpenTelemetry Protocol), stores it, and serves trace queries. Integrates with Grafana for trace visualization and with Loki for log-to-trace correlation.

**Helm chart:** `tempo` (Grafana Tempo)

**Key pods:**

| Pod | Role |
|-----|------|
| `tempo-0` | Tempo server (single-binary mode) — ingests, stores, and queries traces |

**Services:**

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| `tempo` | 3100 | HTTP | **Tempo query API** — use this for Grafana datasource |
| `tempo` | 4317 | gRPC | **OTLP gRPC receiver** — services send traces here |
| `tempo` | 4318 | HTTP | **OTLP HTTP receiver** — services send traces here |
| `tempo` | 9411 | HTTP | Zipkin receiver (compatibility) |
| `tempo` | 14268 | HTTP | Jaeger HTTP receiver (compatibility) |
| `tempo` | 14250 | gRPC | Jaeger gRPC receiver (compatibility) |
| `tempo` | 6831 | UDP | Jaeger compact thrift (compatibility) |
| `tempo` | 6832 | UDP | Jaeger binary thrift (compatibility) |

**SDK sends traces to:** `http://tempo.observability.svc.cluster.local:4318` (OTLP HTTP)

**Grafana datasource URL:** `http://tempo.observability.svc.cluster.local:3100`

---

### Grafana

**What it does:** Visualization and dashboarding. Queries all three backends (Prometheus, Loki, Tempo) and provides a unified UI for metrics, logs, and traces.

**Deployed by:** `kube-prometheus-stack` Helm chart (bundled)

**Key pods:**

| Pod | Role |
|-----|------|
| `prometheus-grafana-*` | Grafana web server |

**Service:**

| Service | Port | Purpose |
|---------|------|---------|
| `prometheus-grafana` | 80 | Grafana web UI |

**Access:** `kubectl port-forward svc/prometheus-grafana -n observability 3000:80`

**Default credentials:** Check the Helm values or:
```bash
kubectl get secret prometheus-grafana -n observability -o jsonpath="{.data.admin-password}" | base64 -d
```

**Required datasources:**

| Datasource | Type | URL |
|------------|------|-----|
| Prometheus | Prometheus | `http://prometheus-kube-prometheus-prometheus.observability.svc.cluster.local:9090` |
| Loki | Loki | `http://loki-gateway.observability.svc.cluster.local:80` |
| Tempo | Tempo | `http://tempo.observability.svc.cluster.local:3100` |

---

## Installing Tempo

### Prerequisites

- Kubernetes cluster with `observability` namespace
- Helm 3 installed
- `grafana` Helm repo added (`helm repo add grafana https://grafana.github.io/helm-charts`)

### Install via Helm

```bash
helm repo update grafana

helm install tempo grafana/tempo \
  --namespace observability \
  --set tempo.receivers.otlp.protocols.http.endpoint="0.0.0.0:4318" \
  --set tempo.receivers.otlp.protocols.grpc.endpoint="0.0.0.0:4317"
```

**If `helm repo update` fails** (e.g., network restrictions), download the chart manually:

1. Download `tempo-*.tgz` from https://github.com/grafana/helm-charts/releases?q=tempo
2. Install from file:

```bash
helm install tempo ./tempo-1.18.0.tgz --namespace observability \
  --set tempo.receivers.otlp.protocols.http.endpoint="0.0.0.0:4318" \
  --set tempo.receivers.otlp.protocols.grpc.endpoint="0.0.0.0:4317"
```

### Verify installation

```bash
# Check pod is running
kubectl get pods -n observability -l app.kubernetes.io/name=tempo

# Check logs for errors
kubectl logs tempo-0 -n observability --tail=20

# Verify service endpoints
kubectl get svc tempo -n observability
```

Expected output: pod `1/1 Running`, logs show `"Tempo started"`, service exposes ports 3100, 4317, 4318.

---

## Connecting Tempo to Grafana

### Add Tempo datasource

1. Port-forward Grafana: `kubectl port-forward svc/prometheus-grafana -n observability 3000:80`
2. Open `http://localhost:3000` → Configuration → Data Sources → Add data source
3. Select **Tempo**
4. URL: `http://tempo.observability.svc.cluster.local:3100`
5. Click **Save & Test** — should show "Data source successfully connected"

---

## Connecting Loki and Tempo

This enables clicking between logs and traces in Grafana.

### Tempo → Loki (trace to logs)

In the **Tempo** datasource settings, scroll to **Trace to logs**:

| Setting | Value |
|---------|-------|
| Data source | Loki |
| Tags | `service.name` → `app` |
| Filter by trace ID | Enabled |
| Filter by span ID | Enabled |

This adds a "Logs" button on every trace — clicking it queries Loki for logs matching that trace's service and trace ID.

### Loki → Tempo (logs to trace)

In the **Loki** datasource settings, scroll to **Derived fields**:

| Setting | Value |
|---------|-------|
| Name | `TraceID` |
| Regex | `"trace_id":"([a-f0-9]+)"` |
| Internal link | Enabled → select **Tempo** |

This makes `trace_id` values in log lines clickable — clicking one opens the full distributed trace in Tempo.

---

## SDK exporter configuration

Once Tempo is running, update each service's `ObservabilityModule.forRoot()` to send traces to it:

### Before (console — traces go nowhere)

```typescript
ObservabilityModule.forRoot({
  serviceName: 'api-gateway',
  tracing: {
    exporter: { type: 'console' },
    sampling: { ratio: 1.0 },
  },
})
```

### After (OTLP to Tempo)

```typescript
ObservabilityModule.forRoot({
  serviceName: 'api-gateway',
  version: process.env.npm_package_version || '1.0.0',
  environment: process.env.NODE_ENV || 'development',
  tracing: {
    exporter: {
      type: process.env.NODE_ENV === 'development' ? 'console' : 'otlp-http',
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
        || 'http://tempo.observability.svc.cluster.local:4318',
    },
    sampling: {
      ratio: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    },
  },
  instrumentations: [
    httpInstrumentation({ ignoreIncomingPaths: ['/health', '/metrics'] }),
    kafkaInstrumentation(),
    // Add per service:
    // sequelizeInstrumentation(),  // if service uses Sequelize
    // redisInstrumentation(),      // if service uses Redis
  ],
})
```

### Environment variable override

Set `OTEL_EXPORTER_OTLP_ENDPOINT` in your Kubernetes deployment manifest or ConfigMap to override the endpoint without code changes:

```yaml
env:
  - name: OTEL_EXPORTER_OTLP_ENDPOINT
    value: "http://tempo.observability.svc.cluster.local:4318"
  - name: NODE_ENV
    value: "production"
```

---

## Verifying the pipeline

### 1. Send a test trace to Tempo

```bash
kubectl run test-trace --rm -it --restart=Never \
  --image=curlimages/curl -n observability -- \
  -X POST http://tempo.observability.svc.cluster.local:4318/v1/traces \
  -H "Content-Type: application/json" \
  -d '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"test"}}]},"scopeSpans":[{"spans":[{"traceId":"d4cda95b652f4a1592b449d5929fda1b","spanId":"6e0c63257de34c92","name":"test-span","kind":1,"startTimeUnixNano":"1721000000000000000","endTimeUnixNano":"1721000001000000000","status":{}}]}]}]}'
```

### 2. Query the test trace in Grafana

Open Grafana → Explore → select **Tempo** → Search by trace ID: `d4cda95b652f4a1592b449d5929fda1b`

### 3. Verify a real service

After redeploying a service with the OTLP exporter:

```bash
# Make a request to the service
curl http://<service-url>/api/health

# Check Tempo received it
kubectl logs tempo-0 -n observability --tail=10 | grep -i "ingester\|trace"
```

Then in Grafana → Explore → Tempo → search by `service.name = api-gateway`.

### 4. Verify log-trace correlation

In Grafana → Explore → Loki → run:

```logql
{namespace="default", app="api-gateway"} | json | trace_id != ""
```

Each log line should have a clickable `trace_id` that opens the corresponding trace in Tempo.

---

## Service endpoints reference

Quick reference for all internal service URLs used by the observability stack:

| Component | Internal URL | Used by |
|-----------|-------------|---------|
| Prometheus | `http://prometheus-kube-prometheus-prometheus.observability.svc.cluster.local:9090` | Grafana (datasource) |
| Loki Gateway | `http://loki-gateway.observability.svc.cluster.local:80` | Grafana (datasource) |
| Loki Direct | `http://loki.observability.svc.cluster.local:3100` | Promtail (push logs) |
| Tempo Query | `http://tempo.observability.svc.cluster.local:3100` | Grafana (datasource) |
| Tempo OTLP HTTP | `http://tempo.observability.svc.cluster.local:4318` | Application services (send traces) |
| Tempo OTLP gRPC | `tempo.observability.svc.cluster.local:4317` | Application services (send traces, gRPC) |
| Grafana | `http://prometheus-grafana.observability.svc.cluster.local:80` | Browser via port-forward |

---

## Troubleshooting

### Traces not appearing in Tempo

1. **Is the service exporter set to `otlp-http`?** Check `app.module.ts` — if it's still `'console'`, traces only print to stdout.
2. **Can the service reach Tempo?** Exec into the pod and test:
   ```bash
   kubectl exec -it <pod> -- wget -q -O- http://tempo.observability.svc.cluster.local:3100/ready
   ```
3. **Is Tempo healthy?**
   ```bash
   kubectl logs tempo-0 -n observability --tail=20
   ```
4. **Check for network policies** blocking traffic from the service namespace to the observability namespace.

### Logs missing trace_id

- The service is using the legacy `LoggerService` instead of `ObservabilityLogger`. Only the SDK's pino logger auto-injects `trace_id`/`span_id`.
- Check the log output — if it's Winston format (not JSON), it's the old logger.

### Prometheus not scraping a service

1. Verify the service has a `ServiceMonitor` with `release: prometheus` label.
2. Check Prometheus targets: port-forward to 9090 → Status → Targets → look for the service.
3. Verify the `/metrics` endpoint responds: `curl http://<service>:<port>/metrics`

### Grafana "Unable to connect" to a datasource

- Verify the service is running: `kubectl get svc -n observability`
- Check you're using the correct port (3100 for Tempo query, not 4318)
- Test from within the cluster: `kubectl run test --rm -it --image=curlimages/curl -- http://tempo.observability.svc.cluster.local:3100/ready`
