[Documentation](../README.md) / [Reference](README.md)

# Edge telemetry and history

The edge receiver persists raw AMQP telemetry and triggers history processing. The history port also supports external raw observations.

## Durable local telemetry receivers

Set `HISTORY_AMQP_ENABLED=true` on each edge receiver application, with `HISTORY_AMQP_URL` (or `AMQP_URL`), `HISTORY_AMQP_QUEUE` (default `scada.telemetry.history`) and mandatory explicit JSON `HISTORY_AMQP_BINDINGS`. The node-owned PostgreSQL receiver starts after migrations even when movable collector pipelines are external. It consumes persistent AMQP telemetry independently of expiring MQTT sessions, and acknowledges each message only after the PostgreSQL metrics insert and history trigger transaction finish. Automatic MQTT-to-PG ingestion is disabled in this opt-in mode; live supervisor MQTT classification is independent. Payloads must carry their original integer millisecond `ts` and finite numeric `value`; malformed messages do not receive successful acknowledgement.

Producer AMQP descriptors supply `options.queues` and `options.bindings` alongside `options.exchanges`. These are asserted before publishing becomes active, so a receiver that has never connected still has its durable queue. Local history queue declarations use durable true and autoDelete false, with no TTL/overflow discard. A different matching queue, such as a central outbox, is insufficient proof of local delivery. The DSL emits intended local queues/bindings on each recipient descriptor. Grouped Modbus RTU tasks can filter recipient descriptors by `routingKeyPrefix`, so each destination receives its own measurements directly; no matching recipient is an explicit failure, never silent loss.

## Raw telemetry first choice

The local history AMQP receiver enables atomic first-write-wins receipts for `(topic, ts)` before topic registration. Generic `amqp-pg-metrics` and `mqtt-pg-metrics` assignments opt in with `firstWins: true`; default ingestion behavior is unchanged. Receipts, raw metrics and history-trigger work commit together before acknowledgement. Existing raw rows are preserved when enabling the policy; a legacy timestamp with multiple conflicting rows cannot recover which value originally arrived first. Apply edge migrations E0007 and privileged E0008 before enabling the policy. Retention deletes a receipt only beyond the configured history window (at least 30 days without mappings) and once its raw metric is gone; size persistent storage accordingly.

Placement-policy edits retain the existing reader on an ineligible or retiring node until the full desired count of eligible replacements confirms current-generation, matching-spec reads. Starting a replacement alone does not revoke the old reader. Explicit task deletion still revokes it. Rolling edits of replicated tasks preserve their only healthy reader and update a failed replica first when available; one-copy resource-pinned tasks require an in-place restart for configuration changes.

Historical correction contexts use at most 250 complete raw timestamp groups per page. Edge migration E0009 adds the durable work cursor and dependency end. A page commit checks the work token, cursor and context revision, writes its bounded correction, and atomically advances the cursor with a new token; only the final page retires the work. A lost response is recovered by polling the durable cursor. New observations reset the affected claim so a restarted worker recalculates from complete stored parameter and prior-segment seeds. Pending work protects the dependency envelope and predecessor anchors from retention. Original annotation extents survive partial pages, with current operator metadata authoritative.

Pair E0009 with a supervisor that supports continuation cursors and bounded overlays. Stop old history workers before enabling the upgraded mode, then start compatible workers. The API rejects segments extending beyond their page. Oversized timestamp groups or more than 10000 annotations in a page cause capacity errors. Long histories within these per-page bounds continue through durable pages.

Each continuation also re-evaluates its original parameter dependency and existing segment boundary. Its finite envelope can grow to include already stored observations or a live correction that overtook the historical work, so a historical page cannot erase an already-processed live tail and then retire prematurely. Envelope growth follows stored dependency evidence rather than wall-clock time; each page retains the same bounded read limits.

## Delivering committed segments to replicas

Replicated historical corrections use `POST /v1/history/commit-outbox-v2`. Fenced live writes for the same timeline use `POST /v1/history/live-apply-outbox`. The authority captures final row images and deletions in the same PostgreSQL transaction as the segment changes, write receipt, and work cursor. Staged corrections publish when the final projection is written.

The relay sends persistent AMQP messages in commit order per machine and removes them after a publisher confirm. Unroutable messages remain pending. A repeat carries the same output ID. The replica also stores the last applied position per segment key and authority database, including after deletion. This lets out-of-order deliveries converge for a single authoritative timeline even when a newer live write touches the same key. This order applies to fenced commits on the authority. Legacy direct edits and maintenance writes have their own delivery and persistence paths. Delete positions remain stored after the segment disappears so delayed deliveries cannot recreate it.

Configure `HISTORY_REPLICA_AMQP_URL` or `HISTORY_AMQP_URL` for each authority. Apply migrations V0016/V0017 on segment recipients and E0021–E0024 on edge receivers before enabling v2 commits. The segment exchange needs a durable bound queue for each replication path. Each replica needs an active segment consumer. Central sinks accept replica writes by default. For an edge replica, set `SEGMENT_REPLICA_WRITES=true`. See [environment variables](environment.md). Upgrade every replica reader first, including central consumers. Stop the v1 live and history writers for the machine, then drain the authority's SQL outbox and all v1 broker queues and in-flight deliveries before starting the v2 receiver and workers together. The v1 endpoint and already queued v1 messages keep their existing format.

## External raw observations and stateful corrections

`historyPg` is a public state port. With `observations(connection)` it reads measurements from an external raw store while retaining transactional PostgreSQL work, segment and annotation state. The observation source implements bounded boundary/page/read/seed access and registration. `timeScale:1000` plus an exact timestamp parser preserves ClickHouse microseconds; ordinary PostgreSQL history keeps millisecond coordinates.

External ingestion must call `prepare(records)` before the synchronous raw write, then `complete(records)` before broker ACK. E0010 records temporary deterministic admission barriers without numeric payloads; no timeout silently discards them. E0011 records classifier identities/checkpoints and machine source/coordinate identity. Pending admissions fence reads and commits. Rebatched retries resolve the same intents; a late point invalidates affected checkpoints and rewinds already processed claims. This is a restart protocol rather than a distributed database transaction.

Stateful external classifiers use public `historyProtocol = stateful-correction-v1`. Configuration returns the same protocol and explicit time scale. Work/context/commit include classifier identity and exact durable claim. E0013 stages computed rows/checkpoints per work generation until finite completion or verified state convergence; finalization atomically applies the correction, re-reads current operator cuts/labels and advances work. Public checkpoints only describe applied timelines. Latest user edits survive long paginated replay, and page boundaries do not become segment cuts. E0012/E0014 grants are administrator-only. Generic PostgreSQL history remains supported and does not claim stateful correction capability.

The plant application’s deployment DSL supplies ClickHouse source and receiver wiring and coordinates retention. An autonomous raw TTL cannot preserve pending replay dependencies: the coordinator must protect work, admissions and predecessor state before deleting raw rows. The legacy raw PostgreSQL receiver refuses `TELEMETRY_BACKEND=clickhouse` to prevent a competing acknowledgement path.

E0015 freezes the admission clock and persists a per-backend retained raw-history floor; E0016 grants its small coordination table. The companion retention coordinator publishes this monotone floor before any independent raw deletion, and every later registration/context/admission must respect it. Unseeded stateful work defers pruning entirely. This preserves safety after the original PostgreSQL session is lost; a previously authorized mutation may finish, while new cleanup still requires durable coordination. Registered valid claims remain eligible across an outage even before their first page. Stateful contexts pin a finite generation envelope, append-only points queue separate work, and staged publication also preserves the operator decision's consumed flag. No permanent per-point state is added.

## Bounded native history commits

At a class change, live rule-based classification can close the preceding phase
at the next phase's first sample. Native historical replay closes the preceding
phase at its last contributing sample. Both use the new phase's first sample as
its start. Historical sample coverage therefore preserves its bounds and avoids
assigning the transition sample to both phases.

Native history receivers advertise `nativeTailProtocol: preserve-known-suffix-v1`
on configuration. Workers must negotiate this before starting. A computed
terminal anchor must not clip an existing segment whose known end lies beyond
the observed page. An unchanged exterior anchor can be omitted entirely.

An exterior row requires `context.nativeTailMode` with that protocol and a
`preserveSuffix` object identifying a current segment by `kind`, `name`,
`start_time`, and `end_time`. Under the existing context revision lock, the
receiver checks its class, extent and current ownership. Archive-only rows
cannot justify exterior changes. Changing a current segment inside the page
must retain any unobserved suffix, potentially as a piece starting one
millisecond after the page end; unseen cut collisions fail atomically.
Conservative page-boundary cuts remain protected, so a paged transition can
leave additional adjacent same-class pieces. No new exterior observations or
classes are inferred. A rejected commit leaves both projection and work intact.

Applicable children carry operator metadata and `consumed`; existing rows keep
their stored consumed state. This native protocol is separate from the staged
stateful correction protocol used with external raw observation stores.

Optional startup overlap repair uses the explicit array of machine IDs in
`SEGMENT_PHASE_REPAIR_MACHINES` or the `phaseRepairMachines` pipeline option.
Tracks configured with contiguous phase anchors keep authority over their
timelines. With an empty selection the overlap repair performs no writes.

---

← [Central telemetry](central-telemetry.md) · [Timeline persistence](timeline-persistence.md) →
