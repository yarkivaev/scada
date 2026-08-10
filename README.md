# scada

Generic industrial monitoring domain, state persistence, and HTTP APIs (`@yarkivaev/scada`).

This package is plant-agnostic: it defines `plant` → `shop` → `machine` hierarchy, timeline and alerts, sensor read ports, STOMP ingest pipelines, and PostgreSQL/ClickHouse adapters. Plant-specific routes, sensors, HMI strings, and tag taxonomies live in downstream plant packages.

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

**Supervisor-sink** (write path):

```
STOMP (`/queue/scada.segments.ingest`, `/exchange/scada.alerts`, `/exchange/scada.user_decisions`)
  → ingest/codecs → domain/segment → ingest/sinks → PostgreSQL
edgeApi (:8081) ← metrics batch, checkpoints, retention (edge profile)
```

**Edge site** (`siteServer`): runs supervisor-sink HTTP, plant API, and optional MQTT ingest in one process. Metrics land in PostgreSQL on edge; on central they go to ClickHouse.

## Public exports

Main entry (`import { … } from '@yarkivaev/scada'`):

| Export | Purpose |
|--------|---------|
| `plant`, `shop`, `machine` | Domain hierarchy |
| `timeline`, `alerts`, `alert`, `acknowledgedAlert` | Timeline and alerting |
| `plantApi`, `plantServer`, `siteServer` | HTTP composition |
| `exportQuery`, `exportStream`, `exportSink`, `exportJob` | Generic export ports over plantApi / `@yarkivaev/scada/client` |
| `metricsPlant`, `shopWithTimeline`, `machineInPlant` | Plant wiring helpers |
| `supervisorSink`, `readDeploymentConfig` | STOMP ingest + PG persistence |
| `edgeApi`, `stateHttpClient`, `metricsSensor` | Edge HTTP read/write |
| `clickhouseConnection`, `clickhouseSensor`, `pgMetricsSensor` | Metric storage |
| `pgTimeline`, `pgAlerts`, `stateDataFromPool`, `stateDataFromMemory` | State ports |
| `stompTimeline`, `stompAlerts`, `userDecisions` | STOMP messaging |
| `machineOwners`, `ownerTimeline`, `httpTimeline`, `httpOperations` | Owner-routed timeline and operations write (local or edge HTTP) |
| `mqttMetrics`, `modbusMqtt`, `activityTracking`, `amqpMetricsIngest` | Ingest pipelines |

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

Downstream plant packages should pin a released tag (e.g. `#v2.3.46`).

Alert and HMI copy are inject-only: pass `translations` into `siteServer` / `plantServer` / `alertPipeline` config, and override `TAG_CATALOG_PATH` or `plantApi({ tagCatalog })` for site taxonomy. Defaults ship empty or English stubs.

## Binaries

| Binary | Role |
|--------|------|
| `supervisor-sink` | STOMP → PostgreSQL ingest + edge HTTP API (`STATE_HTTP_PORT`, default 8081) |

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
| `C*` | Central only (revoke delete on metrics) |

Set `SINK_DB_PROFILE=central|edge`. Migrations run at supervisor-sink startup via `POSTGRES_ADMIN_URL`.

## Environment (supervisor-sink / siteServer)

| Variable | Purpose |
|----------|---------|
| `STOMP_URL` | RabbitMQ STOMP broker |
| `POSTGRES_URL` | Application DB user (`supervisor_sink`) |
| `POSTGRES_ADMIN_URL` | Admin user for migrations |
| `SINK_DB_PROFILE` | `central` or `edge` |
| `STATE_HTTP_PORT` / `STATE_HTTP_TOKEN` | Edge internal API |
| `MQTT_URL`, `MQTT_TOPICS` | Optional metrics ingest |
| `CLICKHOUSE_URL` | Central metrics sink |
| `PORT` | Plant API port (siteServer, default 3000) |

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

| This package (`@yarkivaev/scada`) | Downstream plant package |
|------------------------|--------------------------|
| Generic plant, timeline, alerts, ingest | Site domain, sensors, HMI strings, tag taxonomy |
| Empty/injectable alert `translations` | Localized rule messages |
| Opaque operation `kind` strings | Site-specific kinds (`sample`, `load`, …) |
| `plantApi`, `siteServer`, `supervisorSink` | Site bins and routes |
| Export ports `Query` / `Stream` / `Sink` / `Job` | Export jobs + destination adapters |
| ClickHouse + PG adapters | Plant wiring (`metricsPlant`, shops, machines) |

Depend on a pinned version (`"@yarkivaev/scada": "…#v2.3.46"`), not a local path, in downstream packages.

## CI/CD

GitHub Actions via `yarkivaev/npm-workflows` (lint, test, version check). This repo publishes an npm package only; container images are built in downstream deploy repos.
