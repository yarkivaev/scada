import processingErrorLog from '../ingest/processingErrorLog.js';

/**
 * PostgreSQL sink for generic operation sync records.
 *
 * Federated deletes call operations.drop, which is idempotent when the row is absent.
 *
 * @param {object} operations - Operations port with upsert(item) and drop(machineId, key)
 * @returns {object} Sink with accept() and remove() methods
 *
 * @example
 *   const sink = operationSyncSink(dataAccess.operations);
 *   await sink.accept({ machine: 'm1', occurred_at: new Date(), kind: 'sample', key: 'nb-1', payload: {} });
 *   await sink.remove({ machine: 'm1', kind: 'sample', key: 'nb-1', occurred_at: new Date() });
 */
export default function operationSyncSink(operations) {
    return {
        async accept(record) {
            try {
                await operations.upsert(record);
            } catch (error) {
                processingErrorLog('operation_sync_sink', error, {
                    machine: record.machine,
                    key: record.key
                });
                throw error;
            }
        },
        async remove(record) {
            try {
                await operations.drop(record.machine, record.key);
            } catch (error) {
                processingErrorLog('operation_sync_sink', error, {
                    machine: record.machine,
                    key: record.key,
                    action: 'remove'
                });
                throw error;
            }
        }
    };
}
