[Documentation](../README.md) / [Data collection](README.md)

# Collector delivery queue

The collector keeps observations in a bounded in-memory queue for assignments using `delivery: spooled`. The queue lives at node scope and can retry a publication after the source assignment changes. It loses pending observations when the collector process exits. The broker owns persistence after successful AMQP confirmation.

## Size the spool

| Setting | Default |
| --- | --- |
| `COLLECTOR_QUEUE_MAX_BYTES` | 16777216 |
| `COLLECTOR_QUEUE_MAX_RECORDS` | 4096 |

Both values must be positive safe integers. The byte limit measures the UTF-8 serialized queue records. Indexes, serialization, replay pages, source buffers, and active publications also need memory, so leave headroom under the process or container limit.

When a new event would exceed either limit, the queue evicts the oldest admissions until it fits. Replay order does not affect eviction order. An event that cannot fit by itself fails admission and leaves existing events in the queue. Transient command and publication capacity have separate bounds. Requests beyond transient admission capacity fail promptly.

Existing on-disk queues are left in place during an upgrade. The new process starts with an empty queue. Drain or preserve any legacy backlog before switching if those events are still needed.

## Delivery and confirmations

The runner freezes observation and destination descriptors on admission. A source call succeeds when the observation is in memory. A successful AMQP publication removes its recipient from that record. Remaining recipients keep their own retry state. Publication uses persistent messages, mandatory routing, and a stable message ID. Keep consumer handling idempotent because delivery can succeed before the sender receives its confirmation.

A failed destination enters a short cooldown so healthy destinations can continue. A confirmation for an evicted admission cannot acknowledge a newer admission of the same event ID. Publications already in flight can settle after eviction. Graceful shutdown waits for current publications and clears the remaining queue.

The collector status endpoint reports pending records, logical bytes, limits, and dropped record and byte counters. A configured `STATE_HTTP_TOKEN` enables the history surface, which can see only currently retained observations.

## Supply another store

Call `runCollector({ ...options, deliveryStore })` to replace the queue store. The store implements `open()`, `mutateMany(operations)`, `pendingFair(limit, blockedTargets)`, `peek(limit)`, `status()`, and `close()`. Mutations are ordered append and receipt operations with one `{ok:true}` or `{ok:false,error}` result per input. Return rows with `event`, `remaining`, and `targets` keyed by recipient ID. A store that evicts records supplies an admission token on replay rows, checks it on acknowledgements, and can implement synchronous `hasAdmission(eventId, admission, recipient)` to skip a row evicted after selection.

[Edge assignment controller](edge-controller.md) · [Stream adapters](../../src/infrastructure/streams/README.md)
