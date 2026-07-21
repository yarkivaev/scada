/**
 * Binds silent Modbus streams to a metrics sink and returns an onSeen callback.
 *
 * @example
 *   const onSeen = bindSilentStreams(streams, clickhouseSink);
 *   amqpMetricsIngest(url, queue, sink, { onSeen });
 *
 * @param {object|undefined} streams - silentStreams gate or omitted
 * @param {object} sink - metrics sink with write(records)
 * @returns {Function|undefined} onSeen(name) or undefined
 */
export default function bindSilentStreams(streams, sink) {
    if (!streams) {
        return undefined;
    }
    streams.bind(sink);
    return (name) => {
        streams.seen(name);
    };
}
