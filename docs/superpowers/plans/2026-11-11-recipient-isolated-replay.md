# Recipient-isolated replay repair

Finding: canonical global event-page rotation makes delivery to a healthy destination wait behind an arbitrarily large offline-only prefix. Reproduction: 4000 offline events followed by one healthy event; actual Core264 managed delivery has delivered zero healthy events after2200ms.

Decision: retain canonical format-v1 SQLite WAL/FULL and all mandatory ACK rules. Add a disposable disk-backed attached replay index keyed by immutable destination descriptor digest. Rebuild the index from canonical recipient metadata on every open, never from external messages. Select a bounded round-robin page across destination indexes; decode only selected events. Keep32 actual in-flight publication reservations and existing timeout/late-ACK fencing. A failed descriptor receives a bounded10s retry cooldown, other descriptors keep draining. Manual queue tests can inject clock/cooldown for deterministic recovery checks. Successful partial progress schedules immediate bounded bursts; all-failed work retains periodic backoff.

Alternatives: global page rotation is bounded in memory but healthy latency grows with offline backlog; scanning whole JSON backlog on each drain is unbounded work. Changing canonical schema would prevent rollback to264. A rebuilt derived index preserves rollback and bounds repeated selection work; startup rebuild has linear metadata IO and disk cost and must be measured.

Implementation sequence:
1. Regression tests: large offline prefix, multiple destinations on one event, immutable descriptor rotation, restart/rebuild and canonical-v1 compatibility, cooldown recovery and scheduler partial progress.
2. Disposable index lifecycle under existing exclusive owner, regular-file protections; insert/ACK hooks in existing transactions; bounded fair selection.
3. Queue descriptor cooldown and scheduling, preserving actual publication slots and all durable receipts.
4. Affected suites + full Core tests/lint; real Rabbit offline destination and SIGKILL durability; exact-green main release and application pin, final published-image qualification.

Review focus: no phantom ACKs; no skipping healthy descriptor sharing a logical ID; cache loss/corruption never loses canonical work; aliases never modified; actual publication slots stay reserved after caller timeout. Cache is disposable and may not serve as durable acceptance evidence. Changes implement the already authorized autonomous availability repair; no architecture requirements are relaxed.

## Execution evidence and rulings

- Initial regression:2 failing assertions, then2 passing after indexed selection/cooldown. Actual published2644000-event probe did not deliver healthy point within2200ms; same candidate probe did.
- Affected contracts81passed; cache/rebuild/index contracts4passed; first full Docker regression1549passed (4m), lint passed.
- Fresh whole-branch reviewer found Important starvation after64 retained sessions (both failed endpoints and successful descriptor rotations). Fixed with LRU eviction of actually settled idle sessions, never active/reserved sessions. Both regressions RED to GREEN; combined19targeted contracts passed. Final full suite is rerunning; not yet claimed complete. No second review per inline execution policy.
- Real Rabbit fixture initially omitted exchange in its envelope and correctly failed publication validation. Fixed fixture, not production validation. Actual healthy300mandatory confirms then passed while1000offline events remained after restart (7s). Final post-review-fix integration rerun pending.
- Disposable-index benchmark120000actual-shape events: startup471ms, RSS42.2MB to49.1MB; canonical48.7MB plus derived36.5MB; append7173/s, sink-stand-in drain724/s on Mac APFS. This is not Linux PVC qualification or actual broker throughput.
- Ruling: extra derived disk allocation is explicitly included in final physical capacity qualification. No canonical schema migration; rollback runtime264 can still read accepted records. Cache rebuild scans routing metadata once on startup, never the full payload backlog on each drain.
- Ruling: first-value conflict policy, sampling, routing, raw retention and required recipient confirms are unchanged. Default10s per-descriptor cooldown is an operational repair decision; it is bounded and bypasses only retries, never durable collection/acceptance.

## Final local verification

- `PATH=/opt/homebrew/opt/node@22/bin:$PATH DOCKER_HOST=unix:///Users/yarkivaev/.docker/run/docker.sock npm test`:1551passing,0failing,exit0 (4m), after the session-pool fix.
- `PATH=/opt/homebrew/opt/node@22/bin:$PATH DOCKER_HOST=unix:///Users/yarkivaev/.docker/run/docker.sock npx mocha --exit test/integration/deliveryRecipientContainer.js`:1passing,0failing,exit0 (8s), after the session-pool fix.
- `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run lint`:exit0 for version2.6.5. `git diff --check`:exit0.
- Whole-branch fresh review: one Important, fixed with two RED-to-GREEN regressions and the full green suite. No deferred minor findings. Declined-to-judge production filesystem durability and target-capacity startup remain rollout gates, not local passing claims.
- Local repair complete; exact-main CI release, factory mirror, application pin/image and all6PVC qualification remain required before activation.
