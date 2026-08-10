import processingErrorLog from '../ingest/processingErrorLog.js';

/**
 * PostgreSQL sink for generic operation sync records.
 *
 * @param {object} operations - Operations port with upsert(item) and remove(machineId, key)
 * @returns {object} Sink with accept() and remove() methods
 *
 * @example
 *   const sink = operationSyncSink(dataAccess.operations);
 *   await sink.accept({ machine: 'm1', occurred_at: new Date(), kind: 'chem', key: 'nb-1', payload: {} });
 *   await sink.remove({ machine: 'm1', kind: 'chem', key: 'nb-1', occurred_at: new Date() });
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
                await operations.remove(record.machine, record.key);
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
