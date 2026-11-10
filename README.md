# scada

Generic industrial monitoring domain, state persistence, and HTTP APIs (`@yarkivaev/scada`).

This package is plant-agnostic: it defines `plant` → `shop` → `machine` hierarchy, timeline and alerts, sensor read ports, STOMP ingest pipelines, and PostgreSQL/ClickHouse adapters. Plant-specific routes, sensors, HMI strings, and tag taxonomies live in downstream plant packages.

`analyticsMcp` is a stateless Streamable HTTP MCP server. The plant package supplies a `namespaceTree` (path, kind, silence, source topic), read ports, and the tag catalog already used by `plantApi({ tagCatalog })`. Tools address nodes by path. `query_postgres` is registered only when a standby query port is supplied. Each SQL engine runs one query at a time. Each call writes one JSON line to the injected journal. `GET /metrics` exposes call counts and in-flight reads.

Resources: `plant://topology`, `plant://bindings`, `plant://tags`, `plant://schema/postgres`, `plant://schema/clickhouse`. Column lists live in the schema resources, not here.

```javascript
import { analyticsMcp, namespaceTree, tagCatalog } from '@yarkivaev/scada';

const mcp = analyticsMcp({
  tree: namespaceTree(nodes),
  catalog: tagCatalog(),
  tokens: { secret: 'analyst' },
  journal(line) { process.stdout.write(line); },
  ports: {
    measurements, segments, operations, alerts, state, samples, cursor, queryClickhouse
  },
  extend(server) { /* plant tools, resources, prompts */ }
});
await mcp.listen(0, '127.0.0.1');
```

`ports.queryPostgres` registers `query_postgres`. `extend(server)` may add plant tools. `POST /mcp` requires `Authorization: Bearer`. Coverage spans add the overlapping timeline segment name as `phase`. The process journal is stdout only; `activityTracking` still writes Loki HTTP access into `activity.http_access`, not `activity.mcp_calls`.

Repository: `https://github.com/yarkivaev/scada`

## Install

```bash
npm install @yarkivaev/scada
```

Node.js 22+, ES modules.

## Quick start

```javascript
import { plantApi, metricsPlant, clickhouseConnection } from '@yarkivaev/scada';

const p = await metricsPlant(
  [{ device: 'device-1', machine: 'm1' }],
  {
    connection: () => clickhouseConnection(process.env.CLICKHOUSE_HOST),
    buildSensors: (conn, entry) => ({ /* sensor factories */ }),
    shopFactory: (entries, ctx) => { /* return shop */ }
  }
);

const api = plantApi('/api/v1', p);
```

For a full deployable process, use `siteServer` or the `supervisor-sink` binary (see below). Plant packages wrap these with site-specific routes and sensors.

## Layout

```
scada/
  src/
    domain/           business objects and ingest policies (no I/O)
    application/      composition roots (plantApi, supervisorSink, siteServer)
    infrastructure/   adapters (http, persistence, messaging, ingest, client)
    bin/              process entry points
  test/               mirrors src/ (domain/, infrastructure/, helpers/)
  db/migrations/      PostgreSQL schema (profile-specific prefixes)
  index.js            public API facade
```

## Three layers

| Layer | Role | Examples |
|-------|------|----------|
| **domain/** | Pure business logic, no imports from infrastructure | `plant`, `shop`, `machine`, `timeline`, `alerts`, `segment/dispatch` |
| **application/** | Wires domain + infrastructure into runnable units | `plantApi`, `metricsPlant`, `supervisorSink`, `siteServer` |
| **infrastructure/** | I/O adapters behind narrow ports | `persistence/pg`, `http/plant`, `http/edge`, `messaging/stomp`, `ingest` |

Dependency rules:

- `domain/` imports `domain/` only
- `application/` composes `domain/` + `infrastructure/`
- HTTP routes receive injected `plant` objects; storage backends are swappable behind the same port shape

## Data flow

**Central plant API** (read path):

```
ClickHouse ← mqttMetrics / amqpMetricsIngest
PostgreSQL ← STOMP alerts (via plantServer)
plantApi → REST + SSE → frontend / @yarkivaev/scada/client
```

`GET /api/v1/topology` returns `{ plant, nodes, links }` from `plant.topology()` or a shop/machine/sensor walk, then paints `status` from live `sensor.current()` freshness (`ok` / `degraded` / `down`). Nodes without a matching sensor stay `unknown`. `GET /infra` serves a generic SVG of that graph. Optional node `inspect: { host, port }` is reached same-origin at `/infra/inspect/:id` (CDP `Host` is loopback).

**Supervisor-sink** (write path):

```
STOMP (`/queue/scada.segments.ingest`, `/exchange/scada.alerts`, `/exchange/scada.user_decisions`)
  → ingest/codecs → domain/segment → ingest/sinks → PostgreSQL
edgeApi (:8081) ← metrics batch, checkpoints, retention (edge profile)
```

**Edge site** (`siteServer`): runs supervisor-sink HTTP, plant API, and optional MQTT ingest in one process. Metrics land in PostgreSQL on edge; on central they go to ClickHouse.

## Split family

One `off` phase can be replaced by contiguous pieces. There is no parent row and no nested segment. Each piece is a normal `segments` row: `kind = phase`, `name = off`, at most one tag. An empty tag is SQL NULL. The family key is `properties.split_of`, the original start in epoch milliseconds. The first piece keeps that `start_time`, so the existing unique key `(machine, kind, start_time)` still identifies it.

A later edit sends the whole family again. `timeline.respond` / `PATCH /segments` take `{ splits: [{ start, end, tag, open }] }` addressed by the original start. The supervisor publishes one STOMP body, `type: split-family`, with `origin` in epoch millis and the pieces. The sink deletes family starts the new cut does not use, then upserts the pieces, in one transaction.

The replacement must keep the original start and, for a closed off, the latest end of the stored family. Removing every piece but one therefore restores those bounds. `splits: []` is refused before any delete, and the stored family stays. A piece may be any positive length. Only the tail of a still-open off may have `duration = 0`. A duration-0 heartbeat does not extend a closed piece that already has `split_of`.

`C0007` grants `DELETE` on `segments` to `supervisor_sink` on the privileged admin path. The sink role does not run that grant itself. Central previously revoked this privilege (`C0002`).

## Public exports

Main entry (`import { … } from '@yarkivaev/scada'`):

| Export | Purpose |
|--------|---------|
| `plant`, `shop`, `machine` | Domain hierarchy |
| `timeline`, `alerts`, `alert`, `acknowledgedAlert` | Timeline and alerting |
| `plantApi`, `plantServer`, `siteServer`, `topologyFromPlant`, `topologyHealth` | HTTP composition and topology graph |

| `exportQuery`, `exportStream`, `exportSink`, `exportJob` | Generic export ports over plantApi / `@yarkivaev/scada/client` |
| `siteSync`, `siteSyncSites`, `siteSyncBind` | Pull kinds from an allowlisted remote plantApi into local persistence |
| `metricsPlant`, `shopWithTimeline`, `machineInPlant` | Plant wiring helpers |
| `supervisorSink`, `readDeploymentConfig` | STOMP ingest + PG persistence |
| `edgeApi`, `stateHttpClient`, `metricsSensor` | Edge HTTP read/write |
| `clickhouseConnection`, `clickhouseSensor`, `pgMetricsSensor` | Metric storage |
| `pgTimeline`, `pgAlerts`, `stateDataFromPool`, `stateDataFromMemory` | State ports |
| `stompTimeline`, `stompAlerts`, `userDecisions` | STOMP messaging |
| `machineOwners`, `ownerTimeline`, `httpTimeline`, `httpOperations` | Owner-routed timeline and operations write (local or edge HTTP) |
| `mqttMetrics`, `modbusMqtt`, `modbusPublish`, `activityTracking`, `amqpMetricsIngest` | Ingest pipelines |
| `analyticsMcp`, `namespaceTree`, `coverageSpans`, `coverageOverlay`, `coverageCursor`, `sqlGuard` | Analytics MCP, path index, coverage spans, timeline-name overlay, checkpoint-or-sample cursor, read-only SQL guard |

Subpath exports:

- `@yarkivaev/scada/client` — browser/Node HTTP+SSE client (`scadaClient`, `machineClient`) plus re-exported export ports
- `@yarkivaev/scada/stateDataFake` — in-memory state backends for tests
- `@yarkivaev/scada/startTestEdgeApi` — ephemeral edge API for integration tests

## Export ports

Generic read/stream/write contract for outbound jobs. Read side uses existing `plantApi` / `@yarkivaev/scada/client` only (no direct DB). Destination adapters and plant maps live in plant packages, not here. Do not put export into `edgeApi`.

```javascript
import { exportQuery, exportStream, exportSink, exportJob } from '@yarkivaev/scada';
import { scadaClient } from '@yarkivaev/scada/client';

const client = scadaClient(baseUrl, fetch, EventSource);
const query = exportQuery(client);
const stream = exportStream(client);
const sink = exportSink({
  write(records) { return destination.write(records); },
  send(artifact) { return destination.send(artifact); }
});
const job = exportJob({ query, transform: (rows) => rows, sink });
await job.run({ kind: 'segments', machine: 'furnace-α', from, to });
```

`POST /api/v1/sync` on any `siteServer` pulls `segments` / `operations` / `measurements` / `alerts` from `SYNC_SITES` / `EDGE_SITES` / `CENTRAL_PLANT_URL`. Body: `{ site, from, to, machines?, kinds? }`. Optional `SYNC_TOKEN`. Does not republish to RabbitMQ.

```javascript
import { siteSync } from '@yarkivaev/scada';

await siteSync({ sites, queryFor, targets }).run({
  site: 'edge-icht-1',
  from,
  to,
  kinds: ['segments']
});
```

Downstream plant packages should pin a released tag (e.g. `#v2.3.46`).

Alert and HMI copy are inject-only: pass `translations` into `siteServer` / `plantServer` / `alertPipeline` config, and override `TAG_CATALOG_PATH` or `plantApi({ tagCatalog })` for site taxonomy. Defaults ship empty or English stubs.

## Binaries

| Binary | Role |
|--------|------|
| `supervisor-sink` | STOMP → PostgreSQL ingest + edge HTTP API (`STATE_HTTP_PORT`, default 8081) |
| `modbus-to-mqtt` | Poll Modbus and publish `STREAM` + `MAPPING` document paths (`src/bin/modbus-to-mqtt.js`) |

Full plant API with site-specific routes: plant packages call `siteServer` from this package.

## Sensor port

All sensor implementations expose the same interface:

```javascript
{ name(), current(), measurements(range, step), stream(since, step, callback, clock?) }
```

Implementations: `clickhouseSensor` (central; live `stream()` batches many topics into one ClickHouse query per tick), `pgMetricsSensor` / `metricsSensor` (edge HTTP or PG).

## Database migrations

SQL files in `db/migrations/` use profile prefixes:

| Prefix | Applies to |
|--------|------------|
| `V*` | Both central and edge |
| `E*` | Edge only (metrics tables, retention) |
| `C*` | Central only (central privileges, including segment DELETE) |

Set `SINK_DB_PROFILE=central|edge`. By default, migrations run at supervisor-sink
startup via `POSTGRES_ADMIN_URL` (`SUPERVISOR_MIGRATIONS=apply`).

After a separate administrative bootstrap has applied the image's complete
migration set, set `SUPERVISOR_MIGRATIONS=verify` and remove `POSTGRES_ADMIN_URL`
from the runtime container. Startup then uses only `POSTGRES_URL` to SELECT the
recorded versions in `public.schema_migrations`. It checks shared and selected
profile migrations, including privileged migrations, before starting consumers or
HTTP. An absent/inaccessible registry or any missing migration stops startup;
it never creates the registry or falls back to administrative credentials.
Collector task-state migration remains separately opt-in, as in apply mode.
This verifies migration records, not schema checksums or effective DML privileges.

The restricted runtime role needs database CONNECT, public schema USAGE,
`GRANT SELECT ON public.schema_migrations TO <runtime_role>`, and the DML/sequence
grants required by its enabled pipelines and APIs. It needs no schema CREATE,
registry INSERT, table ownership or elevated role attributes for verification.
Do not mount an administrative Secret into verify-mode runtime containers.
Complete each image's bootstrap and role grants before switching it; retain the
administrative identity only in the separate migration job. Use the exact main
commit whose mandatory checks passed before releasing a new image.

For chart-managed PostgreSQL, select this boundary with:

```yaml
postgres:
  migrationsMode: verify
  secret: postgres-bootstrap
  runtimeSecret: postgres-runtime
```

`runtimeSecret` must differ from the bootstrap Secret and contain the restricted
connection string under `url`. The chart injects it as POSTGRES_URL, sets
SUPERVISOR_MIGRATIONS=verify, and omits POSTGRES_ADMIN_URL from both application
containers. Bootstrap credentials remain on PostgreSQL. Apply mode keeps the
legacy adminUrl reference; an optional runtimeSecret can separately supply its
POSTGRES_URL. With postgres.enabled=false, explicit application env values
continue to configure external databases without generated PostgreSQL settings.
Do not add administrative credentials through env/envFrom when selecting verify.

## Environment (supervisor-sink / siteServer)

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

## Deploy

The deployment DSL is specified in [docs/deploy.md](docs/deploy.md). A flow is `from` and `name`. An object listed on a node is state that node is responsible for. Profile, cluster, and modules are implementation. One Helm release of `charts/scada` is one cluster, cut from that document.

## Testing

```bash
npm test                        # all Mocha unit tests
npm test -- --grep "pattern"    # filter by name
npm run test:deep               # domain + ingest (integration needs Docker)
npm run coverage
npm run lint
npm run lint:eo                 # Elegant Objects naming audit
```

Tests mirror `src/` under `test/`. Use fakes instead of mocks; one assertion per test. Integration tests under `test/infrastructure/**/integration/` use testcontainers.

For HTTP/state tests without PostgreSQL:

```javascript
import stateDataFake from '@yarkivaev/scada/stateDataFake';
```

## Design conventions

- Factory functions returning frozen objects — no classes, no inheritance
- ESLint limits: `max-lines: 200`, `max-lines-per-function: 50`, `no-console`, `no-inline-comments`
- Docblocks on every module; method bodies without blank lines
- See `CLAUDE.md` for layer rules and ingest sandwich diagram

## Package boundary

**Hard rule:** this package is factory-agnostic. It must not contain Sokol melting/bath domain, chem-analysis UI, HMI copy (e.g. Болото), `weight_after` fold semantics, or plant-specific sensors/routes. Those belong in `sokol-scada` (or another plant package).

Opaque operation `kind` strings and generic ports (`latestForMachine`, list/upsert/stream) are allowed; never treat a kind as a first-class domain type here.

| This package (`@yarkivaev/scada`) | Downstream plant package (`sokol-scada`, …) |
|------------------------|--------------------------|
| Generic plant, shop, machine, timeline, alerts, operations ports | Melting bath, chem, cycles HMI, site sensors |
| Empty/injectable alert `translations` | Localized rule messages |
| Opaque operation `kind` strings | Site kinds (`bath`, `chem`, …) and fold/prefix logic |
| `plantApi`, `siteServer`, `supervisorSink` | Site bins, routes, `bathSensor`, reports |
| Export ports `Query` / `Stream` / `Sink` / `Job` | Export jobs + destination adapters |
| ClickHouse + PG adapters | Plant wiring (`sokolPlant` / `edgePlant`) |

### Stream transport ownership

`@yarkivaev/source-to-sink` owns reusable Node.js sources, sinks and transport
lifecycle: serial input, Modbus polling,
MQTT/STOMP messaging, AMQP consumption and confirmed publishing, and serialized
periodic ticks. SCADA composes these primitives with generic codecs, domain ports
and persistence adapters. Plant packages supply source mappings, payload formats,
queries, routing and plant-specific behavior.

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

Depend on a pinned version (`"@yarkivaev/scada": "…#v2.3.46"`), not a local path, in downstream packages.

## CI/CD

GitHub Actions via `yarkivaev/npm-workflows` (lint, test, version check). This repo publishes an npm package only; container images are built in downstream deploy repos.

### Ingest delivery and quarantine

`STOMP_PREFETCH` sets a positive, bounded segment delivery window (default 128).
`SEGMENTS_DEAD_LETTER_ENABLED=true` opts into rejecting malformed segment records
without requeue; transient persistence failures are retried. Enable this only with
a durable DLQ and routing policy. In the deployment DSL, configure
`profiles.<profile>.modules.message_bus.dead_letter.queue: scada.ingest.dlq`.
The scada chart declares the queue and applies an ingest-only dead-letter policy,
without changing existing queue arguments. The profile `env` is passed to both
site-server and supervisor-sink. DLQ records retain the original body and RabbitMQ
`x-death` metadata for inspection and deliberate replay; they are not auto-expired.

### Deploy a node with named processes

A profile can expose deployment coordinates in `target`, set
`apps.scada.site.enabled` and `apps.scada.sink.enabled` independently, and
provide RabbitMQ chart settings in `modules.message_bus.chart`. The
`releases(document, cluster)` projection returns the target and chart values.
The default profile still renders the existing site and sink.

`subscriptions(expandedDocument, sourceId)` returns the outgoing server
subscriptions as `{ from, to, name, api? }`. It combines sender `fan_out` and
receiver `fan_in` declarations, keeping each expanded stream path and any
explicit service selected by the receiver. Declaring the same subscription on
both sides produces a single row.

Use `collectorProcesses(machines, describe, project)` to derive workloads from
the selected server's source rows. For each row, `describe(row)` returns a
process name, command and optional environment and resources. Rows with the
same name must describe the same process. `project(descriptor, rows)` converts
its sources into adapter-specific environment variables and host devices. Process
order follows the first occurrence of each name in the source rows.
The packaged `charts/scada` chart renders the resulting `processes` as
named Deployments. A configured broker claim name selects a standalone PVC.
The default storage mode uses StatefulSet claim templates.

`executeRelease(plan, action)` renders the chart or runs check, diff, adopt
and apply against the explicitly supplied Kubernetes context and namespace.
During `adopt`, the legacy client-side manager migrates the resources first.
The release's server-side manager then applies the same rendered manifest before
the executor waits for the workloads. This restores declared fields that a
legacy three-way merge can drop, such as an environment entry whose name was
duplicated in the old last-applied annotation. Each apply gets its own server
dry-run. `check-adoption` previews the client-side phase only. The server-side
phase must run against the migrated state. An ownership conflict stops adoption
before rollout waits and the afterReady hook. Resolve the field ownership and
rerun `apply` after the client-side migration has completed.
A caller can supply prerequisites, rollout resources and an afterReady hook.
The RabbitMQ definitions builder and management reconciler are exported as
`@yarkivaev/scada/rabbitmq/definitions` and `@yarkivaev/scada/rabbitmq/reconcile`.
The caller supplies the vhost, connection settings and ownership policy for
retired routes. Reconciliation retains stored queues.

### Collect multiple OPC UA endpoints

`@yarkivaev/scada/opcua` exports `opcuaConnections(connections, publish, options)`
and `validateConnections(connections)`. The same entry point exports
`opcuaSource(connections, collector, options)` for source-to-sink composition;
the collector accepts `{ channel, value }`. SCADA owns the OPC UA runtime and
its `node-opcua` dependency; source-to-sink contains no OPC UA implementation.
Offline deployment planners should import
`validateConnections` from `@yarkivaev/scada/opcua/config`; this entry point never
loads the network library or its startup diagnostics. Each connection has a unique `url`,
positive `publishMs` and `heartbeatMs`, and `channels` with explicit, unique
`nodeId` values. Additional channel metadata is opaque to this library.

```js
import opcuaConnections from '@yarkivaev/scada/opcua';

const collector = opcuaConnections([
    { url: 'opc.tcp://192.0.2.10:4840', publishMs: 100, heartbeatMs: 1000,
        channels: [{ nodeId: 'ns=1;s=temperature', topic: 'line/temperature' }] }
], (channel, value) => publish(channel.topic, value));
await collector.start();
// On process shutdown:
await collector.stop();
```

Each endpoint owns its client, session and subscription. An unavailable endpoint
retries independently while others continue. Start schedules these workers; it
does not wait for every server to be available. Samples are delivered only with
Good quality, both on change and through serialized fresh heartbeat reads.
The caller owns value conversion, routing, timestamps and destination transport.
Options `retryMs`, `connectTimeoutMs` and `requestTimeoutMs` bound retry timing and
network requests; `onError(error, connection)` receives connection diagnostics.
Do not replicate a collector with the same sources to distribute load: assign
disjoint source sets to separate instances instead.

A release can replace old collectors using
`retirements: [{ workload: 'deployment/old-reader', selector: 'app=old-reader' }]`.
For apply/adopt, the executor validates the new manifests first, foreground-deletes
only these explicit Deployments, and verifies that no selected old pods remain
before applying the replacement. This trades a collection gap for no overlap.
The caller must bind each selector to its old Deployment; no namespace-wide prune
is performed. Render/check/diff do not delete anything. An optional process `image`
overrides the release image, so unrelated collectors can retain their pinned runtime.

## Universal collector runtime

`scada-collector manifest.json` (or `scada-collector -` for stdin) runs all
registered adapters inside one Node.js process. Every instance has the same
registry; assignments select its work. `COLLECTOR_MANIFEST` accepts inline JSON;
`COLLECTOR_MANIFEST_PATH` selects a file. SIGHUP reconciles the file, SIGTERM/SIGINT
perform bounded shutdown. No cluster scheduler, lease service or network control
API is included. HTTP request handlers and their process-local read models remain
owned by the HTTP application; use `COLLECTOR_MODE=external` to disable its
transferable background collection before assigning that work elsewhere.

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

Adapters include `stream` (registered source/transform/sinks), `modbus`,
`activity`, `amqp-relay`, `amqp-metrics`, `mqtt-metrics`, `operation-sync`,
`amqp-pg-metrics`, `mqtt-pg-metrics`, `silent-streams` and `stomp-ingest`. Plant packages extend the
registry with domain-specific adapters; OPC UA belongs here, not in
source-to-sink. Constructors do not open connections. A task owns independent
connections and must close them in `stop()`. Factories are trusted code, not
arbitrary scripts supplied in manifests.

Assignments have stable task IDs, externally supplied integer generations and
`specVersion: 1`. An optional `specHash` is checked against canonical JSON.
Identical repeats are idempotent; conflicting/stale generations are rejected.
Replacement waits for the previous owner to stop. Removed IDs retain bounded
in-memory tombstones. Cleanup timeout quarantines resources and marks the
runtime fatal; it never authorizes a second owner. Generation and PostgreSQL CAS
are local/conflict safeguards, **not distributed fencing**. The external agent
must establish cross-node ownership and provide current assignments after restart.

Secrets can be references such as `{ "$secret": "AMQP_URL" }`, resolved by the
host immediately before adapter construction. Status excludes configuration and
exception messages. Optional `COLLECTOR_HEALTH_PORT` and
`COLLECTOR_HEALTH_HOST` (default `127.0.0.1`) expose read-only `/live`, `/ready`
and `/status`. Readiness rejects failed or degraded tasks as well as runtime
shutdown. Fatal cleanup or an uncertain MQTT acceptance/write timeout makes
liveness fail; configure an external restart policy. Transient MQTT errors mark
the task degraded until broker reconnect; terminal timeouts require a fresh
executor after the old process drains its IO. A blocked event loop cannot answer
an external probe; synchronous infinite loops/native crashes still affect the
entire process. No hard CPU or native-memory isolation is claimed.

The process defaults to 16 MiB / 16,384 buffered records, each task to 1 MiB /
1,024, with bounded control admission and start/stop deadlines. Adapter-owned
buffers and actual sink promises reserve capacity; driver/internal allocations
and transient JSON decoding are not a hard RSS limit. Configure capacities for
all simultaneously retained pipeline stages. MQTT and Loki collectors flush
individual accepted records because their source delivery is sequential;
AMQP pipelines retain bounded timed batching. Timeout is not proof that a remote
side effect did not happen.

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

Collector state is optional for live-only assignments. Ordinary supervisor-sink
business migrations skip collector state and never delete an existing state table.
Call `migrate(pool, migrationsDir, profile, { runtimeState: true })` only when
explicitly enabling task-state storage, or apply its SQL separately.
The runner accepts `COLLECTOR_STATE_URL` for PostgreSQL. Apply
`db/migrations/V0009__collector_task_state.sql` explicitly and grant the service
role access before starting stateful assignments; the runner never runs schema
migrations or falls back to local disk. The storage must be reachable from every
eligible node. The built-in store rejects unsupported ownership tokens rather
than pretending to enforce an external fencing protocol.

The coordinated review branches require new source-to-sink/scada package releases
before dependency installation can reproduce all runtime tests. Stable release/pin
updates and deployment remain separate steps. Unit, transport,
state recovery and mixed-runtime tests do not constitute a 24-hour production
soak or prove cluster-wide exactly-once effects.

## Streaming package boundary

`@yarkivaev/source-to-sink` 2.x contains only protocol-independent composition
primitives with no runtime dependencies. Protocol/storage implementations and
their integration tests live in `src/infrastructure/streams` and are exported as
`@yarkivaev/scada/streams`. This includes AMQP, MQTT, STOMP, serial, Modbus, Loki,
PostgreSQL, ClickHouse and SQLite; OPC UA stays in `@yarkivaev/scada/opcua`.
Plant-specific transformations stay in the plant package.

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

## Ordered release stages

`executeStages(stages, action = 'render', execute?)` runs ordered generic release
plans. For `apply`/`adopt`, every stage is preflighted before the first mutation;
each rollout and `afterReady`/`beforeApply` gate must finish before the next stage.
Read-only actions do not invoke mutation gates. A plan may declare exact Deployment
`retirements: [{ workload: 'deployment/old-reader', selector: 'app=old-reader' }]`
and `podsAbsentBeforeApply` selectors to fence old readers before a replacement.
Retirement waits for foreground deletion and verifies no matching pods remain;
failures stop execution. Context, namespace and field manager remain explicit.

The application chart accepts existing PostgreSQL/RabbitMQ claims, secret-backed
environment values, `envFrom`, config volumes, probes and extra Kubernetes objects.
PostgreSQL honors the root `pullSecret`. Existing claims are referenced without
creating or deleting storage; plant packages supply their precise deployment values.

### Per-server module configuration

A server may override its profile's `modules`. Maps merge recursively; omitted
fields are inherited, arrays replace, and null removes an inherited key.
`state_store.pgdata` selects PostgreSQL's existing data directory and takes
precedence over the compatible `state_store.chart.data` setting.

```yaml
servers:
  - id: cell-a
    modules:
      state_store:
        pgdata: /var/lib/postgresql/data/pgdata
    profile:
      id: cell
      variables:
        cluster: cell-a
```

This changes the selected server only; it does not mutate the shared profile.

The optional `mdmesh` module projects `chart` settings into `releases(...).scada.mdmesh`,
with its explicit `namespace` and `enabled` (default `true`) taking precedence.
It uses the same profile inheritance and server overrides. A consuming application
owns the MDMesh chart and deployment; the generic application chart does not install it.
An optional root `hmi` catalog passes through reading, includes, expansion, and release
projection as `releases(...).hmi` without interpretation. Catalog validation belongs
to the consuming application.

### Central backup freshness

Silent Modbus backup sources use `MX210/<device>` freshness identities. AMQP telemetry tracks `<source-family>/<device>`, so cooling for a device cannot hide missing MX210 electrical samples. Measurement topic paths are unchanged. Custom freshness callbacks must pass the source’s full identity to `seen()`.

### MQTT publisher recovery

An unexpected MQTT publisher close/offline/error retires the session and notifies `onFatal` once. Intentional `stop()` does not notify failure. Modbus runtime tasks propagate publisher failure to collector `/ready` and `/live` (503). Run the collector under its liveness supervisor: it must retire the failed executor and create a fresh one, which reconnects after the broker returns. Uncertain publications are not automatically replayed. Broker restart regression covers failed health, old poll cleanup, and confirmed fresh measurements from the replacement executor.

### Central canonical telemetry, version 4

`CENTRAL_TELEMETRY_POLICY` is generated by the deployment DSL. Runtime capability
`centralTelemetryVersion === 4` rejects old bitmap/PG review configurations.
There is no PostgreSQL telemetry registry and no bitmap/custom aggregate storage.

All protected AMQP/MQTT/sync/external adapters publish immutable, bounded batches
to ONE durable RabbitMQ SAC queue, prefetch1, persistent mandatory confirms,
reject-publish overflow, no TTL/priorities. A failed unacked head is held in place.
Its frozen central `admittedAt` and per-topic policy survive retries. The worker
uses synchronous ClickHouse inserts and commits its bounded metadata counter
only after point/rejection writes, before source ACK.

Central point admission and endpoint publication use RowBinary to preserve Float64 values and UInt128 revisions exactly. The writer drains the complete synchronous ClickHouse response before committing the admission cursor.

Ordinary `scada.metrics_points_v4` rows use ReplacingMergeTree(revision), keyed by
(topic, original millisecond timestamp). Last durable admission wins, including
array order within a batch. The user removed the previous first-value rule.
Native versions prevent delayed old INSERTs overtaking a newer admitted value;
FINAL reads are correct before background merges too.

Default policy fields (all overridable for exact topics):

- compactWindowMs:60000; zero disables physical thinning.
- maxGapMs:30000; positive maximum interval in the merged sensor stream; exact-topic overrides are supported.
- historyWindowMs:604800000; seven days behind this topic's latest valid point.
- maxHistoryAgeMs:2592000000; thirty-day calendar cap at central admission.
- futureSkewMs:300000; far-future source clocks are rejected before watermarking.

A topic's sealed frontier advances monotonically, only at complete-window
boundaries. Previous production history seeds the initial watermark. A longer
configured window never reopens sealed history. Too-old/future observations go
to separately named TTL-bounded diagnostics before ACK and never alter canonical
history. No automatic old-history update, addition or deletion is accepted.

Recent observations retain all original timestamps. In a sealed constant-value
window, observations are split into continuity islands: a gap strictly greater than frozen maxGapMs starts a new island; equality remains continuous. Each island retains its first/last observations; a singleton stays once. In a window with
ANY different value, EVERY canonical point is retained, including short spikes,
returns and oscillations. There is no average, value tolerance or time rounding
that can hide an observed differing value. Overlapping policies/legacy windows
are conservatively retained.

Native background DELETE mutations physically remove equal interior points.
Two ordinary retained endpoint rows carry explicit constant-span/revision
certificates: an older differing INSERT cannot resurrect a deleted superseded
interior. Complete endpoint proofs are durable before deletion, with a read grace
on publication. Cleanup limits pending mutations; failures retain extra rows
and retry, never lose canonical values. This reduces actual stored observations,
not merely a SELECT result. There is no forever-full hidden raw copy.

`scada.metrics_read` is the canonical relation; `metrics_raw_read` exposes retained
point rows and cannot reconstruct deleted timestamps. Level changes/edges remain
available. Density-sensitive counts/minPoints use bounded
`clickhouseMetricsRawRange`, which explicitly rejects sealed constant ranges with
`SCADA_HISTORY_DENSITY_UNAVAILABLE` instead of silently computing from endpoints.
Graphs may clip constant coverage using derived display vertices, which are not
original observations. Edge raw history and local classifications are untouched.

Legacy scada.metrics stays readable and unchanged with precedence on overlapping
keys. Only missing additive schema falls back; permission/schema failures surface.
One authoritative read-after-write ClickHouse target is required. Serving reads
through lagging asynchronous replicas is unsupported. Atomic table comments pin
broker/vhost/queue/target; an independent domain cannot race the same data. Existing
v1/v2/v3 review schemas/envelopes require an explicit migration, not silent reuse.
Disable after activation and immutable queue argument changes fail closed.

No merge, deployment, running-database migration, package/image publication or
release is performed by opening or updating this PR.

Native v4 persists each observation's frozen `max_gap_ms`. Certificates prove continuous coverage for one island, so deletion and repeated cleanup never turn a certified interval into a false gap or join separate islands. Interleaved collectors are merged by logical topic and timestamp before detecting gaps. Mixed-value windows remain entirely retained. Chart downsampling groups by continuity before time buckets and emits explicit null separators; native numeric points carry `continuous` metadata so consumers do not infer false gaps from sparse certified endpoints. Holds may use certificates when requested gap is at least the stored threshold; stricter raw-density requests remain explicitly unavailable.

Older unpublished v3 native tables/envelopes require an explicit migration and are rejected; erased gap evidence cannot be recovered from their endpoints. No automatic upgrade or production migration runs in these PRs. Ordinary legacy `scada.metrics` remains readable and unmodified.

HTTP and display MCP results preserve continuity metadata and null separators. `sensor.samples(range)` uses the exact-density guard and returns actual observations for coverage analytics; unsupported raw readers fail explicitly. Two-point unthinned islands retain exact density. Frontends show isolated observations, and peak analytics ignore null separators.

### Broker credential Secrets

Set `rabbitmq.definitionsSecret` to a separately provisioned Secret with the key
`definitions.json`; the chart then omits definitions from its ConfigMap. Set
`rabbitmq.runtimeSecret` for `AMQP_URL`, `STOMP_LOGIN` and `STOMP_PASSCODE`.
Other clients can reference the same or narrower Secrets explicitly. Anonymous
MQTT remains compatible by default; set `rabbitmq.extraConfig["mqtt.allow_anonymous"]`
to false only after all MQTT clients have authenticated credentials. A frozen
broker PodTemplate cannot adopt these mounts: unfreeze it for a controlled
restart while preserving the claim. Definitions import does not delete an
existing guest user; retire it explicitly after all dependent clients reconnect.

### Collector recovery and durable delivery references

Collector health opens before local spool recovery; `/live` remains responsive and `/ready` stays negative until recovery and a saved/initial assignment are applied. Cached assignments start without waiting for the first network reconciliation. `COLLECTOR_RECOVERY_TIMEOUT_MS` defaults to 900000 and bounds local initialization; exceeding it terminates startup for the external supervisor. Validate recovery duration against measured queue capacity before activation.

Spooled destination descriptors retain secret references. Draining a recovered queue resolves the current secret for each logical recipient, so credential rotation does not freeze a password in queued observations. Source connection credentials are still resolved at resource construction. Scheduler updates preserve a potentially working replica until another matching reader reports fresh progress, except explicit current-generation failure.

Central canonical ingestion propagates the receiver session ownership predicate through schema initialization and admission. It checks ownership again after authoritative state/clock reads and before writes; a lost session cannot allocate a newer revision from a delayed SELECT. Already submitted old-revision inserts remain safe under canonical winner ordering.
