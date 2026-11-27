[Documentation](../README.md) / [Data collection](README.md)

# OPC UA collection

Read from multiple OPC UA endpoints and publish accepted samples through a plant-provided callback or collector.

`@yarkivaev/scada/opcua` exports `opcuaConnections(connections, publish, options)`
and `validateConnections(connections)`. The same entry point exports
`opcuaSource(connections, collector, options)` for source-to-sink composition;
the collector accepts `{ channel, value }`. SCADA owns the OPC UA runtime and
its `node-opcua` dependency; source-to-sink contains no OPC UA implementation.
Offline deployment planners should import
`validateConnections` from `@yarkivaev/scada/opcua/config`; this entry point never
loads the network library or its startup diagnostics. Each connection has a unique `url`,
positive `publishMs` and `heartbeatMs`, and `channels` with explicit, unique
`nodeId` values. Additional channel metadata is opaque to this library.

```js
import opcuaConnections from '@yarkivaev/scada/opcua';

const collector = opcuaConnections([
    { url: 'opc.tcp://192.0.2.10:4840', publishMs: 100, heartbeatMs: 1000,
        channels: [{ nodeId: 'ns=1;s=temperature', topic: 'line/temperature' }] }
], (channel, value) => publish(channel.topic, value));
await collector.start();
// On process shutdown:
await collector.stop();
```

Each endpoint owns its client, session and subscription. An unavailable endpoint
retries independently while others continue. Start schedules these workers; it
does not wait for every server to be available. Samples are delivered only with
Good quality, both on change and through serialized fresh heartbeat reads.
The caller owns value conversion, routing, timestamps and destination transport.
Options `retryMs`, `connectTimeoutMs` and `requestTimeoutMs` bound retry timing and
network requests; `onError(error, connection)` receives connection diagnostics.
Do not replicate a collector with the same sources to distribute load: assign
disjoint source sets to separate instances instead.

See [collector replacement](../operations/upgrades.md#replace-collectors) for a rollout with no overlapping readers.

---

← [Collector runtime](runtime.md) · [Edge assignment controller](edge-controller.md) →
