# Stream processing

The stream processor turns readings into timeline segments. It runs the
configured segmentation and tagging rules through Stream Worker and resumes
from checkpoints. The state sink applies timeline outputs in PostgreSQL and
checks the current owner and timeline revision. With replication v2, fenced
live writes and historical corrections share a PostgreSQL outbox. The relay
publishes committed changes and deletions to RabbitMQ. See the [SCADA architecture](../docs/architecture/README.md).

## Build and run

Use JDK 21. From this directory, run:

```sh
./resolve-dependencies.sh
sbt test assembly
CLASSIFY_GROUP=machine-1 java -jar target/scala-3.5.2/scada-stream-processing.jar --check application.conf
```

The HOCON file supplies machine IDs, segment rules, tag rules, source aliases,
broker endpoints and the checkpoint API used for timeline output. `CLASSIFY_GROUP` selects the
machine IDs owned by the process. An unset or empty group starts no machine streams.
`--check` validates configuration without starting the runtime.
`--capabilities` reports the history protocols supported by the entry point.

## Example configuration

Save this live-mode example as `application.conf`. Adjust the broker endpoints,
aliases and state API for your site. The validation command above runs without
opening network connections.

```hocon
mqtt {
  host = "127.0.0.1"
  port = 1883
  client-id = "scada-machine-1"
}
rabbitmq {
  address { host = "127.0.0.1", port = 61613 }
  vhost = "/"
  credentials { login = ${?STOMP_LOGIN}, passcode = ${?STOMP_PASSCODE} }
  destinations {
    user-decisions = "/exchange/scada.user_decisions"
    segments = "/exchange/scada.segments"
  }
}
checkpoint-api {
  base-url = "http://127.0.0.1:8081"
  token = ${?STATE_HTTP_TOKEN}
}
routing.aliases.machine-1 = [{ topic = "equipment/machine-1/power", metric = "power" }]
machines = [{
  id = "machine-1"
  window = 15
  segments = [
    { name = "on", condition.above { param = "power", threshold = 5 } },
    { name = "off", condition.below { param = "power", threshold = 5 } }
  ]
}]
```

Set `STOMP_LOGIN` and `STOMP_PASSCODE` before validating or starting the example.
With the dependencies running, start the same command without `--check`.

## Processing and recovery

| Mode | Input and recovery |
| --- | --- |
| Live rule-based classification | MQTT readings with optional checkpoint replay. The runtime can restore a pending segment before consuming live readings. |
| Local history mode | Rule-based AMQP classification with event-time cursors. Configure the checkpoint API, a positive writer epoch and a PostgreSQL writer lease. |
| Plant-specific processing | A `RuntimeProfile` supplies a live processor or historical worker and its configuration and event policies. |

Enable local history with `history.enabled = true` or `SUPERVISOR_LOCAL_HISTORY=true`.
Set `checkpoint-api.base-url` to use the history path. Set
`history.writer-epoch` or `SUPERVISOR_WRITER_EPOCH` and
`history.lease-url` or `SUPERVISOR_LEASE_URL`. The HOCON setting takes
precedence over the corresponding environment value. Deployments can set
`SUPERVISOR_LEASE_URL_HELD` in place of `SUPERVISOR_LEASE_URL` to provide
the URL while keeping machine processing paused during handoff. Set
`history.role` or `SUPERVISOR_WRITER_ROLE` to `leader` or `standby` when
the deployment explicitly manages those roles.

When local history and a RabbitMQ segment destination are configured, the worker uses the v2 outbox commit routes for replicated writes. Enable the relay on the state sink and prepare its replica consumers before starting this mode.

The shared classifier supports `preserve-known-suffix-v1` for bounded history.
A profile with a stateful worker can also advertise `stateful-correction-v1`.
Match the classifier capabilities to the state API and migrations before
upgrading. See [edge telemetry and history](../docs/reference/edge-history.md)
and [timeline persistence](../docs/reference/timeline-persistence.md).

For standby readiness, shared writer leases and commit guarantees, see [High availability](../docs/architecture/high-availability.md#replicated-stream-processing-and-history-workers).

## Extend for a plant

A plant application creates `ProcessingApplication` with its `RuntimeProfile`.
The profile can load a plant-specific machine mode, select a live stream or
history worker, and define segment annotation and publication policies.
The engine supplies the shared execution, writer leases and transport.

A plant build pins the SCADA npm package and compiles its processing sources
with the plant profile. The package includes the exact JARs pinned by version
and SHA-256 in the two lock files. Both libraries publish independently.
[Stream Worker](https://github.com/yarkivaev/stream-worker)
[Timeline Segmentation](https://github.com/yarkivaev/timeline-segmentation)

## Stream processing modules

| Module | Responsibility |
| --- | --- |
| `io.yarkivaev.streamworker.Processor` | Computes the next state and ordered outputs from configuration, state and one event. All time used by a processor comes from the input. |
| `io.yarkivaev.streamworker.StreamWorker` | Reads an ordered source supplied by the caller, atomically saves the position, state and pending outputs, and retries unconfirmed outputs on restart. |
| `io.yarkivaev.segmentation` | Evaluates segment and tag rules and computes interval transitions. Live and history adapters pass their input and boundary policy to the library. |
| `HistoryInput` | Feeds an ordered history page from RabbitMQ to the same Stream Worker entry point. |

Durable source adapters assign stable positions to records and combine upstream
streams into a reproducible order before passing them to the worker. Timer
expiration and end of input can be explicit events. An
output has the same ID when retried. MQTT sessions restore from the existing
timeline checkpoint. The broker supplies no persistent input position for this
source.

`PgCheckpointStore` preserves the checkpoint and pending outputs when a
coordinator supplies a higher ownership token. Set
`SCADA_STREAM_WORKER_TEST_JDBC` to a local test database and apply
`db/migrations/E0018__stream_worker_checkpoint.sql` to run its integration
test with `sbt 'testOnly *ClassifyCheckpointSpec'`. The generic store has its own integration test in the Stream Worker repository. A stopped worker can
resume after an explicit state migration to a new rules version.

## Recalculate history

The archive adapter prepares a bounded page and its initial state. It sends
positioned batches to a RabbitMQ queue scoped to that page. An end marker
completes the input. Stream Worker invokes the configured processor for each
sample. The processor receives its time and state as input.

The history work claim remains outstanding until the state API accepts the
result against its original context revision. If the worker or broker fails
mid-page, the adapter fetches the outstanding claim and submits the page again.
Committed pages, checkpoints and operator changes remain durable at the state
API. The per-page RabbitMQ queue is transient.

The AMQP classifier already receives readings from RabbitMQ. Its stateful
processor computes both current and late classifications from that input.
Before preparing a write, it reads the timeline revision and, under a lease,
refreshes the stored segments in the affected range. Its pending output keeps
the prepared wire messages and expected revision across a restart. An
explicit revision conflict makes the next attempt read the range again.
