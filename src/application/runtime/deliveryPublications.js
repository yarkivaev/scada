/** A slot and its prospective receipt stay reserved until the actual writer settles. */
/* eslint max-lines-per-function: ["error", 80], max-statements: ["error", 25] */
export default function deliveryPublications(commands, sessions, options) {
    const limit = options.maxInFlight ?? 32;
    if (!Number.isSafeInteger(limit) || limit <= 0) { throw new TypeError('Positive safe maxInFlight required'); }
    const active = new Set();
    function keyOf(record, id) { return JSON.stringify([record.event.eventId, id, record.admission]); }
    function publish(record, id) {
        const key = keyOf(record, id);
        if (active.has(key) || active.size >= limit) { throw new Error('Delivery publication capacity exceeded'); }
        active.add(key);
        let started = false;
        return Promise.resolve(commands.prepare((checkBytes) => {
            const operation = { kind: 'ack', eventId: record.event.eventId, recipient: id, ...(record.admission !== undefined && { admission: record.admission }) };
            const bytes = Buffer.byteLength(JSON.stringify(operation));
            const retainedBytes = Buffer.byteLength(JSON.stringify(record.event));
            checkBytes(bytes, retainedBytes); return { operation, bytes, retainedBytes };
        })).then((receipt) => {
            let write;
            try {
                const descriptor = record.event.destinations.find((item) => { return item.id === id; });
                const event = record.event.observation;
                write = sessions.write(descriptor, { ...event, options: { ...event.options, persistent: true, mandatory: true, messageId: event.eventId } });
            } catch (error) { receipt.cancel(); throw error; }
            started = true;
            const receiptLife = write.settled.then(() => { return receipt.commit(); }, (error) => { receipt.cancel(); throw error; })
                .finally(() => { active.delete(key); });
            void receiptLife.catch(() => {
                // The caller reports failures; late rejection still releases only the actual reservation.
            });
            return write.result.then(() => { return receiptLife; });
        }).catch((error) => {
            if (!started) { active.delete(key); }
            throw error;
        });
    }
    return { publish, limit, available(record, id) { return active.size < limit && !active.has(keyOf(record, id)); } };
}
