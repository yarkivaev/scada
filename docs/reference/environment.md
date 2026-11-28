[Documentation](../README.md) / [Reference](README.md)

# Environment variables

Configure supervisor-sink and siteServer with these variables. Collector settings are listed in the [runtime guide](../collect/runtime.md) and [edge controller reference](../collect/edge-controller.md).

| Variable | Purpose |
|----------|---------|
| `STOMP_URL` | RabbitMQ STOMP broker. |
| `STOMP_LOGIN`, `STOMP_PASSCODE`, `STOMP_HOST` | STOMP credentials and virtual host. Defaults are `guest`, `guest` and `/`. |
| `SEGMENTS_STOMP_DESTINATION` | STOMP segment consumer destination. Defaults to `/queue/scada.segments.ingest`. |
| `POSTGRES_URL` | Application DB user (`supervisor_sink`) |
| `POSTGRES_ADMIN_URL` | Admin user for apply-mode migrations; omit in verify mode |
| `SUPERVISOR_MIGRATIONS` | `apply` (default) or `verify`; other values fail startup |
| `SINK_DB_PROFILE` | `central` or `edge` |
| `SINK_PIPELINES` | `false` skips the STOMP segment, decision and alert consumers. A configured edge timeline relay and raw history receiver can still run. |
| `SEGMENT_REPAIR_HISTORY_ON_START` | `false` preserves closed historical boundaries at ingest startup. Omitted or `true` retains the existing same-name gap repair. Live ingest and silent-open handling remain active. |
| `HISTORY_REPLICA_AMQP_URL` | AMQP URL for an edge timeline outbox relay. Falls back to `HISTORY_AMQP_URL`. |
| `SEGMENT_REPLICA_WRITES` | Set to `true` on edge replica sinks. Central sinks accept replica writes by default. The segment consumer must be active. |
| `HISTORY_AMQP_ENABLED` | Set to `true` to start the edge PostgreSQL raw telemetry receiver. |
| `HISTORY_AMQP_URL` | AMQP URL for the raw telemetry receiver and fallback for the timeline relay. Only the raw telemetry receiver falls back further to `AMQP_URL`. |
| `HISTORY_AMQP_QUEUE` | Raw telemetry queue. Defaults to `scada.telemetry.history`. |
| `HISTORY_AMQP_BINDINGS` | Required JSON array of explicit topic binding patterns for the raw telemetry receiver. |
| `HISTORY_AMQP_PREFETCH` | Raw telemetry receiver prefetch. Defaults to `32`. |
| `HISTORY_RETENTION_DAYS` | Edge history retention window. Defaults to `30`. |
| `STATE_HTTP_PORT` / `STATE_HTTP_TOKEN` | Internal state API port and bearer token. Legacy aliases are `INTERNAL_API_PORT` and `INTERNAL_API_TOKEN`. The port defaults to `8081`. |
| `MQTT_URL`, `MQTT_TOPICS` | Optional metrics ingest |
| `CLICKHOUSE_URL` | Central metrics sink |
| `PORT` | Plant API port (siteServer, default 3000) |

---

← [CLI tools](cli.md) · [Helm values](helm-values.md) →
