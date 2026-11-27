[Documentation](../README.md) / [Reference](README.md)

# Helm values

Each values file configures one cluster. See the [chart defaults](../../charts/scada/values.yaml) for the complete list.

## Chart configuration

These names are the chart binding. A profile does not use them. `releases` writes the projection above, including `buses` with the fan-out document paths. The plant fills `collectors` with `withCollectors(values, command)`. `paths(document)` lists namespace paths. The chart also reads `collectors`, `bus`, and `buses` from the values file.

The chart enables site-server and supervisor-sink by default. Set `site.enabled` or `sink.enabled` to `false` to disable a workload. Supervisor-sink uses the configured `image` and a fixed command. `command` is the site-server argv. A collector uses `collectors[].command`.

| Field | Default | Becomes |
|---|---|---|
| `image` | empty, required | image of site-server, supervisor-sink, and each collector |
| `site.enabled` | `true` | enables the site-server workload |
| `sink.enabled` | `true` | enables the supervisor-sink workload |
| `command` | image entrypoint | site-server argv, for example `["node", "bin/edge-site.js"]`. Omitted when empty |
| `pullSecret` | none | `imagePullSecrets` name on site-server, supervisor-sink, and collectors |
| `role` | `edge` | `SINK_DB_PROFILE` on site-server and supervisor-sink. The system document does not set it |
| `machines` | `[]` | `EDGE_MACHINES` JSON on site-server, omitted when empty |
| `sites` | `[]` | `EDGE_SITES` JSON on site-server, omitted when empty |
| `collectors` | `[]` | one collector Deployment per command. Empty installs none |
| `collectors[].address` | required | device address. The Deployment env `ADDRESS` is a JSON array of every address that command reads |
| `collectors[].path` | required | document path. The Deployment env `STREAM` is a JSON array of those paths. Each path is a telemetry ingest routing key |
| `collectors[].command` | required | collector argv. Entries that share this argv share one Deployment |
| `collectors[].mapping` | `{}` | point map. The Deployment env `MAPPING` is a JSON array of those maps, aligned with `STREAM` and `ADDRESS` |
| `bus` | `[]` | list of bus entries, concatenated with `buses`. Omitted from the default file |
| `buses` | `[]` | same list as `bus`. Omitted from the default file |
| `bus[].names` | `[]` | document paths. Each name is a telemetry ingest key and an outbox key. `buses[].names` is the same field |
| `env` | `[]` | extra `{ name, value }` pairs on the site-server container |
| `service.port` | `3000` | plant API, `PORT`, and the site-server Service port |
| `service.internalPort` | `8081` | `STATE_HTTP_PORT` on site-server and supervisor-sink |
| `service.nodePort` | `0` | when greater than zero, a NodePort Service `*-site-server-plant-lan` |
| `postgres.enabled` | `true` | in-cluster Postgres. When false, bring your own URL via `env` |
| `postgres.secret` | `scada-postgres` | Secret name |
| `postgres.database` | `scada` | `POSTGRES_DB` |
| `postgres.image` | `postgres:16` | Postgres image |
| `postgres.storage` | `10Gi` | Postgres volume claim |
| `postgres.storageClass` | empty | omitted when empty |
| `rabbitmq.enabled` | `true` | in-cluster RabbitMQ, STOMP and AMQP env, collector `MQTT_URL`, and the topology below |
| `rabbitmq.image` | `rabbitmq:3.13-management` | broker image |
| `rabbitmq.storage` | `5Gi` | RabbitMQ volume claim |
| `rabbitmq.storageClass` | empty | omitted when empty |
| `rabbitmq.service.type` | `ClusterIP` | broker Service type |
| `clickhouse.enabled` | `false` | in-cluster ClickHouse, `CLICKHOUSE_HOST`, and `CLICKHOUSE_URL` |
| `clickhouse.image` | `clickhouse/clickhouse-server:24.8` | ClickHouse image |
| `clickhouse.storage` | `20Gi` | ClickHouse volume claim |
| `clickhouse.storageClass` | empty | omitted when empty |
| `extraLabels` | `{}` | extra selector and metadata labels. The selector does not use `app.kubernetes.io/instance` |
| `resources` | small requests and limits | container resources on site-server, supervisor-sink, and collectors |

A collector entry needs `address`, `path`, and `command`. `mapping` may be omitted.

The chart groups entries by `command`. One command is one Deployment. Two commands that name the same `/dev/` address fail the render. Every `/dev/` address in the group is mounted from the host and the container is privileged. The Deployment name is `<release>-collector-<slug>`. The slug is the last argv word in lowercase, with runs outside `[A-Za-z0-9]` replaced by `-`.

`ADDRESS`, `STREAM`, and `MAPPING` are JSON arrays in entry order. When `rabbitmq.enabled` is true each collector also gets `MQTT_URL` `mqtt://<release>-rabbitmq:1883`. A collector `path` is an ingest key only. It does not open the outbox.

`bus` and `buses` are concatenated. The chart reads `names` on each entry. A name is an ingest key and a binding on `scada.telemetry.outbox`. The chart does not read `url` or `cluster`.

```yaml
collectors:
  - command: ["node", "bin/modbus-to-mqtt.js"]
    address: "modbus:///dev/ttyUSB0?unit=1"
    path: mill/hall/unit-1/electrical
    mapping:
      voltage: holding:40001
buses:
  - names:
      - mill/hall/unit-1/*
```

`machines` entries are opaque objects. The chart does not interpret them. A plant process that reads `EDGE_MACHINES` typically wants:

```yaml
machines:
  - id: unit-1
    device: device-1
    kind: unit
    place: tubes.hall.bay-1
```

`sites` entries are owner routes. `machineOwners` treats each machine id as owned by that `baseUrl`. A machine that appears in no site stays local. `siteSyncSites` accepts the same objects (`baseUrl` or `url`, optional `token`, optional `machines`).

```yaml
sites:
  - baseUrl: http://edge-a.plant.svc:3000/api/v1
    machines: [unit-1]
    token: plant-service
```

## Credential references

Store PostgreSQL credentials in the Secret named by `postgres.secret`.

| Key | Env |
|---|---|
| `user` | `POSTGRES_USER` on the database pod |
| `password` | `POSTGRES_PASSWORD` on the database pod |
| `url` | `POSTGRES_URL` on site-server and supervisor-sink |
| `adminUrl` | `POSTGRES_ADMIN_URL` on site-server and supervisor-sink in apply mode |

For verify mode, configure a separate [runtime Secret](../operations/database-migrations.md).

The chart defaults use RabbitMQ’s `guest` account. The chart points `STOMP_URL` and `AMQP_URL` at that broker and supplies `MQTT_URL` to collectors. Configure [broker credentials](../operations/broker-credentials.md) or supply an external broker with `rabbitmq.enabled: false` and explicit environment settings.

## Broker topology

When `rabbitmq.enabled` is true the chart loads definitions for topic exchanges `scada.alerts`, `scada.segments`, `scada.telemetry`, `scada.operations`, `scada.user_decisions`, and durable queues `scada.segments.ingest`, `scada.telemetry.ingest`, `scada.operations.ingest`, `scada.user_decisions`. Segments, operations, and decisions are bound with routing key `#`. Telemetry ingest keys are the collector paths and the `bus` and `buses` names. With none of those, the ingest binding is `#`. A `bus` or `buses` name also creates `scada.telemetry.outbox` and binds that name there. Plugins: STOMP, MQTT, and management. AMQP is `:5672`, MQTT is `:1883`, STOMP is `:61613`. MQTT allows anonymous clients on vhost `/` and uses exchange `scada.telemetry`.

A routing key replaces `/` with `.`. The path `*` is `#`. A path that ends in `/*` is that prefix plus `.#`.

## Release values

The blocks below are what `releases` emits for one cluster. They are not the system document. `cell-b` owns `unit-2` and has no fan-in:

```yaml
image: example.invalid/plant:1
command: ["node", "bin/edge-site.js"]
clickhouse:
  enabled: false
machines:
  - { id: unit-2, device: device-2, kind: unit, place: tubes.hall.bay-1 }
```

`cell-a` owns `unit-1` and its fan-in is `unit-2`:

```yaml
image: example.invalid/plant:1
command: ["node", "bin/edge-site.js"]
clickhouse:
  enabled: false
service:
  nodePort: 30300
machines:
  - { id: unit-1, device: device-1, kind: unit, place: tubes.hall.bay-1 }
sites:
  - baseUrl: http://192.0.2.11:30300/api/v1
    machines: [unit-2]
```

`archive` has no ownership. Its fan-in is both machines from `cell-a`. Metrics go to ClickHouse:

```yaml
image: example.invalid/plant:1
command: ["node", "bin/central-site.js"]
clickhouse:
  enabled: true
sites:
  - baseUrl: http://192.0.2.10:30300/api/v1
    machines: [unit-1, unit-2]
```

External state store and an external bus, profile `cell-external`:

```yaml
image: example.invalid/plant:1
postgres:
  enabled: false
rabbitmq:
  enabled: false
env:
  - { name: POSTGRES_URL, value: postgresql://scada@db.plant.svc:5432/scada }
  - { name: POSTGRES_ADMIN_URL, value: postgresql://scada@db.plant.svc:5432/scada }
  - { name: STOMP_URL, value: stomp://mq.plant.svc:61613 }
  - { name: AMQP_URL, value: amqp://mq.plant.svc:5672 }
```

Prefer Secret references over literal URLs when the values file is stored in git. `env` values are plain strings.

---

← [Environment variables](environment.md) · [JavaScript API](javascript-api.md) →
