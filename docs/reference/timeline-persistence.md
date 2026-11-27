[Documentation](../README.md) / [Reference](README.md)

# Timeline persistence

The [Stream processing](../../stream-processing/README.md) classifies telemetry and publishes timeline segments. The state sink commits those results before RabbitMQ relays them. The following contracts describe split edits, batching and rejected deliveries.

## Split family

One `off` phase can be replaced by contiguous pieces. There is no parent row and no nested segment. Each piece is a normal `segments` row: `kind = phase`, `name = off`, at most one tag. An empty tag is SQL NULL. The family key is `properties.split_of`, the original start in epoch milliseconds. The first piece keeps that `start_time`, so the existing unique key `(machine, kind, start_time)` still identifies it.

A later edit sends the whole family again. `timeline.respond` / `PATCH /segments` take `{ splits: [{ start, end, tag, open }] }` addressed by the original start. For STOMP ingestion, the [state sink](../architecture/README.md#state-sink) accepts one envelope of type `split-family` containing `origin` in epoch milliseconds and the pieces. The sink deletes family starts the new cut does not use, then upserts the pieces, in one transaction.

The replacement must keep the original start and, for a closed off, the latest end of the stored family. Removing every piece but one therefore restores those bounds. `splits: []` is refused before any delete, and the stored family stays. A piece may be any positive length. Only the tail of a still-open off may have `duration = 0`. A duration-0 heartbeat does not extend a closed piece that already has `split_of`.

`C0007` grants `DELETE` on `segments` to `supervisor_sink` on the privileged admin path. The sink role does not run that grant itself. Central previously revoked this privilege (`C0002`).

Atomic `phase-transition` messages carry multiple segment pieces. A pending segment carrying `phase_revision` bypasses heartbeat coalescing, and persistence uses ordered revisions when resolving overlapping phase updates.

## Segment transaction batches

`supervisor-sink` can read a plant policy from `SEGMENTS_TX_POLICY_FILE` (JSON).
Without a policy or `SEGMENTS_TX_*` settings, existing deployments keep their current behaviour.
Environment values override every policy field, so a ConfigMap update and a Recreate restart
of the same image can tune persistence without an application release.

| Policy field | Environment override | Default when enabled | Meaning |
| --- | --- | --- | --- |
| `enabled` | `SEGMENTS_TX_ENABLED` | `true` | Explicit `false` disables batching and bypasses an obsolete policy path. |
| `maxMessages` | `SEGMENTS_TX_MAX_MESSAGES` | 32 | Original deliveries per transaction, capped by STOMP prefetch. |
| `maxBytes` | `SEGMENTS_TX_MAX_BYTES` | 1048576 | Batch payload byte target; a transport-valid oversized delivery runs alone. |
| `maxWaitMs` | `SEGMENTS_TX_MAX_WAIT_MS` | 100 | Age after which a partial batch becomes eligible to write. |
| `completedSegments` | `SEGMENTS_TX_COMPLETED_SEGMENTS` | 1 | Flush after this many distinct completed segment keys; `0` disables this trigger. |
| `concurrency` | `SEGMENTS_TX_CONCURRENCY` | 2 | Concurrent transactions for independent machines. |
| `timeoutMs` | `SEGMENTS_TX_TIMEOUT_MS` | 10000 | Bounds connection acquisition, statements and COMMIT for a transaction. |
| `statsIntervalMs` | `SEGMENTS_TX_STATS_INTERVAL_MS` | 10000 | Aggregate transaction log interval; `0` disables it. |

`SEGMENTS_DB_POOL_MAX` controls the owned pool (default 10); transaction concurrency must fit it.
`STOMP_PREFETCH`, `STOMP_MAX_MESSAGE_BYTES`, `STOMP_MAX_PENDING_BYTES`,
`STOMP_ACCEPT_TIMEOUT_MS` and `STOMP_STOP_TIMEOUT_MS` remain independently configurable.
The pending-byte lease remains held until actual commit or rejection. Prefetch, byte limits
and the partial-batch timer prevent waiting indefinitely for a long segment's end.

Each machine retains FIFO command order and every input command, including pending snapshots,
terminal transitions, retags and split families. This preserves orphan-close and continuation
side effects. Different machines can progress independently.
Every receipt is acknowledged only after its batch commits. A confirmed permanent row error
rolls the batch back and isolates commands into individual transactions. Uncertain COMMIT,
connection failure or timeout fences the subscription; RabbitMQ retains unacknowledged deliveries
for idempotent replay. WAL durability remains enabled.

`[segment-transactions]` JSON logs contain committed message/record counts, COMMIT and rollback
counts, SQL-call count, and maximum transaction/wait durations. They contain no payloads or tags.
Compare these counters with RabbitMQ ACK/drain rates and process memory when tuning. More messages
per batch reduce COMMIT frequency; the number of SQL writes still depends on command semantics.

## Ingest delivery and quarantine

`STOMP_PREFETCH` sets a positive, bounded segment delivery window (default 128).
`SEGMENTS_DEAD_LETTER_ENABLED=true` opts into rejecting malformed segment records
without requeue; transient persistence failures are retried. Enable this only with
a durable DLQ and routing policy. In the deployment DSL, configure
`profiles.<profile>.modules.message_bus.dead_letter.queue: scada.ingest.dlq`.
The scada chart declares the queue and applies an ingest-only dead-letter policy,
without changing existing queue arguments. The profile `env` is passed to both
site-server and supervisor-sink. DLQ records retain the original body and RabbitMQ
`x-death` metadata for inspection and deliberate replay; they are not auto-expired.

---

← [Edge telemetry and history](edge-history.md) · [Contributing](../contributing.md) →
