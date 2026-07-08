# @brdrwanda/observability — Documentation

## Getting Started

| Guide | Description | Audience |
|-------|-------------|----------|
| [Quick Start](getting-started.md) | Install, wire, verify in 10 minutes | New developers |
| [Configuration Reference](configuration.md) | Every config option with defaults and examples | All developers |
| [Standalone Mode](standalone.md) | Express, Fastify, plain Node.js — no NestJS needed | Non-NestJS developers |

## Guides

| Guide | Description | Audience |
|-------|-------------|----------|
| [Structured Logging](logging.md) | Auto-request logging, business events, Loki queries, redaction | All developers |
| [Distributed Tracing](tracing.md) | Trace setup, sampling, custom spans, cross-service correlation | All developers |
| [Metrics & Dashboards](metrics.md) | Auto HTTP metrics, custom counters/histograms, Grafana PromQL | All developers |
| [Error Handling](error-handling.md) | Auto error classification, logCaughtError, process handlers | All developers |
| [Instrumentations](instrumentations.md) | Redis, MySQL, PostgreSQL, Sequelize, Kafka setup and spans | All developers |
| [Alerting & Monitoring](alerting.md) | Prometheus rules, Alertmanager, Teams/Slack notifications | DevOps, SREs |

## Migration

| Guide | Description | Audience |
|-------|-------------|----------|
| [Migration Guide](migration.md) | Step-by-step migration from Winston/LoggerService | Migrating developers |
| [Integration Checklist](migration-per-service.md) | Step-by-step SDK integration with verification steps | Migrating developers |

## Deployment & Operations

| Guide | Description | Audience |
|-------|-------------|----------|
| [PM2 Deployment](deployment-pm2.md) | PM2 ecosystem config, log collection, Promtail setup | DevOps, SREs |
| [SDK Publishing](sdk-deployment.md) | Build, version, publish the SDK package | Maintainers |

## Architecture

| Guide | Description | Audience |
|-------|-------------|----------|
| [How It Works](architecture.md) | SDK structure, dependency strategy, design decisions | Tech leads, architects |
| [Architecture Decisions](architecture-decisions.md) | Why the SDK exists and key technical choices | Tech leads, new members |
| [SDK Internals](sdk-explained.md) | Deep dive into every module and file | Contributors |

## Reference

| Guide | Description | Audience |
|-------|-------------|----------|
| [Troubleshooting & FAQ](troubleshooting.md) | Common issues, diagnostics, frequently asked questions | All developers |
| [Testing](testing.md) | Mocking SDK providers, suppressing logs, e2e testing | All developers |
| [Changelog](CHANGELOG.md) | Version history and release notes | All developers |

## Quick Links

- **Install**: `npm install @brdrwanda/observability`
- **GitHub**: [brdbank/observability-sdk](https://github.com/brdbank/observability-sdk)
- **SDK README**: [packages/sdk/README.md](../packages/sdk/README.md)
