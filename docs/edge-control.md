# Edge assignment control

Three independent edge clusters run etcd and controller replicas; every collector embeds an assignment agent. Losing the control majority prevents new placement but never expires saved work. Serial tasks require a pinned node. Controller changes use etcd transactions comparing the leader value and lease.

Controller environment: CONTROL_NODE_ID, CONTROL_ENDPOINTS (comma-separated), CONTROL_PREFIX (default /scada/control), CONTROL_CA, CONTROL_CERT, CONTROL_KEY, CONTROL_USERNAME, CONTROL_PASSWORD, CONTROL_REPLACEMENT_DELAY_MS (default 30000). Run `scada-controller`.

Collector environment: COLLECTOR_NODE_ID, COLLECTOR_CONTROL_ENDPOINTS, COLLECTOR_CONTROL_PREFIX, COLLECTOR_CONTROL_CA/CERT/KEY, COLLECTOR_CONTROL_USERNAME/PASSWORD and COLLECTOR_ASSIGNMENT_FILE (persistent volume). Run `scada-collector`. Existing manifest mode is unchanged when control endpoints are absent. The entire snapshot is validated and fsynced before execution; offline startup restores it. Errors applying one snapshot are retried and reported without discarding the saved assignment. The health endpoint is independent of etcd availability.

`@yarkivaev/scada/control` exports `clientFromEnv`, `controlStore`, `publishCatalog`, `schedule`, `controller` and `assignmentAgent`. Publish with `publishCatalog(controlStore(clientFromEnv(env), env.CONTROL_PREFIX), catalog, expectedRevision?)`. Catalog shape:

```json
{"version":"1","nodes":[{"id":"edge-a","capacity":100}],"tasks":[{"taskId":"plant/channel","copies":2,"cost":1,"eligibleNodes":["edge-a"],"spec":{"adapter":"example"}}]}
```

`pinnedNode` forces one physical host. Network tasks default to two copies and capacity cost one. Placement preserves current owners; coverage of each source precedes second copies. Source reading progress is separate from process heartbeat. Extra copies are removed only after enough remaining copies confirm recent reads. An unreachable owner retains its saved work.

Telemetry payloads, credentials, task specs and delivery addresses must not appear in public health responses or error logs. Production etcd must use authenticated TLS plus enabled etcd auth with per-node prefix permissions. The JSON gRPC gateway does not support client-certificate CN as an RBAC identity: it requires username/password authentication at /v3/auth/authenticate and an Authorization token. The client caches tokens for at most 60 seconds and retries authentication once on an invalid/expired token response. Passwords belong in Kubernetes secret references; controller, publisher and individual agents use distinct identities. Neither credentials nor token payloads are included in errors. TLS client verification remains enabled independently of RBAC. Catalog publishers and controllers need separate credentials. Provisioning belongs to the deployment DSL.

The gateway request deadline defaults to two seconds per endpoint and response capacity to eight MiB. Initial catalogs should remain small enough to fit etcd transaction limits; this implementation uses one fenced transaction per reconciliation. After restoring an older etcd snapshot, publish the catalog with a new nonempty `controlEpoch`. Agents accept the new epoch and persistently rebase local execution generations above prior values. Within one epoch, stale generations remain rejected. Reports map local execution generations back to remote task generations for controller readiness checks.

Verification: `npm test`, `npm run lint`, and `node test/integration/controlEtcd.js` against disposable etcd at ETCD_TEST_URL. The control integration workflow runs only on pull requests and never deploys.

The disk spool has two admission bounds: `COLLECTOR_SPOOL_MAX_BYTES` and `COLLECTOR_SPOOL_MAX_RECORDS` (positive safe integer, default 100000). Existing records are never evicted to admit new observations. Partial recipient confirmation does not release a record slot; full confirmation does. Startup reads directory entries incrementally and refuses to open an existing spool exceeding the configured record bound, preserving every file; raise the bound to recover and drain that backlog. Status exposes `recordLimit` alongside pending count and byte usage.
