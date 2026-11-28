[Documentation](../README.md) / [Data collection](README.md)

# Edge assignment controller

The edge controller places collector tasks on eligible nodes. Collectors retain assignments in memory and fetch them again after a restart.

Independent edge clusters run the etcd members and controller replicas declared by the deployment DSL; every collector embeds an assignment agent. Losing the control majority prevents new placement but leaves running assignments active. Serial tasks require a pinned node. Controller changes use etcd transactions comparing the leader value and lease.

See [High availability](../architecture/high-availability.md) for collector copies, quorum loss and the separate Supervisor writer path.

## Configure controller and agents

Run `scada-controller` using the controller variables. Run `scada-collector` on each eligible node using the agent variables.

| Setting | Controller | Collector agent |
| --- | --- | --- |
| Node ID | `CONTROL_NODE_ID` | `COLLECTOR_NODE_ID` |
| Comma-separated etcd endpoints | `CONTROL_ENDPOINTS` | `COLLECTOR_CONTROL_ENDPOINTS` |
| etcd prefix (default `/scada/control`) | `CONTROL_PREFIX` | `COLLECTOR_CONTROL_PREFIX` |
| TLS | `CONTROL_CA`, `CONTROL_CERT`, `CONTROL_KEY` | `COLLECTOR_CONTROL_CA`, `COLLECTOR_CONTROL_CERT`, `COLLECTOR_CONTROL_KEY` |
| Authentication | `CONTROL_USERNAME`, `CONTROL_PASSWORD` | `COLLECTOR_CONTROL_USERNAME`, `COLLECTOR_CONTROL_PASSWORD` |
| Replacement delay in ms (default 30000) | `CONTROL_REPLACEMENT_DELAY_MS` | |
| Clock-skew budget in positive finite ms (default 5000) | `CONTROL_CLOCK_SKEW_MS` | |

Without control endpoints, the collector uses manifest mode. The agent validates a complete snapshot before applying it. On startup it waits for a current assignment from the controller. Apply errors are reported and retried. The health endpoint remains available independently of etcd.

## Publish the catalog

`@yarkivaev/scada/control` exports `clientFromEnv`, `controlStore`, `publishCatalog`, `schedule`, `controller` and `assignmentAgent`. Publish with `publishCatalog(controlStore(clientFromEnv(env), env.CONTROL_PREFIX), catalog, expectedRevision?)`. Catalog shape:

```json
{
  "version": "1",
  "nodes": [
    { "id": "edge-a", "capacity": 100 },
    { "id": "edge-b", "capacity": 100 }
  ],
  "tasks": [{
    "taskId": "plant/power",
    "copies": 2,
    "cost": 1,
    "eligibleNodes": ["edge-a", "edge-b"],
    "spec": {
      "adapter": "modbus",
      "url": { "$secret": "MQTT_URL" },
      "config": {
        "addresses": ["tcp://192.0.2.10:502"],
        "interval": 5,
        "plans": [[{ "point": "holding:4000:cdab", "topic": "plant/line/power" }]]
      }
    }
  }]
}
```

`pinnedNode` forces one physical host. Network tasks default to two copies and capacity cost one. Placement preserves current owners; coverage of each source precedes second copies. Source reading progress is separate from process heartbeat. Extra copies are removed only after enough remaining copies confirm recent reads. An unreachable owner may continue its currently running work.

## Secure etcd access

Telemetry payloads, credentials, task specs and delivery addresses must not appear in public health responses or error logs. Production etcd must use authenticated TLS plus enabled etcd auth with per-node prefix permissions. The JSON gRPC gateway does not support client-certificate CN as an RBAC identity: it requires username/password authentication at /v3/auth/authenticate and an Authorization token. The client caches tokens for at most 60 seconds and retries authentication once on an invalid/expired token response. Passwords belong in Kubernetes secret references; controller, publisher and individual agents use distinct identities. Neither credentials nor token payloads are included in errors. TLS client verification remains enabled independently of RBAC. Catalog publishers and controllers need separate credentials. Provisioning belongs to the deployment DSL.

## Restore an etcd snapshot

The gateway request deadline defaults to two seconds per endpoint and response capacity to eight MiB. Initial catalogs should remain small enough to fit etcd transaction limits; this implementation uses one fenced transaction per reconciliation. After restoring an older etcd snapshot, publish the catalog with a new nonempty `controlEpoch`. Agents accept the new epoch and rebase in-memory execution generations above prior values. Within one epoch, stale generations remain rejected. Reports map local execution generations back to remote task generations for controller readiness checks.

## Verification

To verify edge control locally, run `npm test`, `npm run lint`, and `node test/integration/controlEtcd.js` with a disposable etcd instance configured via `ETCD_TEST_URL`. CI runs the control integration suite on `main`.

## Bound the delivery spool

Set `COLLECTOR_QUEUE_MAX_BYTES` and `COLLECTOR_QUEUE_MAX_RECORDS` to bound the in-memory delivery queue. Older pending observations are evicted first. See [collector delivery](durable-delivery.md#size-the-spool) for limits and counters.

## Read evidence and clocks

Read confirmation is valid only for the assigned task generation and current control epoch, with a running task and a recent read timestamp no more than the clock-skew budget ahead of controller time. Report liveness uses the same bound (5 seconds by default, configurable with CONTROL_CLOCK_SKEW_MS). Normal bounded positive or negative clock offsets remain eligible. Controller and executor clocks must be synchronized within this bound; larger forward jumps or stale timestamps can prevent new placement and rolling progress; running assignments continue executing offline. Report receipt age currently uses executor wall time, so clock synchronization is an explicit operational prerequisite.

---

← [OPC UA collection](opc-ua.md) · [Durable delivery](durable-delivery.md) →
