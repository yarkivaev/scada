[Documentation](../README.md) / [Architecture](README.md)

# Package boundary

SCADA provides factory-agnostic models and ports. Plant packages such as `sokol-scada` own melting and bath logic, chemical-analysis interfaces, HMI labels, `weight_after` fold semantics, and their own sensors and routes.

SCADA treats operation `kind` values as opaque strings and exposes generic ports such as `latestForMachine`, list, upsert and stream. Plant packages define what each kind means.

| This package (`@yarkivaev/scada`) | Downstream plant package (`sokol-scada`, …) |
|------------------------|--------------------------|
| Generic plant, shop, machine, timeline, alerts, operations ports | Melting bath, chem, cycles HMI, site sensors |
| Empty/injectable alert `translations` | Localized rule messages |
| Opaque operation `kind` strings | Site kinds (`bath`, `chem`, …) and fold/prefix logic |
| Collector runtime, device protocol adapters, task lifecycle and portable delivery | Source mappings and adapters for plant-owned systems |
| Scala Supervisor engine, segment contract and history protocols | Plant classifier profiles, rules, catalogs and the application image |
| `plantApi`, `siteServer`, `supervisorSink` | Site bins, routes, `bathSensor`, reports |
| Export ports `Query` / `Stream` / `Sink` / `Job` | Export jobs + destination adapters |
| ClickHouse + PG adapters | Plant wiring (`sokolPlant` / `edgePlant`) |

Pin the released SCADA package in each downstream build. A classifier image can pin the engine sources independently of the Node.js application package.

## Transport ownership

`@yarkivaev/source-to-sink` 2.x contains only protocol-independent composition
primitives with no runtime dependencies. Protocol/storage implementations and
their integration tests live in `src/infrastructure/streams` and are exported as
`@yarkivaev/scada/streams`. This includes AMQP, MQTT, STOMP, serial, Modbus, Loki,
PostgreSQL, ClickHouse and SQLite; OPC UA stays in `@yarkivaev/scada/opcua`.
SCADA composes these adapters with generic codecs, domain ports and persistence.
The adapters own serial input, Modbus polling, MQTT/STOMP messaging, and AMQP
consumption and confirmed publishing. The generic `intervalSource` owns serialized
ticks. Plant packages supply source mappings, payload formats, queries, routing
and plant-specific transformations.

See the [stream adapter reference](../../src/infrastructure/streams/README.md) for transport configuration and lifecycle.

---

← [Data flow](data-flow.md) · [Source layout](source-layout.md) →
