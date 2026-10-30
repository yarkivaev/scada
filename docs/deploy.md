# Deploy DSL

Two levels.

The **system document** is one file for the whole plant: every machine, every site, every app. A plant package stores that file and does not project it itself.

A **release** is one Helm install of `charts/scada` into one cluster. `releases(document, cluster)` cuts the system document down to the values of that cluster. One release never describes a second cluster.

The chart does not know shops, furnaces, or HMI. Extra keys on a machine are opaque: they are copied through and the plant process reads them.

## System document

```yaml
plant: mill                      # required id
title: Mill                      # optional
machines:                        # required, may be empty
  - id: unit-1                   # required, unique
    device: device-1             # required
    shop: hall                   # required
    kind: unit                   # required
    # any further keys are opaque
sites:                           # required, one or more, each cluster unique
  - id: central                  # required, unique
    cluster: central             # required, release selector
    role: central                # required: central or edge
    metrics: clickhouse          # optional. central defaults to clickhouse, edge to postgres
  - id: edge-a
    cluster: edge-a
    role: edge
    api: http://192.0.2.10:30300/api/v1   # required on edge. Plant API base, including /api/v1
    machines: [unit-1]           # required on edge. Machine ids this site owns. Unknown id is an error
apps:
  scada:                         # omit to enable scada on every site with image required at the call
    image: example.invalid/plant:1        # required
    command:                     # optional. role -> argv. Absent role uses the image entrypoint
      central: ["node", "bin/central-site.js"]
      edge: ["node", "bin/edge-site.js"]
    pullSecret: registry        # optional
    secret: scada-postgres      # optional Postgres Secret name. Default scada-postgres
  wms:                           # any other key is an app this package does not interpret
    chart: wms                   # required. Chart name, not a dependency of this package
    clusters: [central]          # required. Site cluster ids that receive the app
    values:                      # required object, copied through
      image: example.invalid/wms:1
```

`releases(document, cluster)` returns the scada release for that cluster and the other apps whose `clusters` contain it. A `cluster` that matches no site is an error. An edge `machines` id that is not in `machines` is an error. Passwords are not fields of this document.

Scada projection for the selected site:

| System document | Release values |
|---|---|
| `apps.scada.image` | `image` |
| `apps.scada.command[role]` | `command` |
| `site.role` | `role` |
| `site.metrics`, or the role default | `clickhouse.enabled` is true only for `clickhouse` |
| edge `machines`, full records | `machines` (`EDGE_MACHINES`). Empty omits the env |
| every edge that has `api` and a non-empty `machines` | central `sites` as `{ baseUrl, machines }` (`EDGE_SITES`). An edge release gets `sites: []` |
| `apps.scada.secret` | `postgres.secret` |
| `apps.scada.pullSecret` | `pullSecret` |

An app other than `scada` is emitted as `{ name, chart, values }` with `values` unchanged. It is not rendered by this chart.

```bash
helm upgrade --install edge-a charts/scada \
  --namespace scada \
  --create-namespace \
  -f edge-a.yaml
```

`image` is required on the release. The release name becomes the DNS prefix: `edge-a-site-server`, `edge-a-postgres`, `edge-a-rabbitmq`, `edge-a-clickhouse`. The file passed to Helm is the release values below, not the system document.

## Values

| Field | Default | Becomes |
|---|---|---|
| `image` | empty, required | site-server image |
| `command` | image entrypoint | container command, for example `["node", "bin/edge-site.js"]` |
| `pullSecret` | none | `imagePullSecrets` name |
| `role` | `edge` | `SINK_DB_PROFILE`. `central` uses the central migration set. Any other value is the edge set |
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
    shop: hall
    kind: unit
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

## What each role installs

| | `role: central` | `role: edge` | standalone |
|---|---|---|---|
| `clickhouse.enabled` | `true` | `false` | `false` |
| `machines` | empty. The central image carries the whole plant, or you list every machine | machines this edge owns | empty |
| `sites` | one entry per edge that owns machines | empty | empty |
| Metrics | ClickHouse | Postgres | Postgres |
| Owner writes | HTTP to the edge in `sites` | local | local |

Empty `machines` omits `EDGE_MACHINES`. Empty `sites` omits `EDGE_SITES`. A process that falls back to a baked-in plant profile then sees the whole plant. Set the lists when the release must not use that fallback.

## Broker topology

When `rabbitmq.enabled` is true the chart loads definitions for topic exchanges `scada.alerts`, `scada.segments`, `scada.telemetry`, `scada.operations`, `scada.user_decisions`, and durable queues `scada.segments.ingest`, `scada.telemetry.ingest`, `scada.operations.ingest`, `scada.user_decisions`. Each queue is bound to its exchange with routing key `#`. Plugins: STOMP and management. AMQP is `:5672`, STOMP is `:61613`.

## Topologies

A standalone site. One process, local writes, metrics in Postgres, no owner routes:

```yaml
image: example.invalid/plant:1
command: ["node", "bin/site.js"]
role: edge
clickhouse:
  enabled: false
```

An edge that owns two machines and is reachable from the plant LAN:

```yaml
image: example.invalid/plant:1
command: ["node", "bin/edge-site.js"]
role: edge
clickhouse:
  enabled: false
service:
  nodePort: 30300
machines:
  - { id: unit-1, device: device-1, shop: hall, kind: unit }
  - { id: unit-2, device: device-2, shop: hall, kind: unit }
```

A central archive in front of those edges. Metrics go to ClickHouse. Writes for `unit-1` and `unit-2` go to the first edge, `unit-3` to the second. Any other machine stays local:

```yaml
image: example.invalid/plant:1
command: ["node", "bin/central-site.js"]
role: central
clickhouse:
  enabled: true
sites:
  - baseUrl: http://192.0.2.10:30300/api/v1
    machines: [unit-1, unit-2]
  - baseUrl: http://192.0.2.11:30300/api/v1
    machines: [unit-3]
```

External Postgres and an external broker, still the same chart:

```yaml
image: example.invalid/plant:1
role: edge
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
