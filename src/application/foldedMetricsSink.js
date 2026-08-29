import intervalFold from '../domain/segment/intervalFold.js';
import intervalFoldPg from '../infrastructure/persistence/pg/intervalFoldPg.js';
import foldingSink from '../infrastructure/ingest/telemetry/foldingSink.js';
import opcuaLocate from '../infrastructure/ingest/telemetry/opcuaLocate.js';

/**
 * Wraps a metrics sink so OPC UA points also fold into PG intervals.
 *
 * @param {object} inner - sink with write(records)
 * @param {object} pool - pg Pool
 * @param {object} devices - device id to machine id
 * @returns {object} sink
 *
 * @example
 *   const sink = foldedMetricsSink(pgMetrics, pool, { 'tlc-cm8': 'cm8' });
 */
export default function foldedMetricsSink(inner, pool, devices) {
    if (!devices || Object.keys(devices).length === 0) {
        return inner;
    }
    return foldingSink(inner, intervalFold(intervalFoldPg(pool)), opcuaLocate(devices));
}
