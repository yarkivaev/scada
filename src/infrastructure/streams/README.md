[Documentation](../../../docs/README.md) / [Data collection](../../../docs/collect/README.md)

# Stream adapters

SCADA exports protocol and storage adapters through `@yarkivaev/scada/streams`.

Generic batching, circuit breakers and periodic sources come from `@yarkivaev/source-to-sink`.

## Components

| Component | Description |
|-----------|-------------|
| `batch(sink, size, circuit)` | Collects records and flushes to sink when size is reached |
| `circuit(threshold, timeout, clock)` | Circuit breaker for failure isolation |
| `timedBatch(collector, interval)` | Adds time-based auto-flush to a collector |
| `clock()` | System time provider |
| `pollingSource(fetch, interval, collector, clock)` | Generic polling source with time window |
| `clickhouseSink(url, table)` | ClickHouse sink adapter |
| `mqttSource(url, topic, collector)` | MQTT subscription source |
| `lokiSource(url, query, interval, collector, clock)` | Loki polling source |

### STOMP delivery window

`stompSource(url, destination, collector, { prefetch: 32 })` bounds broker deliveries
that are waiting for acknowledgement. The default is 32; use a positive safe
integer to tune throughput. A zero (unlimited) window is rejected because a
backlog can otherwise exhaust the consumer's heap. With `manualAck: true`, the
collector remains responsible for settling frames. If it flushes only by count,
its batch must not exceed the prefetch window; a timed flush also avoids stalls.

Manual collectors may call `settle.nack(false)` to dead-letter invalid messages. Configure a durable dead-letter queue and broker policy before enabling this; without a route RabbitMQ discards rejected messages. `settle.nack()` retains retry behaviour.


## Transport sources and lifecycle

The sources below receive a collector with `accept(record)`. Return a promise
that resolves when processing is accepted; rejecting it reports a processing
failure. Keep application decoding, routing, SQL queries and cursor updates in
the collector. Await `stop()` before stopping downstream collectors or sinks,
so in-flight acceptance can finish. A collector that never settles also prevents
a draining stop from finishing.

### Serial chunks

```javascript
import { serialSource } from '@yarkivaev/scada/streams';

const source = serialSource([
  { path: '/dev/ttyUSB0', baudRate: 9600, dataBits: 8, parity: 'none', stopBits: 1 }
], {
  accept({ device, chunk }) {
    return decodeAndStore(device.path, chunk);
  }
}, { retryMs: 1000, onError: (error, device) => console.error(device.path, error) });

await source.start();
```

Each port has its own open/retry loop. `chunk` is the original buffer and `device`
is the original configuration object; framing and decoding belong in the
collector. Duplicate paths are rejected. Errors or a closed port trigger cleanup
and retry without interrupting other devices. `start()` initiates opens;
`stop()` waits for pending opens, closes ports, removes listeners and drains
in-flight acceptance before restart.

For testing or another port implementation, pass `openPort(device)`, returning a
port or promise for a port. The port supports EventEmitter `data`, `error` and
`close` events plus `close(callback)`. The default opens `serialport` lazily.
The source pauses the stream during acceptance and bounds the pending chunks and bytes. See [bounded operations and shutdown](#bounded-operations-and-shutdown).

### Periodic collection

```javascript
import { intervalSource } from '@yarkivaev/source-to-sink';

const source = intervalSource(1000, {
  async accept({ ts }) {
    const records = await readChanges(ts);
    await publish(records);
    // Advance a cursor only after publication succeeds.
  }
}, { immediate: true, onError: console.error });

await source.start();
```

`intervalMs` must be positive. Ticks carry a Unix timestamp in milliseconds.
The default `immediate: false` waits one interval before the first tick. With
`immediate: true`, `start()` waits for the first acceptance to settle. Subsequent
ticks wait the interval after the previous acceptance settles, so slow work never
overlaps another tick. Rejections call `onError` and scheduling continues.
`stop()` cancels scheduling and drains the active tick; restart waits for that
drain. Tests can inject `schedule(callback, milliseconds)` and `clear(handle)`.

### AMQP consumption

```javascript
import { amqpSource } from '@yarkivaev/scada/streams';

const source = amqpSource('amqp://localhost', 'readings', {
  async accept(delivery) {
    await storeReading(JSON.parse(delivery.content.toString()));
  }
}, {
  queueOptions: { durable: true },
  exchanges: [{ name: 'telemetry', type: 'topic', options: { durable: true } }],
  bindings: [{ exchange: 'telemetry', pattern: 'reading.#' }],
  prefetch: 32,
  onError: console.error
});

await source.start();
```

Deliveries contain `content`, `fields`, `properties`, `ack()` and
`reject(requeue = true)`. By default the source acknowledges only after
`collector.accept` resolves; rejection requeues the delivery and reports the
error. Settlement is idempotent within a delivery. Set `ackMode: 'manual'` to
let the collector choose `ack()` or `reject(false)` for dead-lettering; configure
a broker dead-letter route if those messages must be retained. A collector that
settles manually should still await its processing work so stop can drain it.

The default queue is durable and the default prefetch is 32. Choose a finite,
positive prefetch to bound outstanding broker deliveries. With count-based
batching, the batch must fit within that window, or use a timed flush.
Connection/channel failure or consumer cancellation causes reconnection with
backoff from one to 30 seconds. `stop()` cancels the consumer, drains acceptance,
and closes the channel and connection. `active()` means the lifecycle is running,
including while reconnecting; it does not prove a broker connection is ready.

`amqpSession(url, subscribeChannel, options)` exposes that same lifecycle for
custom channel topology or consumption. The async `subscribeChannel(channel)`
returns a consumer tag for cancellation. `options.drain(channel)` can await
application work before channel closure. Both APIs accept `onError` (or `report`),
`connect(url)`, `schedule(callback, milliseconds)` and `clear(handle)`; the latter
three are useful for testing. The default connection uses a ten-second heartbeat.

### AMQP publication

```javascript
import { amqpSink } from '@yarkivaev/scada/streams';

const sink = amqpSink('amqp://localhost', {
  exchanges: [{ name: 'telemetry', type: 'topic', options: { durable: true } }],
  maxPending: 1024,
  onError: console.error
});
await sink.start();
await sink.write([{
  exchange: 'telemetry', routingKey: 'reading.temperature',
  body: JSON.stringify({ value: 42 }), options: { persistent: true }
}]);
await sink.stop();
```

`write(records)` resolves after broker publisher confirms for every record. Each
record requires an exchange, routing key and string or Buffer body; `options`
passes publication options to amqplib. A confirm does not mean a consumer has
processed the message or that an unroutable message reached a queue.

`maxPending` (default 1024) bounds outstanding confirmations. Writes reject while
the connection is unavailable, when the channel awaits its `drain` event, or when
the batch would exceed that bound. There is no unbounded offline queue. A write
can partially succeed before rejection; callers must account for that when
choosing retries or advancing cursors.

Connection loss or `confirmTimeoutMs` expiry rejects uncertain publications and
reconnects for future writes. **The sink never automatically replays records**:
the broker may already have accepted them. Use application idempotency when
retrying uncertain results. `active()` reports whether a live channel exists.
`start()` waits for connection and topology setup; a failed initial attempt
rejects while background retries continue until stopped.

Other options are `retryMs` (1000), `connectTimeoutMs` (5000),
`confirmTimeoutMs` (10000), `onError(error)`, and injectable
`connect(url, connectionOptions)`. Exchange declarations default to type `topic`
and durable options when omitted. `stop()` closes the session and rejects pending
confirms; it does not flush them. For graceful shutdown, first stop and drain
sources, await outstanding `write()` promises, then stop the sink.

## Database sink ownership

`clickhouseSink(url, table, options)` owns its client; await its idempotent
`stop()` to close the client's sockets. `write(records, { signal })` forwards
cancellation to the installed ClickHouse client's native `abort_signal` API.
`postgresSink.stop()` ends only a pool created by the sink. An `options.pool`
pool remains caller-owned and open; explicit transaction clients remain borrowed.
Both stops have a `stopTimeoutMs` deadline (5000). PostgreSQL rejects already
aborted writes but does not claim to cancel an in-flight query through AbortSignal.
Stop/drain sources before closing their owned database sink.

## Bounded operations and shutdown

Await lifecycle methods and writes. In particular, `mqttSink.start()` now waits
for MQTT CONNACK, and `mqttSink.write(records, { signal })` returns a promise.
QoS 1/2 waits for the MQTT.js broker-confirmation callback; QoS 0 only confirms
local handoff and is **not a durable acceptance boundary**. MQTT has no offline
write queue or automatic replay. Connection loss, cancellation, or a missing
confirmation retires that session; await `stop()` before starting a fresh session.
Defaults: `maxPending: 1024`, `maxPendingBytes: 1048576`,
`connectTimeoutMs: 5000`, `confirmTimeoutMs: 10000`, `stopTimeoutMs: 5000`.

`mqttSource` defers PUBACK/PUBCOMP until asynchronous `collector.accept()` finishes.
This only represents durability if the collector's promise represents durable
storage. MQTT.js serializes this acceptance hook: use a source-facing batch size
of one (or flush each acceptance), since a batch requiring future MQTT messages
cannot fill while the current message waits for durable acknowledgement. Its MQTT 5 receive window defaults to 32 and packet limit to 1 MiB
(`prefetch`, `maxPacketBytes`). Sources forward an optional second acceptance
argument `{ signal }`; existing one-argument collectors remain compatible.

`boundedBatch(sink, options)` provides bounded asynchronous acceptance. Options
are `size: 100`, `maxRecords: 1000`, `maxBytes: 1048576`, `maxWaitMs: 1000`, and
`writeTimeoutMs: 10000`. Acceptance resolves after its sink write; admission
rejects at capacity. Explicit `flush()`/`stop()` reports failures from the drain
it awaits. A timed-out write aborts its signal and permanently retires the batch.
A batch rejection can represent a partially applied external write: retries and
idempotency belong to the caller.

Serial reception pauses the stream while acceptance runs and bounds queued
chunks/bytes (`maxPending: 32`, `maxPendingBytes: 1048576`). Custom ports must
implement `pause`/`resume` for flow control; overflow is reported through
`onError` and permanently retires the source (including a rejected `stop()`).
There is no implicit drop-and-retry policy. Hardware bytes that arrive despite flow control cannot be recovered
by this library. `openTimeoutMs` and `stopTimeoutMs` default to 5000;
`acceptTimeoutMs` defaults to 10000. Timed-out lifecycle operations quarantine
the instance. RTU buses serialize each slave read and acceptance, recover from
individual rejected reads, and close late connections without polling them.
RTU options include `readTimeoutMs: 5000`, `connectTimeoutMs: 5000`,
`acceptTimeoutMs: 10000`, and `stopTimeoutMs: 5000`.

Periodic sources use `acceptTimeoutMs: 10000` and `stopTimeoutMs: 5000`.
Polling advances its cursor only after all returned rows are accepted and fences
late fetch results after stop. Fetch receives `(since, until, { signal })`.

Loki accepts a sixth options argument: `requestTimeoutMs: 5000`,
`maxResponseBytes: 1048576`, `pageLimit: 1000`, `queryLagMs: 1000`, and `onError`.
HTTP body reads are capped and aborted on cancellation/deadline. A response at
or above the page limit rejects before delivery or cursor advance; this API does
not claim pagination or a portable historical checkpoint. Query windows lag the
wall clock to allow ingestion visibility. Entries appearing later than the
configured lag can still be missed; this is a bounded-lag live source.


AMQP sources validate `prefetch` (32), `maxMessageBytes` (1048576), and
`maxPendingBytes` (prefetch times maxMessageBytes). Oversized or aggregate-overbudget
payloads are rejected without requeue before calling the collector and reported
through `onError`. Broker delivery decoding still allocates the incoming message;
configure broker message-size limits as well for hostile inputs.

AMQP cleanup attempts cancellation, draining, channel close, and connection
close even if an earlier stage hangs. Each cleanup stage uses `stopTimeoutMs`
(default 5000); the total source cleanup budget can therefore be four times
that value. Uncertain cleanup/connect deadlines prevent automatic reuse. Native
AMQP socket destruction is attempted on cleanup timeout. AMQP writes accept
`{ signal }` and reject pending confirms on cancellation. A confirmed AMQP
publication still does not prove business processing. Set `record.options.mandatory`
to require routing: a correlated broker return rejects with `AMQP_UNROUTABLE`
even when the broker also confirms the publish. Supplied `messageId` values stay
unchanged for consumer deduplication. The reserved header
`x-source-to-sink-publish-id` is overwritten with a unique per-publication token
for return correlation; all other supplied headers are preserved. Callers still
own poison-message policies.

`stompSend` now waits for the broker SEND receipt and graceful disconnect. Its
`timeoutMs` (10000) bounds the whole operation and destroys the native client on
timeout. A receipt is not proof of business processing. `stompSource.stop()`
returns a promise, revokes late ACKs, and bounds acceptance draining with
`stopTimeoutMs` (5000). Read/accept waits use `acceptTimeoutMs` (10000). Native STOMP frame streams are
limited before concatenation by `maxMessageBytes` (1048576); `maxPendingBytes`
(default prefetch times maxMessageBytes) caps bodies held by actual acceptance.
Oversized/read-failed frames retire the channel; shared budget leases remain
held through actual acceptance, including after timeout.
The upstream STOMP Channel API initiates close without exposing a transport-close
completion callback; source shutdown proves callback revocation/draining, not
physical socket closure. Manual ACK collectors remain responsible for settlement
and poison-message policy.

AMQP, MQTT, serial, STOMP sources, and `boundedBatch` accept an optional shared `budget` with synchronous
`reserve({ bytes, records: 1 })`, returning an idempotent release function or
throwing on capacity. Source leases cover actual acceptance; batch leases include queued records and
remain held until the actual sink write settles. Leases release on completion
or rejection, including never-written queued records when a batch retires. A timed-out collector that has not actually settled
keeps its reservation; creating another source cannot reclaim those retained
bytes. These counters bound retained payload admission, not native decoder or
transport heap allocations.

A deadline bounds waiting; it does not prove an already-sent external operation
was cancelled. Callers must await shutdown, treat deadline rejection as an
uncertain resource/outcome, and quarantine it rather than immediately reuse it.

## License

MIT


---

← [Durable delivery](../../../docs/collect/durable-delivery.md) · [Operations](../../../docs/operations/README.md) →
