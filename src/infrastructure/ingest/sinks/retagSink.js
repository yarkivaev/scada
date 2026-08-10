import processingErrorLog from '../processingErrorLog.js';

/**
 * Sink for applying operator-assigned tags to an existing segment row.
 *
 * Executes a targeted UPDATE that sets tags, properties, clears options,
 * and marks the segment as resolved. Does not touch name, duration, or
 * timestamps, preserving the segment's structural identity.
 *
 * @example
 *   const pool = new pg.Pool({ connectionString: url });
 *   const sink = retagSink(pool);
 *   sink.accept({ machine: 'm2', start_time: '2024-01-01T00:00:00.000Z',
 *                 tags: '["charge_loading"]', properties: '{}' });
 *
 * @param {object} pool - pg Pool (or compatible) with query() method
 * @returns {object} Sink with accept() method
 */
export default function retagSink(pool) {
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('Pool must have a query() method');
    }
    return {
        /**
         * Applies tags and properties to the segment identified by machine and start_time.
         *
         * @param {object} record - Record with machine, start_time, tags, properties
         */
        async accept({ machine, start_time: startTime, tags, properties, options, resolved }) {
            try {
                const opts = options === undefined || options === null ? null : options;
                const flag = typeof resolved === 'boolean' ? resolved : true;
                await pool.query(
                    'UPDATE segments SET tags = $1, properties = $2, options = $3, resolved = $4 WHERE machine = $5 AND start_time = $6',
                    [tags, properties, opts, flag, machine, startTime]
                );
            } catch (error) {
                processingErrorLog('retag_sink_update', error, { machine, startTime, tags, properties });
                throw error;
            }
        }
    };
}
