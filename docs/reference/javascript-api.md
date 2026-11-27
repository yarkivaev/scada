[Documentation](../README.md) / [Reference](README.md)

# JavaScript API

Import SCADA domain objects and adapters from the library entry point or the documented subpaths.

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

- `@yarkivaev/scada/opcua` and `@yarkivaev/scada/opcua/config` — [OPC UA collection and configuration](../collect/opc-ua.md)
- `@yarkivaev/scada/runtime` — [collector runtime](../collect/runtime.md)
- `@yarkivaev/scada/control` — [edge assignment control](../collect/edge-controller.md)
- `@yarkivaev/scada/streams` — [stream adapters](../../src/infrastructure/streams/README.md)
- `@yarkivaev/scada/rabbitmq/definitions` and `@yarkivaev/scada/rabbitmq/reconcile` — [broker topology tools](../deploy.md#deploy-a-node-with-named-processes)
- `@yarkivaev/scada/package.json` — package metadata

See [index.js](../../index.js) and [package.json](../../package.json) for the full export list.

## Sensor port

All sensor implementations expose the same interface:

```javascript
{ name(), current(), measurements(range, step), stream(since, step, callback, clock?) }
```

Implementations: `clickhouseSensor` (central; live `stream()` batches many topics into one ClickHouse query per tick), `pgMetricsSensor` / `metricsSensor` (edge HTTP or PG).

## Connect ClickHouse sensors

Provide two plant-specific callbacks. `buildSensors` wires the sensor ports and `shopFactory` returns the shop that contains the machines.

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

For deployment, see [CLI tools](cli.md) and [Helm installation](../install/helm.md).

---

← [Helm values](helm-values.md) · [Analytics MCP](analytics-mcp.md) →
