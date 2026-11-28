[Documentation](../README.md) / [Operations](README.md)

# Upgrades and adoption

## Prepare an upgrade

1. Identify the running plant image, Helm values, Kubernetes context and namespace.
2. Use an image built from the exact `main` commit whose required release checks passed.
3. Read the [migration procedure](database-migrations.md) for the selected database profile. For verify mode, apply migrations separately before updating workloads.
4. Render the new values and review resource names, selectors, persistent claims and Secret references. Include the previous and new collector assignments when checking physical-device ownership.
5. Apply the plant's release plan and check readiness before proceeding to dependent stages.

Use the following procedures to replace a reader or adopt resources already present in the cluster.

## Upgrade a classifier profile

Publish the shared engine version from a checked SCADA main commit before building a plant image that pins it. Verify the plant profile, segment messages and historical recovery against the new engine. Follow the plant release procedure to roll the classifier and preserve its durable state. See [Stream processing](../../stream-processing/README.md).

## Upgrade timeline replication to v2

1. Apply the [timeline migrations](database-migrations.md) and upgrade all replica consumers, including central consumers.
2. Stop the v1 live and history writers for the machine. Let the running relay drain its PostgreSQL outbox, then drain the v1 broker queues and in-flight deliveries.
3. Start a compatible state sink and worker together. Check that the authority can commit and relay new changes and that replica sinks can apply them.

See [edge history](../reference/edge-history.md#delivering-committed-segments-to-replicas) for configuration and delivery guarantees.

## Replace collectors

A release can replace old collectors using
`retirements: [{ workload: 'deployment/old-reader', selector: 'app=old-reader' }]`.
For apply/adopt, the executor validates the new manifests first, foreground-deletes
only these explicit Deployments, and verifies that no selected old pods remain
before applying the replacement. This trades a collection gap for no overlap.
The caller must bind each selector to its old Deployment; no namespace-wide prune
is performed. Render/check/diff do not delete anything. An optional process `image`
overrides the release image, so unrelated collectors can retain their pinned runtime.

## Ordered release stages

`executeStages(stages, action = 'render', execute?)` runs ordered generic release
plans. For `apply`/`adopt`, every stage is preflighted before the first mutation;
each rollout and `afterReady`/`beforeApply` gate must finish before the next stage.
Read-only actions do not invoke mutation gates. A plan may declare exact Deployment
`retirements: [{ workload: 'deployment/old-reader', selector: 'app=old-reader' }]`
and `podsAbsentBeforeApply` selectors to fence old readers before a replacement.
Retirement waits for foreground deletion and verifies no matching pods remain;
failures stop execution. Context, namespace and field manager remain explicit.

The application chart accepts existing PostgreSQL/RabbitMQ claims, secret-backed
environment values, `envFrom`, config volumes, probes and extra Kubernetes objects.
PostgreSQL honors the root `pullSecret`. Existing claims are referenced without
creating or deleting storage; plant packages supply their precise deployment values.

## Adopting existing Kubernetes resources

Before a first Helm adoption, compare the rendered manifest against live resources,
including container environment variables and volume mounts. Kubernetes merges
these lists by name or mount path. Switching an environment variable from `value`
to `valueFrom` requires explicitly removing the old `value`; otherwise StatefulSets
may accept a template that cannot create a valid Pod. Switching from a directory
mount to individual files also requires removing the old directory mount.

Keep RabbitMQ configuration as three individual ConfigMap `subPath` mounts.
For namespaces without surge quota, set the adopted Deployments' rolling update
strategy to `maxSurge: 0`, `maxUnavailable: 1` before rollout. Preserve existing
PVCs and immutable selectors. Back up the live specs and use an explicit context
and namespace for each operation.

---

← [Broker credentials](broker-credentials.md) · [Troubleshooting](troubleshooting.md) →
