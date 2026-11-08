# MQTT publisher recovery implementation plan

> Execute inline with executing-plans; independent review before merge.

Approved scope: MQTT recovery and truthful health on edge-1; RabbitMQ restart regression; green CI, merge, release, deploy edge-1; verify cooling on ICHT and central. Preserve edge-2 casting deployment and existing wire contracts.

Design: retain the existing fail-closed MQTT session contract (no uncertain write replay). Add one-shot fatal lifecycle notification to mqttSink for unexpected session termination. Forward it through Modbus pipeline into runtime task health/fatal state. /ready and /live become503, allowing the existing Kubernetes liveness probe to restart the collector and construct a fresh sink. Normal stop must not mark failure. Real RabbitMQ restart test proves failure health and fresh-worker recovery with new confirmed samples and bounded resource cleanup. Do not merely enable MQTT.js reconnect on a retired bounded-batch session.

- [ ] Core: regression RED for unexpected close + normal-stop health; implement one-shot notification and Modbus runtime wiring; real RabbitMQ stop/start integration test with runtime replacement; full tests/lint and independent review; patch release.
- [ ] Platform: mirror exact official release with integrity check; preserve unrelated dirty primary files using isolated native worktree; green MR/main.
- [ ] Plant: consume exact release, pin only edge-1 collector to new plant release, keep edge-2 pins/desired state; validate real Rabbit restart in CI and source profile health probes; green MR/main/release.
- [ ] Deploy through exact edge-1 DSL job using existing credentials/access. Verify deployed version, health, MQTT connection/publication, fresh cooling on ICHT and central; record evidence.

Baseline: edge-1 collector2.2.349/scada2.4.4 (running since12:21 UTC+8); RabbitMQ replaced12:27; zero MQTT connections; old health ready200. New source-only edge-1 and casting edge-2 split already on current main360; preserve it. Core current main2.5.2 includes latest checkpoint and central fallback fixes.
