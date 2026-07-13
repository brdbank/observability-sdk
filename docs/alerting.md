# Alerting & Monitoring

The SDK exposes Prometheus metrics. Combined with the sandbox's alerting pipeline (Prometheus rules, Alertmanager, Teams webhook), you get production alerts out of the box.

---

## How Alerting Works

```
SDK /metrics endpoint
    → Prometheus scrapes every 15s
    → Alert rules evaluate against scraped data
    → Alertmanager receives firing alerts
    → Routes to Microsoft Teams (via prometheus-msteams forwarder)
```

All infrastructure runs in the sandbox `docker-compose.yml`. In production, the same pattern applies — Prometheus scrapes your services, evaluates rules, and fires to Alertmanager.

---

## Built-in Alert Rules

The sandbox ships with 6 pre-configured alerts in `sandbox/alerts.yml`:

### Service Health

| Alert | Condition | Severity | Fires After |
|-------|-----------|----------|-------------|
| **ServiceDown** | `up == 0` | critical | 1 minute |
| **HighErrorRate** | 5xx rate > 5% of total requests | critical | 5 minutes |
| **HighLatencyP95** | P95 response time > 2 seconds | warning | 5 minutes |
| **HighLatencyP99** | P99 response time > 5 seconds | critical | 5 minutes |

### Node.js Runtime

| Alert | Condition | Severity | Fires After |
|-------|-----------|----------|-------------|
| **HighMemoryUsage** | Heap usage > 85% | warning | 10 minutes |
| **HighEventLoopLag** | Event loop lag > 500ms | warning | 5 minutes |

### Alert Rule Details

**HighErrorRate:**

```yaml
- alert: HighErrorRate
  expr: |
    (
      sum by (job) (rate({__name__=~".+_http_requests_total", status_code=~"5.."}[5m]))
      /
      sum by (job) (rate({__name__=~".+_http_requests_total"}[5m]))
    ) > 0.05
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "{{ $labels.job }} error rate above 5%"
```

**HighLatencyP95:**

```yaml
- alert: HighLatencyP95
  expr: |
    histogram_quantile(0.95,
      sum by (job, le) (rate({__name__=~".+_http_request_duration_seconds_bucket"}[5m]))
    ) > 2
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "{{ $labels.job }} p95 latency above 2s"
```

---

## Custom Alert Rules

Add new rules to `sandbox/alerts.yml` (or your production Prometheus config):

```yaml
groups:
  - name: business
    rules:
      - alert: HighLoanRejectionRate
        expr: |
          rate(loans_rejected_total[5m])
          /
          rate(loans_processed_total[5m]) > 0.3
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Loan rejection rate above 30%"
          description: "{{ $labels.service }} rejection rate is {{ $value | humanizePercentage }}"

      - alert: PaymentProcessingFailed
        expr: increase(payment_failures_total[5m]) > 5
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Multiple payment failures in {{ $labels.service }}"

      - alert: ExternalAPITimeout
        expr: |
          rate(external_api_errors_total{error_type="timeout"}[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "External API timeouts increasing for {{ $labels.service }}"
```

These custom alerts work with the custom metrics you define using `ObservabilityMetrics`. See the [Metrics guide](metrics.md) for creating business metrics.

---

## Alertmanager Configuration

The sandbox Alertmanager routes all alerts to Microsoft Teams via `prometheus-msteams`:

```yaml
# sandbox/alertmanager.yml
global:
  resolve_timeout: 5m

route:
  receiver: microsoft-teams
  group_by: [alertname, job]
  group_wait: 30s          # wait before sending first notification
  group_interval: 5m       # time between notifications for same group
  repeat_interval: 4h      # resend if alert still firing

receivers:
  - name: microsoft-teams
    webhook_configs:
      - url: 'http://teams-forwarder:2000/alertmanager'
        send_resolved: true
```

### Routing by Severity

For production, route critical alerts to a different channel:

```yaml
route:
  receiver: default
  group_by: [alertname, job]
  routes:
    - match:
        severity: critical
      receiver: critical-channel
      repeat_interval: 1h
    - match:
        severity: warning
      receiver: warning-channel
      repeat_interval: 4h

receivers:
  - name: critical-channel
    webhook_configs:
      - url: 'http://teams-forwarder:2000/critical'
        send_resolved: true
  - name: warning-channel
    webhook_configs:
      - url: 'http://teams-forwarder:2000/warnings'
        send_resolved: true
  - name: default
    webhook_configs:
      - url: 'http://teams-forwarder:2000/alertmanager'
```

---

## Notification Channels

### Microsoft Teams (Default)

The sandbox uses `prometheus-msteams` as a forwarder. Configure your Teams webhook URL in `sandbox/teams-forwarder.yml`:

```yaml
connectors:
  - alertmanager:
      webhook_url: "https://outlook.office.com/webhook/YOUR-WEBHOOK-URL"
```

### Slack

Add a Slack receiver to Alertmanager:

```yaml
receivers:
  - name: slack
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'
        channel: '#alerts'
        title: '{{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}{{ end }}'
        send_resolved: true
```

### Email

```yaml
receivers:
  - name: email
    email_configs:
      - to: 'oncall@brd.rw'
        from: 'alerts@brd.rw'
        smarthost: 'smtp.brd.rw:587'
        auth_username: 'alerts@brd.rw'
        auth_password: '$SMTP_PASSWORD'
```

---

## Recommended Alerts for BRD Services

| Alert | PromQL | Severity | Rationale |
|-------|--------|----------|-----------|
| High error rate | `rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.01` | critical | >1% errors indicates a real problem |
| High latency | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2` | warning | P95 > 2s degrades user experience |
| Service unreachable | `up == 0` | critical | Service is completely down |
| Memory pressure | `nodejs_heap_size_used_bytes / nodejs_heap_size_total_bytes > 0.85` | warning | Approaching OOM |
| Event loop blocked | `nodejs_eventloop_lag_seconds > 0.5` | warning | Indicates sync CPU work blocking |
| Auth failure spike | `rate(http_requests_total{status_code="401"}[5m]) > 10` | warning | Brute force or misconfigured client |
| Loan processing backlog | `active_loan_applications{status="pending"} > 100` | warning | Queue growing faster than processing |

---

## Testing Alerts

### Trigger a test alert manually

```bash
curl -X POST http://localhost:9093/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": { "alertname": "TestAlert", "severity": "info", "job": "test" },
    "annotations": { "summary": "Test alert — please ignore" }
  }]'
```

### Check active alerts

```bash
# Prometheus alerts
curl http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | {alertname: .labels.alertname, state: .state}'

# Alertmanager alerts
curl http://localhost:9093/api/v1/alerts | jq '.[].labels.alertname'
```

### Silence an alert during maintenance

```bash
curl -X POST http://localhost:9093/api/v1/silences \
  -H "Content-Type: application/json" \
  -d '{
    "matchers": [{"name": "job", "value": "api-gateway", "isRegex": false}],
    "startsAt": "2026-07-02T10:00:00Z",
    "endsAt": "2026-07-02T12:00:00Z",
    "comment": "Planned deployment",
    "createdBy": "oncall"
  }'
```

---

## See Also

- [Metrics & Dashboards](metrics.md) — creating custom metrics for alerts
- [PM2 Deployment](deployment-pm2.md) — production deployment
- [Troubleshooting](troubleshooting.md) — debugging alert issues
