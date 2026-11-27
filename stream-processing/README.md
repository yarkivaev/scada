# Stream processing

The stream processor turns readings into timeline segments. It runs the
configured segmentation and tagging rules through Stream Worker and resumes
from checkpoints. The state sink applies timeline outputs in PostgreSQL and
checks the current owner and timeline revision. RabbitMQ relays committed
outputs to other receivers. See the [SCADA architecture](../docs/architecture/README.md).

## Build and run

Use JDK 21. From this directory, run:

```sh
./resolve-dependencies.sh
sbt test assembly
java -jar target/scala-3.5.2/scada-stream-processing.jar --check /path/to/application.conf
CLASSIFY_GROUP=machine-1 java -jar target/scala-3.5.2/scada-stream-processing.jar /path/to/application.conf
```

The HOCON file supplies machine IDs, segment rules, tag rules, source aliases,
broker endpoints and the checkpoint API used for timeline output. `CLASSIFY_GROUP` selects the
machine IDs owned by the process. An unset or empty group starts no machine streams.
`--check` validates configuration without starting the runtime.
`--capabilities` reports the history protocols supported by the entry point.

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
The engine supplies the shared execution, replay, writer leases, and transport.

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
| `scada.stream.replay.Replay` | Recalculates a fixed input snapshot and returns a proposal tied to a timeline revision. It can process sections in parallel where compatible starting states exist, then verifies the states at each boundary. |

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
resume after an explicit state migration to a new rules version. The
processor works on a supplied sequence. Historical jobs read and stage a
snapshot outside the worker, then run it through Replay and submit the result
with the snapshot's original context revision.
