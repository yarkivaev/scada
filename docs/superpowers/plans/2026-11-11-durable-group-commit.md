# Durable group commit implementation plan

Execute inline with executing-plans and TDD; root owns the single fresh final review and integration. Approved design: parent rollout plan's bounded group-commit ruling; base main4b09d147.

Goal: amortize actual slow-disk FULL commits without early acceptance, lost points or changed source cadence.

- [x] Spool mutateMany: outer FULL transaction, per-operation savepoints/outcomes; SQLite failures reject/fail closed. Preserve append/ack wrappers and old format.
- [x] Queue operation scheduler: frozen admission before serialization, bounded count/bytes including in-flight, sparse timer, FIFO barriers, forced flush/idle on close.
- [x] Queue receipt grouping: only after mandatory confirms, bounded outstanding receipt promises, durable completion before delivered result, active-close flush.
- [x] Draining: healthy full-page continuation yields each page, bounded bursts, failure/no-progress backoff.
- [ ] Full tests/lint, real Rabbit/crash tests; bounded Mac measurements. Version2.6.2; commit and report exact head. No merge/publish/deploy.

Review focus: late SQLite commit ambiguity; capacity/error isolation within groups; FIFO around pending/open; close while network confirmation is in flight; real pending-byte reservations after caller deadlines; failed recipients must not trigger immediate retry spins; no loss of ownership/recovery compatibility.

## Execution ledger
- TDD: mutateMany absent→4 RED; ordered/savepoint/SQLite rollback/ambiguous actual-COMMIT recovery GREEN. Added SIGKILL before sparse flush and after grouped commit; both pass.
- TDD: scheduler absent→6 RED; coalescing, actual-settlement reservation lifetime, byte/count bounds, FIFO and sparse flush GREEN. Receipt reservation and malformed result regressions RED→GREEN; constructor shapes/timer bound RED→GREEN.
- TDD: actual SQLite queue commits3→1, receipt commits4→2 including rotation; pre-confirm receipt capacity, count-before-snapshot, grouped storage failure and oversize-before-decode RED→GREEN. Grouped receipt failure regression against baseline reported1 delivered/1failed, new implementation0 delivered/2failed and both observations recoverable. Accepted sparse append plus active confirmed receipt close race passes.
- TDD: healthy600-record continuation timed out at500ms against old1s-per-page loop, passes with yielding four-page bursts; failed/no-progress pages retain1s backoff.
- Validation: all273 non-container test files1451 passing(27s), including actual local protocol fixtures and SIGKILL; lint/diff checks pass. Full suite and selected actual-container attempts were interrupted/failed before-all due Docker start API stall; isolated Ryuk c5cd1c1178f9 remains Created/Pid0. Logs /private/tmp/core262-{full,integration,rabbit-isolated}.log preserved. Root owns recovery; no further container starts, daemon changes or fixture timeout changes.
- Measurement:120k actual prior OPC/electrical envelopes in bounded64-record bursts, peak64ops/196744serialized bytes; append7175/s, stand-in drain5716/s; post-GC heap5.52→5.61MB, fresh recovery6.38ms. Mac APFS evidence only; final target Linux/PVC qualification required.
- Ruling: reserve the prospective receipt before publication, enqueue it only after confirmation — otherwise a full source buffer or graceful close could reject an already confirmed recipient's ACK admission — cost is one bounded operation slot held during each active network write; failures release that unused reservation.
- Ruling: direct spool append/ack remain immediate single-operation FULL calls; batching lives before queue serialization — debouncing strictly inside the spool would not receive concurrent calls through the old queue chain — serial producers retain sparse-flush latency and cannot claim burst throughput.
- No env knobs added: validated API options and the agreed defaults suffice for this candidate. No format/schema migration, native dependency, plant/prod edit, publish or merge.
