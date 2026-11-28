[Documentation](../README.md) / [Architecture](README.md)

# Package boundary

SCADA provides factory-agnostic models and ports. Each plant application supplies its own configurations and policies. Use fictional identifiers and deployments in SCADA examples and fixtures.

SCADA treats operation `kind` values as opaque strings and exposes generic ports such as `latestForMachine`, list, upsert and stream. Plant applications define what each kind means.

| This package (`@yarkivaev/scada`) | Downstream plant application |
|---|---|
| Generic plant, shop, machine, timeline, alerts, operations ports | Equipment model, business rules and HMI |
| Injectable alert translations and tag catalogs | Localized messages and tag definitions |
| Opaque operation kind and processor property names | Operation kinds and classifier policies |
| Collector runtime, device protocol adapters, task lifecycle and delivery | Source mappings and adapters for plant-owned systems |
| Scala transport, segment contract and history protocols | Classifier profiles, rules, catalogs and the application image |
| `plantApi`, `siteServer`, `supervisorSink` | Application entrypoints, routes and reports |
| Export ports `Query` / `Stream` / `Sink` / `Job` | Export jobs and destination adapters |
| ClickHouse and PostgreSQL adapters, telemetry replay and snapshot replication | Database settings, snapshot tables and service configuration |
| Kubernetes execution, storage checks and authenticated service-account transport | Cluster, resource and Secret declarations |
| RabbitMQ reconciliation, mutual TLS and device-management transports | Broker topology, certificate identities and management policies |

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
