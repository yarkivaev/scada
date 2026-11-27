[Documentation](../README.md) / [Reference](README.md)

# Environment variables

Configure supervisor-sink and siteServer with these variables. Collector settings are listed in the [runtime guide](../collect/runtime.md) and [edge controller reference](../collect/edge-controller.md).

| Variable | Purpose |
|----------|---------|
| `STOMP_URL` | RabbitMQ STOMP broker |
| `POSTGRES_URL` | Application DB user (`supervisor_sink`) |
| `POSTGRES_ADMIN_URL` | Admin user for apply-mode migrations; omit in verify mode |
| `SUPERVISOR_MIGRATIONS` | `apply` (default) or `verify`; other values fail startup |
| `SINK_DB_PROFILE` | `central` or `edge` |
| `SINK_PIPELINES` | `false` skips STOMP segment, decision, and alert consumers. The site container sets this and a `supervisor-sink` container keeps the default |
| `SEGMENT_REPAIR_HISTORY_ON_START` | `false` preserves closed historical boundaries at ingest startup. Omitted or `true` retains the existing same-name gap repair. Live ingest and silent-open handling remain active. |
| `STATE_HTTP_PORT` / `STATE_HTTP_TOKEN` | Edge internal API |
| `MQTT_URL`, `MQTT_TOPICS` | Optional metrics ingest |
| `CLICKHOUSE_URL` | Central metrics sink |
| `PORT` | Plant API port (siteServer, default 3000) |

---

← [CLI tools](cli.md) · [Helm values](helm-values.md) →
