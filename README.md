# scada

Generic industrial monitoring domain, state persistence, and HTTP APIs for the Sokol SCADA platform.

This package is plant-agnostic: it defines `plant` → `shop` → `machine` hierarchy, timeline and alerts, sensor read ports, STOMP ingest pipelines, and PostgreSQL/ClickHouse adapters. Sokol melting-shop specifics live in [`sokol-scada`](https://gitlab.scada.svsokol.ru/scada/sokol-scada).

Repository: `https://gitlab.scada.svsokol.ru/scada/scada`

## Install

```bash
npm install
```

Node.js 22+, ES modules. Published to the GitLab npm registry on tag push.

## Quick start

```javascript
import { plantApi, metricsPlant, clickhouseConnection } from 'scada';

const p = await metricsPlant(
  [{ device: 'icht-1', machine: 'icht1' }],
  {
    connection: () => clickhouseConnection(process.env.CLICKHOUSE_HOST),
    buildSensors: (conn, entry) => ({ /* sensor factories */ }),
    shopFactory: (entries, ctx) => { /* return shop */ }
  }
);

const api = plantApi('/api/v1', p);
```

For a full deployable process, use `siteServer` or the `supervisor-sink` binary (see below). In production, `sokol-scada` wraps these with melting routes and MX210 sensors.

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
plantApi → REST + SSE → frontend / scada/client
```

**Supervisor-sink** (write path):

```
STOMP (/exchange/scada.segments|alerts|user_decisions)
  → ingest/codecs → domain/segment → ingest/sinks → PostgreSQL
edgeApi (:8081) ← metrics batch, checkpoints, retention (edge profile)
```

**Edge site** (`siteServer`): runs supervisor-sink HTTP, plant API, and optional MQTT ingest in one process. Metrics land in PostgreSQL on edge; on central they go to ClickHouse.

## Public exports

Main entry (`import { … } from 'scada'`):

| Export | Purpose |
|--------|---------|
| `plant`, `shop`, `machine` | Domain hierarchy |
| `timeline`, `alerts`, `alert`, `acknowledgedAlert` | Timeline and alerting |
| `plantApi`, `plantServer`, `siteServer` | HTTP composition |
| `metricsPlant`, `shopWithTimeline`, `machineInPlant` | Plant wiring helpers |
| `supervisorSink`, `readDeploymentConfig` | STOMP ingest + PG persistence |
| `edgeApi`, `stateHttpClient`, `metricsSensor` | Edge HTTP read/write |
| `clickhouseConnection`, `clickhouseSensor`, `pgMetricsSensor` | Metric storage |
| `pgTimeline`, `pgAlerts`, `stateDataFromPool`, `stateDataFromMemory` | State ports |
| `stompTimeline`, `stompAlerts`, `userDecisions` | STOMP messaging |
| `mqttMetrics`, `modbusMqtt`, `activityTracking`, `amqpMetricsIngest` | Ingest pipelines |

Subpath exports:

- `scada/client` — browser/Node HTTP+SSE client (`scadaClient`, `machineClient`)
- `scada/stateDataFake` — in-memory state backends for tests
- `scada/startTestEdgeApi` — ephemeral edge API for integration tests

## Binaries

| Binary | Role |
|--------|------|
| `supervisor-sink` | STOMP → PostgreSQL ingest + edge HTTP API (`STATE_HTTP_PORT`, default 8081) |

Full plant API + melting routes: use `sokol-scada/bin/central-site.js` or `edge-site.js`, which call `siteServer` from this package.

## Sensor port

All sensor implementations expose the same interface:

```javascript
{ name(), current(), measurements(range, step), stream(since, step, callback, clock?) }
```

Implementations: `clickhouseSensor` (central), `pgMetricsSensor` / `metricsSensor` (edge HTTP or PG).

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
import stateDataFake from 'scada/stateDataFake';
```

## Design conventions

- Factory functions returning frozen objects — no classes, no inheritance
- ESLint limits: `max-lines: 200`, `max-lines-per-function: 50`, `no-console`, `no-inline-comments`
- Docblocks on every module; method bodies without blank lines
- See `CLAUDE.md` for layer rules and ingest sandwich diagram

## Package boundary

| This package (`scada`) | Downstream (`sokol-scada`) |
|------------------------|----------------------------|
| Generic plant, timeline, alerts, ingest | Melting domain, MX210 sensors, Russian HMI strings |
| `plantApi`, `siteServer`, `supervisorSink` | `central-site.js`, `edge-site.js` bins |
| ClickHouse + PG adapters | `sokolPlant`, `edgePlant` wiring |

Depend on a pinned version (`"scada": "2.3.1"`), not a local path, in downstream packages.

## CI/CD

GitLab project `scada/scada`. Pipeline from `gitlab-ci-templates`: test, validate-version, create-tag, release-npm. This repo publishes an npm package only; container images are built in downstream deploy repos (e.g. `sokol-scada`).
