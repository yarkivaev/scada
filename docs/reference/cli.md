[Documentation](../README.md) / [Reference](README.md)

# CLI tools

Use Node.js 22 or later for the npm package and JDK 21 for the Scala classifier.

| Entrypoint | Role |
| --- | --- |
| `scada-collector` | Runs collection tasks from a manifest or controller assignment. |
| `scada-controller` | Places collector tasks through etcd. |
| `supervisor-sink` | Consumes STOMP events, writes PostgreSQL state and serves the internal state API. |
| `modbus-to-mqtt` | Polls Modbus and publishes the configured `STREAM` and `MAPPING` paths. |
| `java -jar scada-supervisor-engine.jar` | Classifies readings, restores history and publishes segments. |
| Plant Node.js entrypoint | Composes `siteServer` with the plant model, sensors and routes. |

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
