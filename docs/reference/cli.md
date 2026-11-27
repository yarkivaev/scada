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
| `java -jar scada-supervisor-engine.jar` | Classifies readings, restores history and publishes segments. |
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

| Command | Behavior |
| --- | --- |
| `contexts` | Lists configured targets and their runtime types. |
| `get components` | Lists components in one target or across the inventory and reports per-target errors. |
| `status` | Lists the same inventory and exits with code 1 if any selected target is unreachable, empty or has a component that is pending, stopped or failed. |
| `logs` | Returns a snapshot of up to 1,000 lines. Kubernetes uses the pod chosen by `kubectl logs` for the specified workload. systemd uses the unit journal. |
| `plan` | Checks the configured desired state for one explicit target. |
| `apply` | Reconciles one explicit target with the configured desired state. Requires a write credential. |

Kubernetes lists Deployments, StatefulSets, DaemonSets and Jobs carrying the
packaged chart's SCADA name and release labels. Set the management service's
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
can be retried after a partial failure. Relative release file paths resolve
against the inventory directory. Changes to those files are read by each
reconcile command. Restart the service to load inventory changes.

### Management API

The client and forwarding runtime use `POST /api/management/v1/command`
with `Authorization: Bearer <token>` and a JSON request. The same interface
can be implemented for additional runtimes and added as a `remote` context.

| Request JSON | Success body |
| --- | --- |
| `{"action":"contexts"}` | `{contexts:[{name,runtime}]}` |
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

Build and check the classifier with the [Supervisor engine guide](../../supervisor-engine/README.md). For the state sink and standalone Modbus publisher, see [environment variables](environment.md) and [Modbus mappings](../deploy.md#mappings).

---

← [Reference](README.md) · [Environment variables](environment.md) →
