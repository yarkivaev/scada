/** Encode an upsert or deletion for the operation sync protocol. Kinds and payloads are opaque. */
export default function operationEvent(item) {
    const identity = {
        machine: item.machine,
        occurred_at: item.occurred_at.toISOString(),
        kind: item.kind,
        external_key: item.key
    };
    return item.type === 'deleted' ? { type: 'deleted', ...identity } : { ...identity, payload: item.payload };
}
