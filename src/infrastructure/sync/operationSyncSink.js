import processingErrorLog from '../ingest/processingErrorLog.js';

/**
 * PostgreSQL sink for generic operation sync records.
 *
 * @param {object} operations - Operations port with upsert(item)
 * @returns {object} Sink with accept() method
 *
 * @example
 *   const sink = operationSyncSink(dataAccess.operations);
 *   await sink.accept({ machine: 'icht1', occurred_at: new Date(), kind: 'chem', key: 'nb-1', payload: {} });
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
        }
    };
}
