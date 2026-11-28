[Documentation](../README.md) / [Data collection](README.md)

# Durable delivery

The collector can persist accepted data locally and replay each recipient independently after a restart.

## Stream transport lifecycle

The SCADA AMQP telemetry, MQTT relay and operation-sync pipelines use
`amqpSource`. It acknowledges after collector acceptance, requeues failures by
default, and avoids settling explicitly acknowledged or rejected deliveries twice.
Shutdown cancels consumption, drains accepted work and settlements, then closes
the channel and connection. Reconnect and restart wait for that drain.
`durableConsume` remains a compatibility facade over the shared AMQP session.
Collectors that batch records acknowledge acceptance into that collector; this is
not a guarantee that a later batch has already reached persistent storage.

`intervalSource` schedules operator-cache synchronization, stale-open-segment
sweeps, silent-stream reconciliation, PostgreSQL metric streams and the shared
ClickHouse stream hub. Polls do not overlap; metric streams await subscribers
before advancing their cursors. HTTP keepalive timers and domain coalescing
windows remain owned by their respective adapters and domain policies.

## Collector recovery and durable delivery references

Collector health opens before local spool recovery; `/live` remains responsive and `/ready` stays negative until recovery and a saved/initial assignment are applied. Cached assignments start without waiting for the first network reconciliation. `COLLECTOR_RECOVERY_TIMEOUT_MS` defaults to 900000 and bounds local initialization; exceeding it terminates startup for the external supervisor. Validate recovery duration against measured queue capacity before activation.

Spooled destination descriptors retain secret references. Draining a recovered queue resolves the current secret for each logical recipient, so credential rotation does not freeze a password in queued observations. Source connection credentials are still resolved at resource construction. Scheduler updates preserve a potentially working replica until another matching reader reports fresh progress, except explicit current-generation failure.

Central canonical ingestion propagates the receiver session ownership predicate through schema initialization and admission. It checks ownership again after authoritative state/clock reads and before writes; a lost session cannot allocate a newer revision from a delayed SELECT. Already submitted old-revision inserts remain safe under canonical winner ordering.


Collector delivery storage uses version 1 SQLite with WAL and synchronous FULL. The default delivery queue runs SQLite in a child process so database operations stay off the collector event loop. Acceptance and recipient acknowledgements return after commit. Event payloads are compressed; destination descriptors (including raw Secret references) are interned and retained until their last pending event is confirmed. Startup validates canonical counters and rebuilds a disposable disk-backed recipient replay index from event metadata; it does not decode every observation or build an in-memory backlog. Recovery therefore includes linear metadata IO and must be qualified at the configured capacity. Replay interleaves bounded indexed pages across immutable destination descriptors, so a large offline-only prefix cannot hide a healthy destination.

The reserved private `replay-index.sqlite` and its sidecars are disposable: every open rebuilds them under exclusive ownership, including after corruption or a rollback to an older runtime. They never provide acceptance or acknowledgement evidence; canonical format version 1 remains unchanged.

### Size the spool

`maxBytes` limits the logical UTF-8 JSON size of `{event, recipients, remaining}`; it does not describe disk allocation. `maxRecords` independently limits retained observations. SQLite pages, indexes and WAL require additional capacity planning. Canonical and replay page caches are each 2 MiB; automatic checkpoints run every 256 WAL pages and keep at most 1 MiB after checkpoint. A single large transaction may temporarily exceed that checkpoint target. Deleted pages are reused by later observations; database files retain their high-water allocation. Do not delete/vacuum an active spool to reclaim space.

### Upgrade and reopen the spool

Only one process may own a spool directory on a local filesystem with SQLite WAL/locking semantics. Stop an older JSON-based collector before upgrading; its writer does not participate in the new ownership lock. The spool directory must remain private to the collector. Call `close()` before reopening it elsewhere; a killed process releases its SQLite ownership lock automatically. Queue shutdown waits for accepted operations and its current drain before closing sessions and storage. Legacy committed SHA256-named JSON records import one at a time: commit and verify the exact event/receipts before unlinking and syncing the directory. An interrupted import reconciles on the next open; corrupt, ambiguous or over-limit files fail startup and remain recoverable. Unrelated files are untouched and symlinked committed records and symlinked/hard-linked SQLite main files or sidecars are rejected. Existing databases must match the versioned schema and contain valid counters; ambiguous state is rejected rather than repaired. Correct the underlying file/capacity problem before retrying recovery; never discard pending files to make readiness green.

Use `node --expose-gc scripts/measure-delivery-spool.mjs FIXTURE.json 120000` with actual adapter `{event,destinations}` samples to measure a target environment. The benchmark reports logical/compressed/page/index bytes, heap/RSS, recovery, append/drain and page reuse separately; its sink stand-in does not measure broker latency.


`legacyMigrationMaxBytes` is a separate positive safe-integer option on `deliverySpool()` / `deliveryQueue()`, defaulting to **16 MiB per committed legacy JSON file**. The queue-wide `maxBytes` may be many GiB; it does not increase this migration allocation budget. Recovery checks both limits from the open file descriptor before allocating or reading its body, including the post-commit verification read. A file exceeding either limit stops recovery and remains untouched. For a legitimate larger legacy record, raise `legacyMigrationMaxBytes` explicitly within the collector's available memory budget and retry; parsing, serialization and compression require additional memory beyond the read buffer. This option applies only to legacy JSON migration. Newly appended generic events and existing SQLite records keep their existing logical queue/record-cap semantics.

## Durable queue group commit

Collectors can opt into managed WAL checkpoints with `COLLECTOR_SPOOL_WAL_CHECKPOINT=managed`. Commits still use `synchronous=FULL`. After the WAL reaches 2 MiB, the spool schedules a passive checkpoint on its owning connection between transactions. It waits for up to 150 ms of idle time, with up to 2 seconds of deferral during sustained writes. At 8 MiB it attempts a truncate checkpoint before allowing another write. A single transaction can cross the limit. If a reader pins the WAL at that point, later writes retry checkpointing and fail while it stays pinned. Startup format and legacy imports keep their automatic checkpoint policy. The default collector mode uses SQLite's 256-page automatic checkpoint.

`deliverySpool.mutateMany(operations)` adds ordered append/receipt mutations to one WAL/FULL outer transaction. Entries are `{kind:'append', event, recipients}` or `{kind:'ack', eventId, recipient}`. The returned array contains `{ok:true}` or `{ok:false,error}` for each entry, and becomes available only after COMMIT. Validation, identity and capacity errors roll back that entry's savepoint; SQLite or COMMIT errors reject the entire call and fail the spool closed. Existing `append()` and `ack()` still perform immediate durable single-operation calls. Format version 1 and legacy recovery are unchanged.

`deliveryQueue()` accumulates frozen operations before its database serialization barrier. Defaults are `groupCommit: {maxRecords:64, maxBytes:1048576, maxDelayMs:25}`, `maxOperations:128` and `maxPendingBytes:4194304`. Limits must be positive safe integers; the delay may be zero and cannot exceed the platform timer range. Every submitted operation must fit both byte limits. Increase these explicit options within the process memory budget for larger generic envelopes. A full operation window waits for a released slot before snapshot construction; oversized serialized inputs are still rejected before decoding their queue snapshot. Count and bytes remain reserved through the actual grouped operation, including an in-flight commit, even if an upstream caller stops waiting.

No observation is merged, sampled or discarded by batching. An `accept()` promise succeeds only after durable commit. A sparse group flushes on its timer; capacity thresholds, reads and close force earlier flushing. The delay bounds the coalescing window, not disk latency or end-to-end completion. Queue status retains durable `pending`/`bytes` and adds `queuedOperations`, `queuedBytes` and `drainFull` diagnostics.

The positive safe-integer `maxInFlight` option defaults to 32. A drain initiates at most that many publications concurrently, in stored order per logical AMQP session. All concurrent writers await the same session opening; one mandatory return does not retire independent confirms. Receipt admission and serialized publication bytes are reserved before network publication, then the receipt is queued only after its individual mandatory confirmation. The retained publication bytes count toward `maxPendingBytes`, separately from receipt mutation bytes counted toward the group byte limit. Confirmed receipts accumulate in a bounded window; `drain()` counts them delivered only after their FULL commit. Graceful close rejects new source submissions, flushes existing submissions, waits for the active drain and its receipts, then closes sessions and persistence. Caller write deadlines abort the actual AMQP writer and retire its session. A caller timeout alone does not release a publication slot or its prospective ACK reservation; late actual success still commits its receipt, and late callbacks from an aborted AMQP generation cannot ACK a retry. The 64-entry session pool reuses least-recently-used fully settled idle sessions, including after descriptor or credential-reference rotation; active or reserved sessions are never evicted. A custom factory that ignores both AbortSignal and stop remains fenced and bounded until actual settlement. Close fails after its bounded session wait and retains spool ownership if that work cannot quiesce; retry close after settlement. The existing crash-after-confirm/before-local-receipt replay contract remains unchanged.

Healthy full drain pages with durable progress continue on subsequent event-loop turns; after four pages the scheduler pauses 25 ms. Pages with healthy durable progress continue even if a different recipient failed. A failed immutable destination descriptor has a 10-second monotonic retry cooldown (`failureCooldownMs`, nonnegative safe integer, default 10000; zero disables), tracked in a bounded 128-entry map; other destinations remain eligible. Empty or zero-progress pages back off for one second. This removes the former 100-event/s scheduling ceiling without spinning on an offline recipient. Actual append and online catch-up throughput still require qualification on the target filesystem; a serial producer awaiting every individual acceptance cannot benefit from concurrent group formation.

---

← [Edge assignment controller](edge-controller.md) · [Stream adapters](../../src/infrastructure/streams/README.md) →
