# Bounded group-commit measurement

Node22.22.2 / Mac APFS, actual previous OPC/electrical adapter fixture (19 OPC plus1 electrical output). Producer submissions are bounded64-record bursts, not a serial await loop; this measures grouping opportunity already present in OPC heartbeat fan-out. It is not edge-2 rotational-disk evidence. Fixtures retain their actual body/routing/descriptors and use fresh outer event identities, as in the earlier capacity study.

Command: `node --expose-gc scripts/measure-delivery-spool.mjs FIXTURE.json 120000`.

| Quantity | Observed |
|---|---:|
| Records |120000|
| Producer peak retained operations / serialized bytes |64 /196744|
| Append duration / rate |16.72s /7175 records/s|
| Successful stand-in sink drain duration / rate |20.99s /5716 records/s|
| Post-GC heap at10k /120k |5.52MB /5.61MB|
| Writer RSS range at10k checkpoints |109–130MB|
| Fresh-process recovery |6.38ms|
| Recovery heap / RSS increase |156KB /2.47MB|

Raw JSON includes SQLite pages/index/compression, WAL and free-page reuse. Grouping changes no persistent record format. Peak queue count/bytes includes the actual batch before completion; producer concurrency never grows with the120k retained backlog. The stand-in drain omits broker latency. The run overlapped attempted container regressions, which later proved blocked by the local Docker start API.

Semantic instrumentation with real SQLite separately proves three concurrent queue accepts use one outer transaction and three successful recipient receipts use one transaction plus the pending-window rotation transaction. SIGKILL tests cover buffered-before-flush and committed-group boundaries, and an actual COMMIT followed by injected I/O ambiguity rejects all callers while preserving durable recovery. Target Linux offline/online rate and durability qualification remain required.
