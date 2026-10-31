# Deploy DSL

Two levels.

The **system document** is one file for the whole plant: every machine, every node, every app. A plant package stores that file and does not project it itself.

A **release** is one Helm install of `charts/scada` into one cluster. `releases(document, cluster)` cuts the system document down to the values of that cluster. One release never describes a second cluster.

The chart does not know furnaces or HMI. Extra keys on a machine are opaque: they are copied through and the plant process reads them. A machine's place is a dot path, so the hierarchy is as deep as the path.

## System document

A node has four parts. Each part is optional.

| Part | What it answers |
|---|---|
| `ownership` | state of an object this node edits. The same object on several nodes is one fault-tolerant set. This is not telemetry |
| `fan_in` | one flow into this node. It has no state |
| `upstream` | one flow out of this node |
| `api` | services other nodes may call. A panel that only the local HMI uses is not an api |

Telemetry lives in `fan_in` and has no state. `ownership` is state this node edits. A node may omit any part.

A flow has two fields. One flow has one name. Several names are several flows.

| Field | On `fan_in` | On `upstream` |
|---|---|---|
| `from` | where this flow comes from: a node id, or a source such as `modbus://192.0.2.10:502` | this node, so the field is omitted |
| `name` | what this flow is called | what this flow is called |
| `to` | this node, so the field is omitted | the node that receives the flow |

Flows differ. A register map, a device name, a place, and a list of fed machines are not fields of a flow. A plant keeps those notes outside the flow. `objects` lists the state this node is responsible for. An entry is the object's id. The same id on several nodes is one fault-tolerant set. Title, kind, and place are not object fields. This document does not yet list the state fields themselves.

```yaml
nodes:
  - id: cell-b
    fan_in:
      - from: modbus://192.0.2.11:502
        name: unit-2
    upstream:
      - to: cell-a
        name: unit-2
    api:
      - id: plant
        url: http://192.0.2.11:30300/api/v1
    objects:
      - unit-2
    implementation:
      profile:
        id: cell
        variables:
          cluster: cell-b
  - id: cell-a
    fan_in:
      - from: modbus://192.0.2.10:502
        name: unit-1
      - from: cell-b
        api: plant
        name: unit-2
    upstream:
      - to: archive
        name: unit-1
      - to: archive
        name: unit-2
    api:
      - id: plant
        url: http://192.0.2.10:30300/api/v1
    objects:
      - unit-1
    implementation:
      profile:
        id: cell
        variables:
          cluster: cell-a
      service: { nodePort: 30300 }
  - id: archive
    fan_in:
      - from: cell-a
        api: plant
        name: unit-1
      - from: cell-a
        api: plant
        name: unit-2
    implementation:
      profile:
        id: archive
        variables:
          cluster: archive
profiles:                        # implementation shared by many nodes
  cell:
    variables:
      cluster: null
    command: ["node", "bin/edge-site.js"]
    modules:
      state_store: { enabled: true }
      message_bus: { enabled: true }
      telemetry_store: { enabled: false }
  archive:
    variables:
      cluster: null
    command: ["node", "bin/central-site.js"]
    modules:
      state_store: { enabled: true }
      message_bus: { enabled: true }
      telemetry_store: { enabled: true }
  cell-external:
    command: ["node", "bin/edge-site.js"]
    modules:
      state_store: { enabled: false }
      message_bus: { enabled: false }
      telemetry_store: { enabled: false }
apps:
  scada:
    image: example.invalid/plant:1   # required. Every scada release uses it unless the profile sets image
    pullSecret: registry             # optional
    secret: scada-postgres           # optional state-store Secret name. Default scada-postgres
  wms:                               # any other key is an app this package does not interpret
    chart: wms                       # required
    clusters: [archive]              # required. Node cluster ids that receive the app
    values:                          # required object, copied through
      image: example.invalid/wms:1
```

`place` is a dot path on the object. `tubes.hall.bay-1` is three levels, and another object may use `tubes.hall` or `tubes.hall.bay-1.cell`. There is no separate place catalog. Two objects share a parent when their paths share a prefix. An empty segment is an error.

There is no machine catalog beside the nodes. `objects` on a node holds the records the process reads. The chart copies a record through when a flow names its id. A collector is such a record. A flow's `from` may name that collector.

`fan_in`, `upstream`, and `api` name nodes, sources, and one object id. They do not name databases. An unknown node id is an error. An object in `upstream` or in a node-to-node `fan_in` must already be telemetry or ownership on that source node, or arrive there by another fan-in. Following `upstream` for one object must not return to a node already visited. Several nodes may list the same object in `ownership`; those nodes are one fault-tolerant set for that editable state. One side of an edge is enough: `cell-b.upstream` to `cell-a` and `cell-a.fan_in` from `cell-b` are the same edge. When both sides are present, the object sets must match. `fan_in.api` selects a service of the source when that source publishes one. It is required when the source provides more than one service. A source that publishes no api is not called. Its telemetry still arrives by `upstream`.

Implementation:

| Field | Where | What it decides |
|---|---|---|
| `implementation.profile.id` | node | profile name. Unknown name is an error |
| `variables` | profile | values a node may override. `cluster` selects the release. One Helm release, one cluster |
| `implementation.profile.variables` | node | overrides of that profile |
| `implementation.service` | node | how an API is published, for example `nodePort` |
| `command` | profile | argv of the site process |
| `modules.*` | profile | `enabled: false` installs nothing. Unknown module name is an error |
| `state_store` | module | durable records: timeline, alerts, segments. Enabled installs Postgres |
| `message_bus` | module | alerts, segments, telemetry, operations, and decisions. Enabled installs RabbitMQ |
| `telemetry_store` | module | time-series measurements. Enabled installs ClickHouse |

A node that needs a different module set names another profile.

`releases(document, cluster)` joins the selected node with its profile and returns that scada release plus the other apps whose `clusters` contain it. A `cluster` that matches no `profile.variables.cluster` is an error. Passwords are not fields of this document.

Scada projection:

| System document | Release values |
|---|---|
| `apps.scada.image`, or `profile.image` when set | `image` |
| `profile.command` | `command` |
| `profile.modules.state_store` | `postgres` |
| `profile.modules.message_bus` | `rabbitmq` |
| `profile.modules.telemetry_store` | `clickhouse` |
| `profile.env` | `env` |
| `fan_in` whose `from` is not a node, joined with that node's `objects` | `machines` |
| `fan_in` whose `from` is a node, plus `upstream` edges aimed at this node | `sites` entries `{ baseUrl, machines }`. `baseUrl` is the selected source API. A source with no api is skipped |
| `apps.scada.secret` | `postgres.secret` |
| `apps.scada.pullSecret` | `pullSecret` |
| `implementation.service` | `service` |

`upstream` is not repeated on the sender's release. The receiver's `sites` list is the edge. An app other than `scada` is emitted as `{ name, chart, values }` with `values` unchanged. It is not rendered by this chart.

```bash
helm upgrade --install cell-a charts/scada \
  --namespace scada \
  --create-namespace \
  -f cell-a.yaml
```

`image` is required on the release. The release name becomes the DNS prefix: `cell-a-site-server`, `cell-a-postgres`, `cell-a-rabbitmq`, `cell-a-clickhouse`. The file passed to Helm is the release values below, not the system document.

## Values

These names are the chart binding. A profile does not use them. `releases` writes them from the modules above.

| Field | Default | Becomes |
|---|---|---|
| `image` | empty, required | site-server image |
| `command` | image entrypoint | container command, for example `["node", "bin/edge-site.js"]` |
| `pullSecret` | none | `imagePullSecrets` name |
| `role` | `edge` | `SINK_DB_PROFILE` on the current process. The system document does not set it |
| `machines` | `[]` | `EDGE_MACHINES` JSON, omitted when empty |
| `sites` | `[]` | `EDGE_SITES` JSON, omitted when empty |
| `env` | `[]` | extra `{ name, value }` pairs on the site-server container |
| `service.port` | `3000` | plant API, `PORT` |
| `service.internalPort` | `8081` | edge HTTP, `STATE_HTTP_PORT` |
| `service.nodePort` | `0` | when greater than zero, a NodePort Service `*-site-server-plant-lan` |
| `postgres.enabled` | `true` | in-cluster Postgres. When false, bring your own URL via `env` |
| `postgres.secret` | `scada-postgres` | Secret name |
| `postgres.database` | `scada` | `POSTGRES_DB` |
| `postgres.image` | `postgres:16` | Postgres image |
| `rabbitmq.enabled` | `true` | in-cluster RabbitMQ with the ingest topology below |
| `rabbitmq.image` | `rabbitmq:3.13-management` | broker image |
| `clickhouse.enabled` | `false` | in-cluster ClickHouse and `CLICKHOUSE_URL` |
| `clickhouse.image` | `clickhouse/clickhouse-server:24.8` | ClickHouse image |
| `resources` | small requests and limits | site-server resources |

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

Do not put passwords in the values file. Postgres reads Secret `postgres.secret`:

| Key | Env |
|---|---|
| `user` | `POSTGRES_USER` on the database pod |
| `password` | `POSTGRES_PASSWORD` on the database pod |
| `url` | `POSTGRES_URL` on site-server |
| `adminUrl` | `POSTGRES_ADMIN_URL` on site-server, used to run migrations |

The chart's own RabbitMQ definitions create user `guest` / `guest` and point `STOMP_URL` and `AMQP_URL` at that broker. Replace the broker (`rabbitmq.enabled: false` plus your own `env`) when that default is not acceptable.

## What a profile installs

The profile is implementation. It decides which modules exist. Local fan-in is the telemetry the release publishes as `machines`. Fan-in from another node becomes `sites`. Ownership is editable state and is not copied into `machines`.

Empty `machines` omits `EDGE_MACHINES`. Empty `sites` omits `EDGE_SITES`. A process that falls back to a baked-in plant profile then sees the whole plant. Set ownership and fan-in when the release must not use that fallback.

## Broker topology

When `rabbitmq.enabled` is true the chart loads definitions for topic exchanges `scada.alerts`, `scada.segments`, `scada.telemetry`, `scada.operations`, `scada.user_decisions`, and durable queues `scada.segments.ingest`, `scada.telemetry.ingest`, `scada.operations.ingest`, `scada.user_decisions`. Each queue is bound to its exchange with routing key `#`. Plugins: STOMP and management. AMQP is `:5672`, STOMP is `:61613`.

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

## Outside this DSL

This chart does not create the Kubernetes cluster, choose how many nodes it has, or install ingress, storage class, or a remote shovel. Another app is a key under `apps` with its own `chart` and `values`. `releases` hands those values through. This chart does not render them.

The running site process still selects one migration set with `SINK_DB_PROFILE`. This document can describe a node that both sends and receives, and `releases` emits both `machines` and `sites` for it. The process does not yet apply two migration sets on that node. Several nodes may own one object. The process does not yet choose which member of that set serves a request.
