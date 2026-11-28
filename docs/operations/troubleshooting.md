[Documentation](../README.md) / [Operations](README.md)

# Troubleshooting

Use the symptom and recovery steps to locate the component that needs attention.

| Symptom | Check |
| --- | --- |
| Supervisor-sink stops before it opens HTTP | Check profile, migration records and runtime grants. See [database migrations](database-migrations.md). |
| Collector readiness stays negative during startup | Check saved assignment and spool recovery. See [durable delivery](../collect/durable-delivery.md#collector-recovery-and-durable-delivery-references). |
| Edge assignment changes stop while existing collection continues | Check etcd quorum and per-node credentials. See [edge assignment controller](../collect/edge-controller.md). |
| Density-sensitive telemetry reads return `SCADA_HISTORY_DENSITY_UNAVAILABLE` | Check whether the range includes sealed compacted history. See [central telemetry](../reference/central-telemetry.md). |
| Committed timeline changes lag on a replica | Check the authority relay logs for `history_replica_outbox`, the durable RabbitMQ bindings and the replica consumer. See [replication v2](../reference/edge-history.md#delivering-committed-segments-to-replicas). |
| Segment deliveries retry or enter a dead-letter queue | Check transaction failures and the configured quarantine policy. See [timeline persistence](../reference/timeline-persistence.md). |

## Collector starts but stays unready

Use the collector's configured health address. These commands use the defaults from the [manifest example](../collect/runtime.md#run-from-a-manifest).

```sh
curl -i http://127.0.0.1:8082/live
curl -i http://127.0.0.1:8082/ready
curl --fail http://127.0.0.1:8082/status
```

- If liveness returns HTTP 200 and readiness returns 503, inspect startup logs for spool recovery and assignment errors. The health server opens before spool recovery finishes.
- If tasks are present but degraded, check the associated device and broker connections. Compare the task health with the broker diagnostics.
- If liveness returns 503 after a fatal delivery error, let the process supervisor replace the executor. Preserve its persistent assignment and spool data.

## MQTT publisher recovery

An unexpected MQTT publisher close/offline/error retires the session and notifies `onFatal` once. Intentional `stop()` does not notify failure. Modbus runtime tasks propagate publisher failure to collector `/ready` and `/live` (503). Run the collector under its liveness supervisor: it must retire the failed executor and create a fresh one, which reconnects after the broker returns. Uncertain publications are not automatically replayed. Broker restart regression covers failed health, old poll cleanup, and confirmed fresh measurements from the replacement executor.

## Central backup freshness

AMQP telemetry tracks `<source-family>/<device>` freshness identities independently. Samples from one source family cannot hide missing samples from another. Measurement topic paths are unchanged. Custom freshness callbacks must pass the source’s full identity to `seen()`.

---

← [Upgrades and adoption](upgrades.md) · [Reference](../reference/README.md) →
