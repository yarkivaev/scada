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
- [x] Add failing SQLite storage/compression/ownership/migration/rotation/capacity tests; run RED.
- [x] Implement codec, database and migration helpers and compatible spool API; run focused GREEN.
- [x] Update explicit close lifecycle and restart tests; run queue/Secret tests.
- [x] Full tests/lint and real broker/central/history tests.
- [x] Measure100k+ real envelopes, RSS/recovery/write/drain and allocated pages.
- [x] One fresh focused review; material fixes RED→GREEN then full verification.
- [ ] Version2.6.1, PR/version check; report exact head. No merge until parent confirms.

## Ledger
- Ruling: enforce a real owner lifecycle; existing restart tests must close the original instance — concurrent owners now explicitly reject, avoiding stale receipt races.
- Task1 implementation: initial6 missing-feature RED failures -> SQLite contracts GREEN; missing legacy receipt state RED -> strict rejection GREEN. Queue accepted-write close RED(lock retained) -> shutdown GREEN. Private file modes RED0644 ->0600 GREEN.
- Validation: first full suite1480/1480; focused current26/26; actual Rabbit/central/native/gap/history84/84; lint clean. Final expanded full suite running.
- Capacity:120k real envelopes,101.2MB SQLite/370.8MB logical; heap5.35→5.39MB; fresh recovery5.12ms. See docs/measurements. No production changes.
- Final review: one fresh read-only reviewer found2 Critical and3 Important issues, reproduced as6 RED tests. One fix pass: process-local device/inode reservation before owner fd opens; regular/nlink1 validation for both databases' main/journal/WAL/SHM files; bounded existing-schema/counter validation before journal/data mutation; recipient IDs from frozen envelope; descriptor-stat cap and bounded legacy read. All6 RED→GREEN;32focused contracts pass. Final fullsuite and real-container reruns pending.
- Final: minor (deferred): `spoolRecords.admission()` is an unused capacity alias. No behavioral effect; leave this polish for a separate change.
- Final: Ruling: target Linux PVC power-loss durability and sustained throughput remain activation gates, not inferred from APFS/SIGKILL evidence — the test environment cannot prove disk-controller guarantees — wrong assumptions risk backlog exhaustion or crash loss.
- Final: Ruling: stop the legacy JSON writer before upgrade and keep the spool directory private — legacy collectors do not share the SQLite ownership protocol, and hostile concurrent filesystem mutation is outside the private-directory boundary — wrong sequencing can race legacy source changes or file removal.
- Final: Ruling: AMQP confirm followed by process loss before the local receipt may replay the same eventId — preserve pending data and rely on receiver deduplication for exactly-once effects — wrong receiver assumptions can duplicate effects; event identity and wire body remain frozen.

- Final: fixed all5 material findings —6 regressions RED→GREEN, full suite1495/1495; actual Rabbit/central/native/gap/history84/84;32focused contracts; lint and diff whitespace check pass. No second review. Final120k measurement:101.24MBphysical/370.81MBlogical, heap5.36→5.43MB, strict-format fresh recovery8.97ms, append4204/s and stand-in drain2665/s under concurrent container load. Physical pages fully reused after drain/refill.
- Final: finding5 completion during root integration read — the first bounded-read fix still allowed one legacy allocation up to a queue-wide GiB cap. Added independent `legacyMigrationMaxBytes`, default16MiB, checked before allocation in both migration reads. A1GiB sparse file under a256GiB queue cap, explicit larger legitimate recovery and migration-only compatibility tests all RED→GREEN;35focused pass; lint clean. Final full/container reruns pending. This completes the original finding5 fix pass; no re-review.
- Final: Ruling: the independent cap applies only to legacy JSON migration — preserve the generic append API and already committed SQLite records, while failing closed and retaining legitimate larger legacy originals until an operator explicitly raises the migration budget — a too-small migration budget delays readiness but never discards pending data; an operator-raised budget requires corresponding process memory.
- Final: finding 5 completion verified — the independent legacy record limit's three regressions RED→GREEN; full Core suite 1498/1498; focused spool/queue 35/35; actual RabbitMQ/ClickHouse/PostgreSQL central/native-gap/history contracts 84/84; lint and diff whitespace checks pass. Existing capacity measurements remain applicable because append/receipt/SQLite record paths are unchanged.
