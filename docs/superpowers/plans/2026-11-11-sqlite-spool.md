# SQLite delivery spool implementation plan

> Execute inline with executing-plans. Parent owns release sequencing.

**Goal:** Replace unbounded file/index spool with bounded-memory durable SQLite, preserving envelope and recipient receipts.
**Architecture:** WAL/FULL event database with indexed sequence rotation, compressed event payloads and interned destinations. A separate SQLite exclusive transaction supplies a crash-released process ownership lock. Logical JSON bytes and record counters are transactional. Legacy imports commit and verify before originals are removed.
**Tech stack:** existing better-sqlite3, node:zlib and Node22.
**Spec:** Task1 SQLite addendum in parent rollout plan.

## Constraints
Preserve event identity/body/Secret refs and recipient routing; commit before acceptance/ACK. No native dependency additions. No release bypass or production changes. Candidate2.6.1.

## Review focus
- Crash between import commit and unlink must not duplicate or bypass records.
- Concurrent process owner and killed owner recovery.
- Database/legacy symlinks and unrelated files.
- Descriptor changes and partial confirmation across restart.
- Logical capacity distinct from allocated pages; bounded recovery and WAL.

## Task1 persistence
- [ ] Add failing SQLite storage/compression/ownership/migration/rotation/capacity tests; run RED.
- [ ] Implement codec, database and migration helpers and compatible spool API; run focused GREEN.
- [ ] Update explicit close lifecycle and restart tests; run queue/Secret tests.
- [ ] Full tests/lint and real broker/central/history tests.
- [ ] Measure100k+ real envelopes, RSS/recovery/write/drain and allocated pages.
- [ ] One fresh focused review; material fixes RED→GREEN then full verification.
- [ ] Version2.6.1, PR/version check; report exact head. No merge until parent confirms.

## Ledger
- Ruling: enforce a real owner lifecycle; existing restart tests must close the original instance — concurrent owners now explicitly reject, avoiding stale receipt races.
- Task1 implementation: initial6 missing-feature RED failures -> SQLite contracts GREEN; missing legacy receipt state RED -> strict rejection GREEN. Queue accepted-write close RED(lock retained) -> shutdown GREEN. Private file modes RED0644 ->0600 GREEN.
- Validation: first full suite1480/1480; focused current26/26; actual Rabbit/central/native/gap/history84/84; lint clean. Final expanded full suite running.
- Capacity:120k real envelopes,101.2MB SQLite/370.8MB logical; heap5.35→5.39MB; fresh recovery5.12ms. See docs/measurements. No production changes.
