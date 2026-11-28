[Documentation](../README.md) / [Installation](README.md)

# Requirements

Choose a deployment before provisioning storage or credentials.

| Deployment | Prepare |
| --- | --- |
| Local API example | Node.js 22+ and npm |
| Edge site | Plant image, PostgreSQL, and RabbitMQ for broker-backed ingestion |
| Central metrics site | Plant image and ClickHouse for metrics, with PostgreSQL and RabbitMQ for enabled state and ingest paths |
| Managed collector placement | Collector nodes, controller replicas, and a reachable etcd cluster |

## npm package

Use Node.js 22 or later and ES modules. Create a plant object and supply the sensors, routes and translations for your installation.

## Kubernetes deployment

Install Helm on the machine that applies the release. Prepare a Kubernetes context and namespace and a plant application image. The SCADA chart runs that image for the site, state sink and legacy collector workloads. Configure Stream Worker as a named process with its own image and command, or deploy it separately. Provision persistent volumes for enabled datastores, or configure external services.

| Component | Required for |
| --- | --- |
| PostgreSQL | State persistence and the edge metrics profile |
| RabbitMQ | Broker-backed collection and event ingestion |
| ClickHouse | Central metrics storage |
| etcd | Placement of collector assignments with the optional edge controller |

## Stream Worker hosts

Use JDK 21 to build and run the classifier JAR. Give the workload access to its telemetry source, broker destinations and configured checkpoint API. Plant images can bundle the JAR with a profile. See [Stream processing](../../stream-processing/README.md).

## Collector hosts

Give each host network access to its configured sources and destinations. For serial tasks, make the local device available to the collector and pin the task to that host. Provision a persistent volume for saved assignments and another suitable directory for any enabled delivery spool. Keep controller and collector clocks within the configured skew budget.

See [Database migrations](../operations/database-migrations.md) for database startup requirements and [Helm installation](helm.md) for chart preparation.

---

← [Installation](README.md) · [Configuration options](configuration.md) →
