[Documentation](../README.md) / [Installation](README.md)

# Helm installation

Use Helm to render or install the SCADA chart. The commands below run from a checkout of a released SCADA version.

## Prepare the release values

Use a plant package's deployment tooling to project a system document with `releases(document, cluster)`, or write the chart values directly. Supply the plant image via `image` and set `command` when the image entrypoint needs an override.

Set the command to the plant entrypoint in your image.

```yaml
image: example.invalid/plant:1
command: ["node", "bin/edge-site.js"]
```

Use [release examples](../reference/helm-values.md#release-values) as a starting point. Configure [database migrations](../operations/database-migrations.md) and [broker credentials](../operations/broker-credentials.md) before deploying.

Configure the classifier image and its HOCON through the plant deployment. The chart supports additional workloads under `processes`. See [named processes](../deploy.md#deploy-a-node-with-named-processes).

## Render and review

Replace the release name `scada`, namespace `plant` and values file `release-values.yaml` with your own.

```sh
helm template scada ./charts/scada --namespace plant --values release-values.yaml
```

Review the workload images, environment, Secret references and volume claims. Use the same reviewed values file to install the release.

## Install a new release

For a new installation, use your intended context and an existing namespace. Replace `plant-context` with your Kubernetes context.

```sh
helm install scada ./charts/scada --kube-context plant-context --namespace plant --values release-values.yaml
```

## Verify the workloads

Inspect the deployed pods and check that the expected site, state sink and any configured classifier workloads become ready. If a workload stays unready, follow [Troubleshooting](../operations/troubleshooting.md).

```sh
kubectl --context plant-context --namespace plant get deployments,pods
```

For an existing Helm release, use `helm upgrade` with the same release name, context and namespace. For workloads that another deployment tool already owns, follow [adoption and upgrades](../operations/upgrades.md#adopting-existing-kubernetes-resources).

---

← [Configuration options](configuration.md) · [Deployment configuration](../deploy.md) →
