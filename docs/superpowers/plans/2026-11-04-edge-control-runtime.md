# Edge control runtime implementation plan

Goal: quorum-controlled complete assignments with autonomous local execution.
Architecture: etcd JSON gateway stores catalog/reports/assignments; lease fencing prevents stale controller writes. Collector caches assignments before applying and retains them offline.
Spec: parent chat outputs/edge-orchestrator-architecture.md.
Constraints: no merge, deploy, release or publishing. New branch from origin/main.

- [ ] Scheduler: pure coverage-first placement, serial pins, capacity, two copies, survivor replacement delay, no-survivor immediate replacement. Tests partition, recovery and saturation.
- [ ] Store/controller: TLS JSON gateway with failover and bounded requests; lease-fenced transactional writes, atomic catalog publish, idempotent reconciles. Tests lost leadership and catalog conflict.
- [ ] Embedded agent: atomic fsynced snapshot before apply, offline restart, complete removals, retry partial apply, reports, stop cancellation. Tests restart, stale snapshots and network failure.
- [ ] Integration: collector automatic control mode, controller executable, exports and docs. Run full tests/lint and open PR; monitor remote CI.

Review focus: isolated runtime must not stop; stale leaders cannot write; assignment receipt is distinct from application; successful migration must precede retirement; state paths and TLS files are not secret output.
