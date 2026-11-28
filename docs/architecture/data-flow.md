[Documentation](../README.md) / [Architecture](README.md)

# Data flow

## Components and responsibilities

| Component | Runs where | Responsibility |
| --- | --- | --- |
| Site server (`siteServer`) | Plant application process | Serves plant routes and can run the edge HTTP interface and optional MQTT ingest. |
| [Stream processing](../../stream-processing/README.md) | Scala workload with a plant profile | Reads telemetry, produces segments and restores classifier history. |
| [State sink](README.md#state-sink) (`supervisor-sink`) | Site process or dedicated workload | Accepts fenced timeline writes over HTTP and ingests segment, decision and alert deliveries over STOMP. Persists state in PostgreSQL. |
| Agent (`scada-collector`) | Host or container with access to the source | Runs assigned device or stream tasks and delivers their output to configured destinations. |
| Controller (`scada-controller`) | Edge control deployment | Uses etcd to place collector tasks. Collectors read assignments and report progress. |

The plant entrypoint composes the site with its sensors and routes. The collector uses a local manifest or a saved controller assignment. A plant can deploy the classifier as a separate Scala workload with its own configuration.

## Deployment models

### One edge site

Keep collection, the message broker, PostgreSQL and the plant API near the equipment. Run collectors alongside the site or on hosts attached to the devices. Plant clients query the edge API. Choose this model when the site needs to continue operating during a loss of central connectivity.

### Edge sites with a central archive

Keep plant state at the edge. Forward selected telemetry to central ingestion and store central metrics in ClickHouse. Treat the central route and the local route as separate delivery destinations. A central broker confirmation does not confirm delivery to the local history receiver.

### Multiple collector nodes with edge control

Deploy etcd and the controller when task placement should move between eligible nodes. Pin work that requires a physical device to its host. If etcd loses quorum, new placement pauses and existing collectors can continue their in-memory assignments. See [Edge assignment controller](../collect/edge-controller.md).

### Replicated processing

With prepared Stream Worker candidates on different edge nodes, a shared writer lease coordinates ownership per machine. A worker can resume historical correction from the durable cursor and checkpoint. See [High availability](high-availability.md#replicated-stream-processing-and-history-workers).

## Classification and historical correction

1. A collector reads a device or stream and publishes readings to the configured broker or sink.
2. The stream processor maps readings to machine parameters and emits timeline segments. Configuration selects the live source and the historical processing path.
3. The worker sends timeline writes to the state HTTP API. For v2 replication, PostgreSQL commits timeline changes and outbox entries together. The relay publishes them to RabbitMQ and replica sinks consume them over STOMP.
4. The site API serves measurements and state to consumers. Central archives can independently ingest selected raw readings into ClickHouse.

[Stream processing and history modes](../../stream-processing/README.md).

## Read path

```
ClickHouse ← mqttMetrics / amqpMetricsIngest
PostgreSQL ← STOMP alerts (via plantServer)
plantApi → REST + SSE → frontend / @yarkivaev/scada/client
```

`GET /api/v1/topology` returns `{ plant, nodes, links }` from `plant.topology()` or a shop/machine/sensor walk, then paints `status` from live `sensor.current()` freshness (`ok` / `degraded` / `down`). Nodes without a matching sensor stay `unknown`. `GET /infra` serves a generic SVG of that graph. Optional node `inspect: { host, port }` is reached same-origin at `/infra/inspect/:id` (CDP `Host` is loopback).

## Write path

```
STOMP (`/queue/scada.segments.ingest`, `/exchange/scada.alerts`, `/exchange/scada.user_decisions`)
  → ingest/codecs → domain/segment → ingest/sinks → PostgreSQL
Stream Worker → edgeApi (:8081) → PostgreSQL timeline + outbox (v2)
PostgreSQL outbox → AMQP relay → RabbitMQ → replica state sink
edgeApi (:8081) ← metrics batch, checkpoints, retention (edge profile)
```

## Edge and central sites

`siteServer` combines the supervisor-sink HTTP interface and plant API, with optional MQTT ingest. Edge metrics go to PostgreSQL and central metrics go to ClickHouse.

---

← [Architecture](README.md) · [Package boundary](package-boundary.md) →
