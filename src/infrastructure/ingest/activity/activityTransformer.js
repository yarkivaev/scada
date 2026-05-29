/**
 * Transformer for converting Traefik JSON log entries to activity records.
 *
 * Parses Traefik access log format and extracts user activity fields.
 * Skips entries that cannot be parsed or lack required fields.
 *
 * @example
 *   const transformer = activityTransformer(collector);
 *   transformer.accept({ ts: 123, line: '{"StartUTC":"...","RequestMethod":"GET",...}' });
 *
 * @param {object} collector - Collector with accept() method
 * @returns {object} Transformer with accept() method
 */
export default function activityCodec(collector) {
    if (!collector || typeof collector.accept !== 'function') {
        throw new Error('Collector must have an accept() method');
    }
    return {
        /**
         * Accepts Loki log entry and transforms to activity record.
         *
         * @param {object} entry - Log entry with ts and line
         */
        accept(entry) {
            try {
                const log = JSON.parse(entry.line);
                if (!log.StartUTC || !log.RequestMethod || !log.RequestPath) {
                    return;
                }
                collector.accept({
                    ts: new Date(log.StartUTC).getTime(),
                    user: log['request_Remote-User'] || '',
                    email: log['request_Remote-Email'] || '',
                    method: log.RequestMethod || '',
                    path: log.RequestPath || '',
                    status: parseInt(log.DownstreamStatus, 10) || 0,
                    duration: parseFloat(log.Duration) / 1e9 || 0,
                    ip: log.ClientHost || ''
                });
            } catch {
                // Skip malformed log entries
            }
        }
    };
}
