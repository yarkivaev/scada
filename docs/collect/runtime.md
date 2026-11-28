[Documentation](../README.md) / [Data collection](README.md)

# Collector runtime

Run collector assignments in one process using a manifest or the edge assignment controller.

## Run from a manifest

Create `manifest.json`. Start with an empty assignment list to check that the process can start and report readiness. Add assignments for your sources once the health check succeeds.

```json
{
  "assignments": []
}
```

```sh
COLLECTOR_HEALTH_PORT=8082 npx scada-collector manifest.json
```

From another terminal, check readiness and inspect the process status.

```sh
curl --fail http://127.0.0.1:8082/ready
curl --fail http://127.0.0.1:8082/status
```

The readiness request returns `{"ready":true}` after the collector applies the manifest. An empty task list in the status response confirms that the process has started without claiming any sources.

Use `scada-collector -` to read a manifest from stdin. The collector also accepts inline JSON in `COLLECTOR_MANIFEST` and a filename in `COLLECTOR_MANIFEST_PATH`. Send SIGHUP to reconcile a file-based manifest. SIGTERM and SIGINT trigger bounded shutdown.

Each instance has the same adapter registry. Assignments select the work it runs. For dynamic placement across collector hosts, configure the [edge assignment controller](edge-controller.md). HTTP handlers and their process-local read models stay in the site process. Set `COLLECTOR_MODE=external` on that process before assigning its transferable collection tasks elsewhere.

## Embed the collector runtime

```js
import { createRegistry, createRuntime } from '@yarkivaev/scada/runtime';
const runtime = createRuntime({ registry: createRegistry() });
await runtime.apply({ taskId: 'line-reader', generation: 1, specVersion: 1,
  spec: { adapter: 'modbus', url: 'mqtt://broker', config: {
    addresses: ['tcp://127.0.0.1:502'], streams: [], maps: [], interval: 5
  } } });
await runtime.remove({ taskId: 'line-reader', generation: 2 });
await runtime.stop();
```

## Adapters

Adapters include `stream` (registered source/transform/sinks), `modbus`,
`activity`, `amqp-relay`, `amqp-metrics`, `mqtt-metrics`, `operation-sync`,
`amqp-pg-metrics`, `mqtt-pg-metrics`, `silent-streams` and `stomp-ingest`. Plant packages extend the
registry with domain-specific adapters; OPC UA belongs here, not in
source-to-sink. Constructors do not open connections. A task owns independent
connections and must close them in `stop()`. Factories are trusted code, not
arbitrary scripts supplied in manifests.

## Assignment lifecycle

Assignments have stable task IDs, externally supplied integer generations and
`specVersion: 1`. An optional `specHash` is checked against canonical JSON.
Identical repeats are idempotent; conflicting/stale generations are rejected.
Replacement waits for the previous owner to stop. Removed IDs retain bounded
in-memory tombstones. Cleanup timeout quarantines resources and marks the
runtime fatal; it never authorizes a second owner. Generation and PostgreSQL CAS
are local/conflict safeguards, **not distributed fencing**. The external agent
must establish cross-node ownership and provide current assignments after restart.

## Credentials, health and capacity

Secrets can be references such as `{ "$secret": "AMQP_URL" }`, resolved by the
host immediately before adapter construction. Status excludes configuration and
exception messages. Optional `COLLECTOR_HEALTH_PORT` and
`COLLECTOR_HEALTH_HOST` (default `127.0.0.1`) expose read-only `/live`, `/ready`
and `/status`. Readiness rejects failed or degraded tasks as well as runtime
shutdown. Fatal cleanup or an uncertain MQTT acceptance/write timeout makes
liveness fail; configure an external restart policy. Transient MQTT errors mark
the task degraded until broker reconnect; terminal timeouts require a fresh
executor after the old process drains its IO. A blocked event loop cannot answer
an external probe. Set `COLLECTOR_STARTUP_PORT` to expose `/startup` on a
separate listener using the same host. It opens after local recovery and tracks
fatal errors and shutdown independently of task readiness or control quorum.
Synchronous infinite loops and native crashes still affect the
entire process. No hard CPU or native-memory isolation is claimed.

The process defaults to 16 MiB / 16,384 buffered records, each task to 1 MiB /
1,024, with bounded control admission and start/stop deadlines. Adapter-owned
buffers and actual sink promises reserve capacity; driver/internal allocations
and transient JSON decoding are not a hard RSS limit. Configure capacities for
all simultaneously retained pipeline stages. MQTT and Loki collectors flush
individual accepted records because their source delivery is sequential;
AMQP pipelines retain bounded timed batching. Timeout is not proof that a remote
side effect did not happen.

## Durable stream contract

`stream` requires explicit `delivery: "live" | "durable"`. Durable streams need
`stateVersion`, `compatibilityKey`, stable `eventId` and a shared state store.
Durable payloads and checkpoints use JSON; encode binary explicitly as strings.
They persist an outbox and each recipient acknowledgement before advancing the
checkpoint. MQTT requires QoS 1/2; AMQP sets persistent/mandatory publication and
checks returned messages. Broker confirmation does not prove downstream business
processing. An uncertain send can repeat with the same event ID; receivers must
deduplicate. Sources with a non-null checkpoint must implement `restore()`;
unsupported restoration fails closed. Live telemetry cannot replay downtime.
Loki fails a saturated page rather than silently advancing across truncated data.

## MQTT and Modbus adapter settings

`mqtt-pg-metrics` uses `{ mqtt, postgres, topic, options, limits }`. URLs may be
secret references; `options.clientId` and `options.sessionExpiryInterval` preserve
an existing persistent MQTT session. Records use the existing numeric/JSON metric
decoder and are acknowledged after PostgreSQL writes. Runtime limits bound accepted
records and bytes; a one-record budget works without reserving the record twice.

The `modbus` adapter also accepts `config.plans`, one non-empty `[{ point, topic }]`
array per device. For example, `plans: [[{ point: 'holding:4000:cdab',
topic: 'existing/device/voltage' }]]` publishes that exact wire topic. Points must
use `holding:<integer>[:abcd|cdab]` within the 16-bit register address range.
Explicit plans replace `maps`; mixing the two or repeating a topic is rejected.
All devices still share one poll window.

## Read queued observations by machine

The collector history surface uses the device identifier from the second
component of a telemetry topic as its default machine identifier. When machine
IDs differ from device IDs, supply `spoolMachine(topic)` to `runCollector`. The
callback receives the slash-delimited wire topic and returns a machine ID or
`null` for observations outside the history scope.

## Enable task-state storage

Collector state is optional for live-only assignments. Ordinary supervisor-sink
business migrations skip collector state and never delete an existing state table.
Call `migrate(pool, migrationsDir, profile, { runtimeState: true })` only when
explicitly enabling task-state storage, or apply its SQL separately.
The runner accepts `COLLECTOR_STATE_URL` for PostgreSQL. Apply
`db/migrations/V0009__collector_task_state.sql` explicitly and grant the service
role access before starting stateful assignments. The storage must be reachable
from every eligible node. For process-local checkpoints, call
`runCollector({ ...options, localTaskState: true })` with `COLLECTOR_SPOOL_DIR`
set. Without a supplied `stateStore` or PostgreSQL URL, the runner opens and
owns `task-state.sqlite` in that directory. The path and schema support existing
collector checkpoints. Both built-in stores reject unsupported ownership
tokens. Node-local SQLite checkpoints belong to the node that owns their disk.

Plant adapters with JSON AMQP payloads can use `spooledOutput(context,
destinations)` from `@yarkivaev/scada/runtime` to add collector, task and event
IDs and await durable queue acceptance for each observation. Use
`amqpDestinations(url, exchange)` for a single durable topic exchange.

## Verification

Use matching released versions of SCADA and its source-to-sink dependency when reproducing runtime tests. Qualify recovery in the target environment with a production soak. The unit, transport, state recovery and mixed-runtime suites cover local runtime behavior.

---

← [Data collection](README.md) · [OPC UA collection](opc-ua.md) →
