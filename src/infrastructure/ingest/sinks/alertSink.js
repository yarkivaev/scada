import { alertIngestAction } from '../../../domain/alerting/ingest.js';
import processingErrorLog from '../processingErrorLog.js';

/**
 * PostgreSQL sink for alert records with INSERT/UPDATE branching.
 *
 * @param {object} pool - pg.Pool instance with query() method
 * @returns {object} Sink with accept() and stop() methods
 *
 * @example
 *   const sink = alertSink(pool);
 *   await sink.accept({ name: 'low_cosphi', message: 'msg', machine: 'm2', severity: 'warning', status: 'pending', timestamp: '2023-11-14T22:13:20.000Z' });
 */
export default function alertSink(pool) {
    return {
        async accept(record) {
            try {
                const action = alertIngestAction(record);
                if (action === 'insert') {
                    await pool.query(
                        'INSERT INTO alerts (name, message, machine, severity, timestamp) VALUES ($1, $2, $3, $4, $5)',
                        [record.name, record.message, record.machine, record.severity, record.timestamp]
                    );
                } else if (action === 'acknowledge') {
                    await pool.query(
                        'UPDATE alerts SET acknowledged = TRUE WHERE name = $1 AND machine = $2 AND acknowledged = FALSE',
                        [record.name, record.machine]
                    );
                }
            } catch (error) {
                processingErrorLog('alert_sink_write', error, {
                    name: record.name,
                    machine: record.machine,
                    status: record.status
                });
                throw error;
            }
        },
        async stop() {
            await pool.end();
        }
    };
}
