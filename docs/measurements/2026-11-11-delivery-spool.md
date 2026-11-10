# SQLite delivery spool capacity

Measured with Node22.22.2, better-sqlite3 existing dependency, Mac APFS. The JSON alongside this report contains raw sizes, timings and memory samples. This is host evidence, not a Linux PVC throughput guarantee. The final measurement overlapped real-container regression testing, so rates include host contention.

Fixture: 19 actual OPC UA outputs plus one electrical Modbus output, using the compiled rollout task catalog from the earlier capacity study and actual adapter transformations. Source modules were copied read-only to a temporary directory because the original checkout was being integrated. Only package imports were redirected to Core; no plant source code or sensitive configuration is included here. Each benchmark admission has a fresh eventId while retaining the real body, routing and destination shape. The fixture mixes 95% OPC with 5% electrical and is not a live cadence measurement.

Command: `node --expose-gc scripts/measure-delivery-spool.mjs FIXTURE.json 120000`.

| Quantity | Observed |
|---|---:|
| Retained events |120000|
| Logical bytes |370812000|
| SQLite file bytes |101244928|
| Compressed event bytes |52231702|
| Interned destination descriptors / JSON bytes |2 /2798|
| Event sequence index bytes |1581056|
| Event identity index bytes |6017024|
| WAL before close |1048576|
| Append duration / rate |28.54s /4204 records/s|
| Stand-in sink drain duration / rate |45.02s /2665 records/s|
| Heap at10000 /120000 events |5.36MB /5.43MB|
| Writer RSS range over10k checkpoints |66–82MB|
| Fresh-process recovery duration |8.97ms|
| Fresh-process recovery heap / RSS increase |149KB /2.65MB|

Drain freed24710 of24719 allocated pages; refilling10000 events reused the same24719 pages without growing the database. SQLite retains its high-water allocation for safe future reuse. The benchmark confirms bounded event-index heap and startup at this scale; payload size, recipient count, SQLite builds and filesystem latency still affect physical capacity and throughput.

At this mix the database averages844 bytes per event (including pages/indexes), versus3090 logical bytes. Linear extrapolation gives about4.83GiB for6.14million events or63.3GiB for80.6million; these are planning estimates, not activation guarantees. The latter cannot fit a small PVC. Set finite logical/record caps from actual rate and available disk, retain safety headroom, and verify on each Linux PVC before activation.

The drain benchmark uses a successful sink stand-in. Actual RabbitMQ tests independently verify per-recipient confirmation across restart and mandatory-return retention/replay. Full central/native gap/history contracts also run with real RabbitMQ, ClickHouse and PostgreSQL containers.
