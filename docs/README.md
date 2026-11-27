[Repository](../README.md)

# SCADA documentation

## What is SCADA?

SCADA provides the services a plant application needs to collect device readings, keep operational history and serve current state to clients. The plant application supplies the equipment model, device mappings and rules. SCADA supplies the collector runtime, Scala Supervisor engine, state sink and APIs.

Use `scada-collector` to run collection tasks. Use the [Supervisor engine](../supervisor-engine/README.md) to process readings into segments and [Helm](install/helm.md) to deploy the configured workloads.

A plant typically runs a site at the edge, close to its equipment. Collectors read devices and send their data to the site or a central destination. A central site can serve metric history across multiple plants. An optional edge controller assigns collector tasks to nodes.

| Goal | Start here |
| --- | --- |
| Try a local plant API with one simulated machine | [Quick-start guide](quick-start.md) |
| Deploy a plant image and configure its services | [Helm installation](install/helm.md) |
| Run collectors on separate nodes | [Collector runtime](collect/runtime.md) |
| Classify readings and replay history | [Supervisor engine](../supervisor-engine/README.md) |
| Find the command and its inputs | [CLI tools](reference/cli.md) |
| Design for controller, collector and Supervisor failures | [High availability](architecture/high-availability.md) |

## [Quick-start guide](quick-start.md)

Install the package, start a plant with one simulated machine and query its current state.

## [Installation](install/README.md)

Choose between integrating the npm package and deploying a plant application with the SCADA Helm chart.

- [Requirements](install/requirements.md)
- [Configuration options](install/configuration.md)
- [Helm installation](install/helm.md)
- [Deployment configuration](deploy.md)

## [Architecture](architecture/README.md)

Understand the runtime components, data flow and boundaries between SCADA and plant packages.

- [Data flow](architecture/data-flow.md)
- [High availability](architecture/high-availability.md)
- [Package boundary](architecture/package-boundary.md)
- [Source layout](architecture/source-layout.md)
- [Supervisor engine](../supervisor-engine/README.md)

## [Data collection](collect/README.md)

Configure collector tasks, connect devices and operate durable delivery.

- [Collector runtime](collect/runtime.md)
- [OPC UA collection](collect/opc-ua.md)
- [Edge assignment controller](collect/edge-controller.md)
- [Durable delivery](collect/durable-delivery.md)
- [Stream adapters](../src/infrastructure/streams/README.md)

## [Operations](operations/README.md)

Manage storage, upgrades, credentials and recovery.

- [Database migrations](operations/database-migrations.md)
- [Broker credentials](operations/broker-credentials.md)
- [Upgrades and adoption](operations/upgrades.md)
- [Troubleshooting](operations/troubleshooting.md)

## [Reference](reference/README.md)

Look up configuration keys, JavaScript exports and persistence contracts.

- [CLI tools](reference/cli.md)
- [Environment variables](reference/environment.md)
- [Helm values](reference/helm-values.md)
- [JavaScript API](reference/javascript-api.md)
- [Analytics MCP](reference/analytics-mcp.md)
- [Export and site sync](reference/export-and-sync.md)
- [Central telemetry](reference/central-telemetry.md)
- [Edge telemetry and history](reference/edge-history.md)
- [Timeline persistence](reference/timeline-persistence.md)

## [Contributing](contributing.md)

Develop and verify SCADA changes in the repository.

---

[Quick-start guide](quick-start.md) →
