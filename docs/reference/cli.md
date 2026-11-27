[Documentation](../README.md) / [Reference](README.md)

# CLI tools

Use Node.js 22 or later for the npm package and JDK 21 for the Scala classifier.

| Entrypoint | Role |
| --- | --- |
| `scada` | Inspects and reconciles SCADA contexts over the management API. |
| `scada-collector` | Runs collection tasks from a manifest or controller assignment. |
| `scada-controller` | Places collector tasks through etcd. |
| `supervisor-sink` | Consumes STOMP events, writes PostgreSQL state and serves the internal state API. |
| `modbus-to-mqtt` | Polls Modbus and publishes the configured `STREAM` and `MAPPING` paths. |
| `java -jar scada-stream-processing.jar` | Classifies readings, restores history and publishes segments. |
| Plant Node.js entrypoint | Composes `siteServer` with the plant model, sensors and routes. |

## Manage SCADA from a workstation

Install `@yarkivaev/scada` in the management host's project before using
`npx scada`. From a source checkout, run `npm ci` and invoke
`node src/bin/scada.js` in place of `npx scada`. Run the service where it
can reach the runtimes. Put the inventory, kubeconfigs, release files and
runtime credentials on that host.
For systemd nodes on other hosts, run a service on each node and add a
`remote` context to the central service. A context is an operator-chosen name
for one managed target. It can represent a site, a cluster release, or a node.

Save an inventory such as `management.json` on the management host.

```json
{
  "contexts": {
    "plant": {
      "runtime": "kubernetes",
      "kubeContext": "plant-k3s",
      "namespace": "scada",
      "release": "plant",
      "values": "release-values.yaml"
    },
    "gateway": {
      "runtime": "systemd",
      "units": { "scada-collector.service": "running" }
    },
    "remote-edge": {
      "runtime": "remote",
      "server": "https://edge.example.net:8443",
      "context": "gateway",
      "tokenEnv": "EDGE_MANAGEMENT_TOKEN"
    }
  }
}
```

Set `SCADA_TOKEN` on the service for read and write access, or set
`SCADA_READ_TOKEN` for a read-only credential. Use separate values when setting
both. The `remote` driver resolves the configured token environment variable on
the central service. An upstream read-only token gives that context read-only
access even when the client uses a write token. Each forwarded command addresses
a concrete runtime on the next service.

On the management host, pass a certificate trusted by the workstation, along
with the matching private key. For a local reverse proxy that terminates TLS,
omit both flags and keep the default loopback listener. Network listeners
require TLS. Numeric loopback listeners also support direct HTTP for development.

```sh
npx scada serve --config management.json --host 0.0.0.0 --port 8443 \
  --cert /run/scada/tls/fullchain.pem --key /run/scada/tls/key.pem
```

On macOS, install the package with Node.js 22 or later. Set `SCADA_TOKEN` to
the credential you received and set the API origin. For a private CA, set
`NODE_EXTRA_CA_CERTS` to its PEM before starting the CLI.

```sh
export SCADA_SERVER=https://scada.example.net:8443
npx scada contexts
npx scada status
npx scada get components --context plant --output json
npx scada logs deployment/plant-site-server --context plant --tail 100
npx scada plan --context plant
npx scada apply --context plant
```

### Production topology

To make `scada status` a production overview, add the plant's existing
[system document](../deploy.md) to the gateway inventory. The gateway expands
its includes, namespaces, templates and routes. A server in the document maps
to a management context with the same name by default. Use `system.sites` to
bind a server to one or more contexts when the names or deployment units differ.

```json
{
  "system": {
    "file": "plant/plant.yaml",
    "sites": { "cell-a": ["cell-a-runtime", "cell-a-collector"] }
  }
}
```

The overview starts with the production hierarchy, followed by the logical
sites, their objects, and the configured flows between them. The text view
shows the first three namespace levels and counts streams per flow.
`scada status --output json` includes all namespace and stream paths. To focus
on one site, pass its name or a bound context as `--context`. This also keeps
the flows entering or leaving the selected site in view.

A site is `ready` when every bound context reports ready components,
`degraded` when a context reports an unhealthy component, and `unknown` when
readiness cannot be established. A site without an adapter binding remains in
the overview as `unknown`. Site
readiness comes from runtime observations. The flow section includes recent
acknowledgements when an observation source is configured. Runtime component
details remain available through
`scada get components`. Older gateways and inventories without a system
document retain the component status view.

| Command | Behavior |
| --- | --- |
| `contexts` | Lists configured targets and their runtime types. |
| `get components` | Lists components in one target or across the inventory and reports per-target errors. |
| `status` | Shows production topology, site health and observed flow activity. Exits with code 1 when the selected site readiness is unknown or degraded. |
| `load` | Shows queue pressure and optional metrics by site and source. Use `--context` with a site or source name. Exits with code 1 if a configured observation fails. |
| `logs` | Returns a snapshot of up to 1,000 lines. Kubernetes uses the pod chosen by `kubectl logs` for the specified workload. systemd uses the unit journal. |
| `plan` | Checks the configured desired state for one explicit target. |
| `apply` | Reconciles one explicit target with the configured desired state. Requires a write credential. |

Kubernetes lists Deployments, StatefulSets, DaemonSets and Jobs carrying the
packaged chart's SCADA name and release labels by default. Set a context's
`workloads` to an exact list such as `["deployment/site-server","statefulset/db"]`
to observe those workload names directly inside its namespace. An expected
workload that is absent is marked `failed`. A context with explicit `workloads`
can omit `release` when it is used only for inspection. Set the management service's
`KUBECONFIG` and install kubectl and Helm on that host. Grant the Kubernetes
identity access to those workloads and pod logs. For reconciliation, use
credentials scoped by Kubernetes RBAC to the resources the release is allowed
to change. The chart can contain administrator-supplied extra objects, including
cluster-scoped resources.
For a Helm-managed release, point `values` at the projected Helm values file.
`plan` runs a Helm server dry-run and `apply` runs an atomic Helm upgrade/install.
Create the namespace and any external prerequisites before applying.

For a release managed through server-side apply, use `releasePlan` in place of
`values`. Its JSON file contains a `values` object and the existing
`fieldManager`, plus optional `prerequisites`, `workloads`, `retirements` and
`podsAbsentBeforeApply` from the [release executor](../deploy.md#deploy-a-node-with-named-processes).
The gateway supplies the configured context, namespace, release and bundled
chart. The executor validates the release during `plan` and runs its preflight
before mutation during `apply`. Plant-specific hooks and ordered multi-release
upgrades continue to use the plant's deployment tooling. Omit both file fields
for a Kubernetes target that only needs inspection.

For systemd, install the units before starting the management service and grant
its account permission to read their state and journals and to start the managed
units. `plan` lists the units that need to start. `apply` starts those units and
can be retried after a partial failure. Relative system and release file paths resolve
against the inventory directory. Changes to those files are read by each
reconcile command. Restart the service to load inventory changes.

### Queue pressure and flow activity

Configure monitoring sources in the gateway inventory. The following fields
can be added alongside `contexts` and `system`.

```json
{
  "observations": {
    "rabbitmq": {
      "cell-broker": {
        "site": "cell",
        "url": "https://rabbit.example.net",
        "vhost": "/",
        "prefix": "scada.",
        "username": "scada-observer",
        "passwordEnv": "CELL_RABBITMQ_PASSWORD"
      }
    },
    "links": [
      {
        "from": "cell",
        "to": "archive",
        "broker": "cell-broker",
        "queue": "scada.outbox",
        "stream": "mill/hall/unit/speed"
      }
    ],
    "prometheus": {
      "archive-disks": {
        "site": "archive",
        "url": "https://prometheus.example.net",
        "metrics": [
          {"name": "node-load", "query": "node_load1", "unit": "load average", "resourceLabel": "instance"}
        ]
      }
    },
    "control": {
      "collector-quorum": {"site": "cell", "envPrefix": "CONTROL", "keyPrefix": "/scada/control"}
    }
  }
}
```

`scada load` shows ready and unacknowledged messages, consumers, bytes, publish
rate and acknowledgement rate. It totals queue depth per broker and lists the
largest queues first. The optional prefix limits the set of queues sampled.
An empty metric field is displayed as `?`. A Prometheus source runs configured
instant queries and can label each result by node, volume or another resource.
Set `tokenEnv` for bearer authentication. A controller source reads the existing
quorum store using the specified environment prefix, such as `CONTROL_ENDPOINTS`
and `CONTROL_USERNAME`. Use a read-only account for that key prefix. The result
contains desired assignment counts, assigned cost and node capacity.

Bind a route only to a dedicated source queue whose consumer acknowledges after
the destination broker confirms. The flow section shows `flowing` for a positive
acknowledgement rate, `idle` for a reported zero rate and `unknown` when suitable
evidence is absent. The gateway uses the queue rate only when the broker reports
exactly one consumer. Set `stream` only for a queue serving that specific stream.
Omit it when a queue carries several streams. An additional runtime route can
be observed between two declared sites even when the system document omits that
route. Rates describe the broker's sampling interval. Destination broker
confirmation and downstream application processing are separate observations.

For queue measurements, see the [RabbitMQ monitoring reference](https://www.rabbitmq.com/docs/monitoring)
and [Shovel acknowledgement modes](https://www.rabbitmq.com/docs/shovel-dynamic).
For other metrics, see [Prometheus instant queries](https://prometheus.io/docs/prometheus/latest/querying/api/#instant-queries).

### Management API

The client and forwarding runtime use `POST /api/management/v1/command`
with `Authorization: Bearer <token>` and a JSON request. The same interface
can be implemented for additional runtimes and added as a `remote` context.

| Request JSON | Success body |
| --- | --- |
| `{"action":"contexts"}` | `{contexts:[{name,runtime}]}` |
| `{"action":"status"}` | `{topology:{state,namespace,sites,flows}}` for a configured system, or the component response for an inventory without a system document. |
| `{"action":"load"}` | `{load:{brokers,metrics}}` with observations grouped by site and source. |
| `{"action":"components","context":"plant"}` | `{contexts:[{name,components:[{id,state}]}]}` |
| `{"action":"logs","context":"plant","component":"deployment/plant-site-server","tail":100}` | `{logs:"..."}` |
| `{"action":"plan","context":"plant"}` or `{"action":"apply","context":"plant"}` | `{changes:[{id,action}]}` |

Omit `context` from `components` to query the complete inventory. An
unavailable target is returned as `{name,error}`. Component state is one of
`ready`, `stopped`, `pending` or `failed`. Other command failures use a 4xx HTTP
status and an `{error}` body. A forwarding service sets `forwarded: true` on
the request to the target to bound forwarding to one hop.

## Run a collector assignment

```sh
npx scada-collector manifest.json
```

Pass `-` to read a manifest from stdin. See [local manifests](../collect/runtime.md#run-from-a-manifest) and [controller assignments](../collect/edge-controller.md#configure-controller-and-agents).

## Run the site API

The plant package supplies its site entrypoint. To launch the local example, follow the [quick-start guide](../quick-start.md).

## Run classification and persistence

Build and check the classifier with the [Stream processing guide](../../stream-processing/README.md). For the state sink and standalone Modbus publisher, see [environment variables](environment.md) and [Modbus mappings](../deploy.md#mappings).

---

← [Reference](README.md) · [Environment variables](environment.md) →
