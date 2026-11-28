[Documentation](README.md) / [Installation](install/README.md)

# Deployment configuration

Describe the plant namespace, server responsibilities and telemetry routes in a system document. Project one release per Kubernetes cluster.

The **system document** names every machine, server, and app. A plant package supplies that file and calls the SCADA projection for each target cluster. `readDocument(text, load)` parses the YAML subset: maps, lists, and scalars. `include` lists other yaml files the reader loads through `load`. Those files merge in: maps and namespace trees combine, listed servers replace, profiles deep-merge, and a `null` app drops that app.

A **release** is one Helm install of `charts/scada` into one cluster. `releases(document, cluster)` cuts the system document down to the values of that cluster. One release never describes a second cluster.

The chart passes extra machine settings through to the plant process.

## System document

A server has four parts. Each part is optional.

| Part | What it answers |
|---|---|
| `ownership` | Object paths whose state this server owns. Listing a path here informs release projection and flow validation. Configure state replication and write coordination for your deployment. |
| `fan_in` | one flow into this server. It has no state |
| `fan_out` | one flow out of this server |
| `api` | services other servers may call. `plant` is the plant HTTP API. `bus` is the message bus those servers open. A bus url carries no password. A panel that only the local HMI uses is not an api |

An API can also declare `publishes`, a list of stream records such as
`{ name: mill/unit/status, contract: events }`. The name is a namespace path
or pattern. The application interprets the contract. These streams are available
to outgoing links and subscriptions to that API without starting a collector.

Telemetry in `fan_in` has no state. `ownership` is state this server edits. A server may omit any part.

A flow has two fields, plus `mapping` when a device publishes several parameters. One flow has one name. Several names are several flows.

| Field | On `fan_in` | On `fan_out` |
|---|---|---|
| `from` | a server id or one device address. A collector nickname is not a server. The address includes the line settings and the identity of that one device. A register window is `?at=1280&count=30`. A pattern in `name` is allowed only when every match is that same device | this server, so the field is omitted |
| `mapping` | a point map, or the id of one in `mappings`. A key is a parameter id. The value is that parameter's point on the device: a register, an OPC UA node, or a column. Omitted for a server, and for a parameter that is the whole reading. An unknown id is an error. A key that is not under `name` is an error | omitted |
| `name` | path of one parameter, or of a group that stands for every parameter under it. The object is the namespace node listed in `objects`. The object path alone is an error. `*` matches any remainder of the path, including `/`. A `fan_out` name keeps streams this server already has and does not add names from the rest of the namespace. `{a,b}` lists alternatives for one segment. Brace groups in one path expand together. A fixed `from` applies to every expanded name | the same path |
| `to` | this server, so the field is omitted | the server that receives the flow |

Flows differ. A place and a list of fed machines are not fields of a flow. `from` is only the address. `mapping` is only the point map. Neither key shares its handler with the other.

### Templates

`templates` names a reusable node list. The key is the name. The value is the list. A template is names only: an entry has an `id` and, when it is a group, `nodes`. It has no address and no point.

A namespace node with `template` takes that list as its children. Its own `nodes` patch the list. A node with no `template` is not a patch: its `nodes` are the children. A template name that is missing is an error.

| Patch | Effect |
|---|---|
| id the list does not have | added |
| `enabled: false` on an id the list has | removed |
| `enabled: false` on an id the list lacks | not added |
| any other entry | stays; its `nodes`, if present, patch the children the same way |

The same id twice in one patch is an error.

```yaml
templates:
  unit:
    - id: electrical
      nodes:
        - id: voltage
        - id: step
```

```yaml
- id: unit-2
  template: unit
  nodes:
    - id: rotation_on
    - id: electrical
      nodes:
        - id: step
          enabled: false
```

That patch adds `rotation_on`, keeps `voltage`, and removes `step`. A mapping key has to name a path that remains.

### Mappings

`mappings` is a catalog of point maps. A flow `mapping` is an inline map, or an id in that catalog. Several flows may share one id. The point map is not part of the name tree.

A key is a parameter id under the flow `name`. The joined path is `name` + `/` + key, and that path must be in the namespace. The value is the point on that device: a register, an OPC UA node, or a column. Omit `mapping` on a server-to-server flow, and when the parameter is the whole reading. An unknown id is an error. A key that is not under `name` is an error.

```yaml
mappings:
  drive:
    voltage: holding:40001
    step: coil:1
```

```yaml
- from: modbus://192.0.2.11:502
  mapping: drive
  name: mill/hall/unit-2/electrical
```

`voltage` is `mill/hall/unit-2/electrical/voltage`. The inline form is the same map in place of the id `drive`. The mill document below takes `unit` as-is and names `drive` on each device flow. Flows whose `from` is a server omit `mapping`.

`modbus-to-mqtt` publishes each holding point as MQTT JSON `{ts, value}` on that document path. The number in `holding:<pdu>` is the PDU address, the same scale as `?at=`. `:abcd` and `:cdab` select a float32 word order. A bare `holding:<pdu>` is one uint16. The poll window is `?at=` and `count` on the address, or the span of the holding points when those are omitted. One process shares one window. `coil:` stays a document point and is not read by this collector. Chart `collectors[].mapping` must already be these holding points. A plant driver may rewrite local nicknames before it writes values.

`namespace` is the name tree. A name has an `id`. Nested names are `nodes`. A node that has children is a group. A flow may name the group instead of each leaf. The leaf is the parameter. The object may be an ancestor of that leaf. `objects` lists the state this server holds. An entry is a path of ids from the root, joined by `/`. The same path can appear on more than one server. The deployment supplies the state replication and write coordination. Title, kind, and place are not object fields. This document does not yet list the state fields themselves.

```yaml
templates:
  unit:
    - id: electrical
      nodes:
        - id: voltage
        - id: step
mappings:
  drive:
    voltage: holding:40001
    step: coil:1
namespace:
  - id: mill
    nodes:
      - id: hall
        nodes:
          - id: unit-1
            template: unit
          - id: unit-2
            template: unit
servers:
  - id: cell-b
    fan_in:
      - from: modbus://192.0.2.11:502
        mapping: drive
        name: mill/hall/unit-2/electrical
    fan_out:
      - to: cell-a
        name: mill/hall/unit-2/electrical
      - to: archive
        name: mill/hall/unit-2/electrical
    api:
      - id: plant
        url: http://192.0.2.11:30300/api/v1
    objects:
      - mill/hall/unit-2
    profile:
      id: cell
      variables:
        cluster: cell-b
  - id: cell-a
    fan_in:
      - from: modbus://192.0.2.10:502
        mapping: drive
        name: mill/hall/unit-1/electrical
      - from: cell-b
        api: plant
        name: mill/hall/unit-2/electrical
    fan_out:
      - to: archive
        name: mill/hall/unit-1/electrical
    api:
      - id: plant
        url: http://192.0.2.10:30300/api/v1
      - id: bus
        url: amqp://192.0.2.10:5672
    objects:
      - mill/hall/unit-1
    profile:
      id: cell
      variables:
        cluster: cell-a
    service: { nodePort: 30300 }
  - id: archive
    api:
      - id: bus
        url: amqp://192.0.2.12:5672
    fan_in:
      - from: cell-a
        api: plant
        name: mill/hall/unit-1/electrical
      - from: cell-b
        api: plant
        name: mill/hall/unit-2/electrical
    profile:
      id: archive
      variables:
        cluster: archive
# Profiles can be shared by multiple servers.
profiles:
  cell:
    variables:
      cluster: null
    command: ["node", "bin/edge-site.js"]
    modules:
      state_store: { enabled: true }
      message_bus: { enabled: true }
      telemetry_store: { enabled: false }
    apps:
      scada:
        image: example.invalid/plant:1
  archive:
    variables:
      cluster: null
    command: ["node", "bin/central-site.js"]
    modules:
      state_store: { enabled: true }
      message_bus: { enabled: true }
      telemetry_store: { enabled: true }
    apps:
      scada:
        image: example.invalid/plant:1
        secret: scada-postgres
      frontend:
        image: example.invalid/frontend:1
        url: https://mill.example
  cell-external:
    extends: cell
    apps:
      frontend:
        image: example.invalid/frontend:1
        nodePort: 30080
```

`mill/hall/unit-1` is three levels. Two names share a parent when their paths share a prefix. An empty segment is an error. A path that is not in `namespace` is an error.

`objects` holds the namespace nodes whose state this server keeps. The chart copies a record through when a flow names its id. A collector is such a record. A flow's `from` may name that collector.

`fan_in`, `fan_out`, and `api` name servers, sources, and one object id. They do not name databases. An unknown server id is an error. An object in `fan_out` or in a server-to-server `fan_in` must already be telemetry or ownership on that source server, or arrive there by another fan-in. Following `fan_out` for one object must not return to a server already visited. Several servers may list the same object in `ownership`, allowing the projection to validate flow from those owners. One side of an edge is enough: `cell-b.fan_out` to `cell-a` and `cell-a.fan_in` from `cell-b` are the same edge. When both sides are present, the object sets must match. `fan_in`, `fan_out`, and `objects` accept `*` and `{a,b}` in a name, a server id, or an object path. `*` matches any remainder of the path, including `/`. A `fan_out` name keeps streams this server already has and does not add names from the rest of the namespace. `{a,b}` lists alternatives for one segment, and brace groups in one path expand together. A fixed `from` applies to every expanded name. A pattern selects paths and servers that already exist. It does not pair every matching server with every matching name. `from: cell-*` with `name: mill/hall/*/electrical` takes, from each matching server, the outgoing names that match the name. An object pattern expands to the namespace paths it fits. `fan_in.api` selects a service of the source when that source publishes one. It is required when the source provides more than one service. A source that publishes no api is not called. Its telemetry still arrives by `fan_out`.

Profile:

| Field | Where | What it decides |
|---|---|---|
| `profile.id` | server | profile name. Unknown name is an error |
| `variables` | profile | values a server may override. `cluster` selects the release. One Helm release, one cluster |
| `profile.variables` | server | overrides of that profile |
| `service` | server | how an API is published, for example `nodePort` |
| `command` | profile | argv of the site process |
| `modules.*` | profile | `enabled: false` installs nothing. Unknown module name is an error |
| `state_store` | module | durable records: timeline, alerts, segments. Enabled installs Postgres |
| `message_bus` | module | alerts, segments, telemetry, operations, and decisions. Enabled installs RabbitMQ. The same broker serves MQTT |
| `telemetry_store` | module | time-series measurements. Enabled installs ClickHouse |
| `extends` | profile | parent profile. The child keeps the parent's modules, command, variables, and apps. A child app id adds or replaces that one app. A child command replaces the command |
| `apps` | profile | processes this profile runs besides the modules |
| `apps.*.image` | app | image of that process |
| `apps.*.secret` | app | Secret name. The password is not a field of this document |
| `apps.*.url` | app | published address, when the app has one name for the whole profile |
| `apps.*.nodePort` | app | port on every server of this profile. The host is that server |

The document does not choose how many processes run or how they are replicated. The driver does. `apps` are the applications the user adds. Tag catalogs, cycle phases, and reports are not fields of this document.

`releases(document, cluster)` joins the selected server with its profile and returns that scada release plus the other apps of that profile. A `cluster` that matches no `profile.variables.cluster` is an error. Passwords are not fields of this document.

Scada projection:

| System document | Release values |
|---|---|
| `profile.apps.scada.image` | `image` |
| `profile.command` | `command` |
| `profile.modules.state_store` | `postgres` |
| `profile.modules.message_bus` | `rabbitmq` |
| `profile.modules.telemetry_store` | `clickhouse` |
| `profile.env` | `env` |
| `fan_in` whose `from` is not a server, joined with that server's `objects` | `machines` |
| `fan_in` whose `from` is a server, plus `fan_out` edges aimed at this server | `sites` entries `{ baseUrl, machines }`. `baseUrl` is the selected source API. A source with no api is skipped |
| `profile.apps.scada.secret` | `postgres.secret` |
| `profile.apps.scada.pullSecret` | `pullSecret` |
| `service` | `service` |

`fan_out` is not repeated on the sender's release. The receiver's `sites` list is the edge. `sites.baseUrl` is the source `plant` API. A `bus` API is the address a `fan_out` opens on another cluster. An app other than `scada` is emitted as `{ name, image, url, nodePort, schedule }` and is not rendered by this chart.

```bash
helm upgrade --install cell-a charts/scada \
  --namespace scada \
  --create-namespace \
  -f cell-a.yaml
```

`image` is required on the release. The release name becomes the DNS prefix: `cell-a-site-server`, `cell-a-supervisor-sink`, `cell-a-postgres`, `cell-a-rabbitmq`, `cell-a-clickhouse`, and `cell-a-collector-<command>` when collectors are set. The file passed to Helm is the release values below, not the system document.

## What a profile installs

The profile is implementation. It decides which modules exist. Local fan-in is the telemetry the release publishes as `machines`. Fan-in from another server becomes `sites`. Ownership is editable state and is not copied into `machines`.

Empty `machines` omits `EDGE_MACHINES`. Empty `sites` omits `EDGE_SITES`. A process that falls back to a baked-in plant profile then sees the whole plant. Set ownership and fan-in when the release must not use that fallback.

## Deploy a node with named processes

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
For a single-node storage cutover, `preflightKubeStorage(plan, action)` checks
the selected node, required Secret keys, live data mounts and the PVC/PV
identities. It compares the preserved StatefulSets' rendered pod templates
with the live API through a server dry-run.
`applyWhenChanged(execute)` can wrap the stage executor so kubectl applies only
when its diff reports a change.

Use `prepareKubePrerequisites(plan, action)` to create missing resources on
a verified node. Declare the namespaces, resource order, allowed Secret targets
and required keys in the plan. An optional `copyFrom` points to an earlier
Secret declaration and fills only a missing Secret at the destination.
`executeKubeSeed(plan, execute)` checks the target node and verifies that
application writers are stopped both before and after bounded exports. The
application supplies the commands and the allowlist of infrastructure pods
that can be running during the import.

Use `postgresMaintenancePlan(target, backupId, attempt)` to configure a backup
against a specific context, namespace, node, pod and claim. Supply the
PostgreSQL database and image user, backup path, scratch storage class and size,
and restore-job ownership labels. Pass this plan to
`operatePostgresMaintenance(plan, action)` for status, backup or verification.
Backup operation IDs identify immutable, checksummed dumps. A verification job
uses the running database image digest, mounts the backup read-only and runs
PostgreSQL in isolated scratch storage. Optional `verificationSql` is trusted
application configuration and must return one JSON object for the result.

The RabbitMQ definitions builder and management reconciler are exported as
`@yarkivaev/scada/rabbitmq/definitions` and `@yarkivaev/scada/rabbitmq/reconcile`.
The caller supplies the vhost, connection settings and ownership policy for
retired routes. Reconciliation retains stored queues.

## Per-server module configuration

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

## Outside this DSL

This chart does not create the Kubernetes cluster, choose how many nodes it has, or install ingress, storage class, or a remote shovel. Another app is a key under `apps` with its own `chart` and `values`. `releases` hands those values through. This chart does not render them.

The running site process still selects one migration set with `SINK_DB_PROFILE`. This document can describe a server that both sends and receives, and `releases` emits both `machines` and `sites` for it. The process does not yet apply two migration sets on that server. Several servers may own one object. The process does not yet choose which member of that set serves a request.


## Values

[View Helm values](reference/helm-values.md).

## Broker topology

[View the broker topology](reference/helm-values.md#broker-topology).

## Release values

[View release examples](reference/helm-values.md#release-values).

## Adopting existing Kubernetes resources

[Follow the adoption guide](operations/upgrades.md#adopting-existing-kubernetes-resources).

---

← [Helm installation](install/helm.md) · [Architecture](architecture/README.md) →
