[Documentation](../README.md) / [Installation](README.md)

# Configuration options

The site, collector, controller and Supervisor each read their own settings. Choose the configuration surface that matches how you start the process.

| Process | Runtime configuration | Deployment configuration |
| --- | --- | --- |
| Site and supervisor-sink | [Environment variables](../reference/environment.md) and the plant application's JavaScript configuration | [Helm values](../reference/helm-values.md) |
| Collector | [Local manifest](../collect/runtime.md#run-from-a-manifest) or [controller assignment](../collect/edge-controller.md#configure-controller-and-agents) | Named processes and device mappings in the [system document](../deploy.md) |
| Stream processor | [HOCON and runtime options](../../stream-processing/README.md#build-and-run) | A named process or a plant-managed workload |
| Edge controller | [etcd endpoints and credentials](../collect/edge-controller.md#configure-controller-and-agents) | Controller and etcd configuration in the plant's deployment |

## Choose where collector assignments come from

When `COLLECTOR_CONTROL_ENDPOINTS` is configured, the collector starts in managed mode and restores its saved assignment before reconciling with the controller. For local manifest mode, leave the control endpoints unset.

The collector resolves the local manifest in this order.

1. Inline JSON from `COLLECTOR_MANIFEST`.
2. The path passed to `scada-collector`, or standard input if the argument is `-`.
3. The path in `COLLECTOR_MANIFEST_PATH`.

Keep connection secrets in the process environment or use the deployment's Secret references. An assignment can refer to a runtime secret with an object such as `{"$secret":"AMQP_URL"}`.

## Configure a site image

Provide a plant image that wires the plant model and routes into `siteServer`. Use the system document for plant topology and stream mappings. Project one configuration per cluster with `releases(document, cluster)`, then give Helm the resulting values. See [Helm installation](helm.md).

---

← [Requirements](requirements.md) · [Helm installation](helm.md) →
