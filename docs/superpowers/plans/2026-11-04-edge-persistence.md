# Edge persistent delivery and history

Implements bounded single-writer local spool, node-owned AMQP drain and receiver history/work API. No deployment or publication is performed.

## Delivery

Set COLLECTOR_SPOOL_DIR on a persistent volume and an explicit positive COLLECTOR_SPOOL_MAX_BYTES. Stream delivery `spooled` only supports AMQP recipients. The source continues after the observation is synced locally; stable eventId is assigned before persistence if absent. Queue records retain the destination descriptors and individual receipts independently of assignment lifetime. AMQP connections are reused, persistent mandatory publication and messageId are enforced. Sinks must resolve write only after broker confirmation. Corrupt committed files fail startup rather than silently losing data. Stop source before replacing the sole writer; use Recreate, not overlapping rolling pods for a shared spool directory.

The 72h target requires actual disk/traffic sizing; configured maxBytes is authoritative. Full capacity rejects new records, retains old ones and propagates an error. A lost confirm may repeat delivery. The receiver deduplicates.

## Local history API

Existing checkpoint server exposes authenticated `/v1/history/observations`, `/work`, `/context`, `/commit`, `/purge`. POST bodies include machine. Observations include eventId/channel/time (epoch milliseconds)/finite numeric value. First-write per machine/channel/time is atomic, as is scheduling classification work. Old out-of-history telemetry is accepted without scheduling classification. HISTORY_RETENTION_DAYS defaults30. Schedule purge through authenticated maintenance; pending work context and a pre-cutoff anchor per channel are retained.

Context includes original observations, existing segments, saved annotations, revision and range. Commit includes workId, segments and context:{from,until,paddingMs,revision}. Stale context returns409 and leaves work pending. Empty commit retires skipped work. A local transaction locks segment mutation during revision validation/write. Application adapter must honor cuts, annotations and no merging of old segments. Saved annotations remain separate; caller returns inherited labels only for applicable names. Existing same-name rows preserve manual fields; changed-name rows use the caller's applicable overlay.

## Validation

Run Node22 mocha test/application/runtime/testDeliveryQueue.js test/infrastructure/persistence/runtime/testDeliverySpool.js test/application/runtime/testStreamTask.js.
Run mocha test/integration/historyPgContainer.js with local Docker for transactional first-write, durable pending work, old history and concurrent manual edit checks.
