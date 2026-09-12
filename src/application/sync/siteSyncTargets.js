import { postgresSink } from '@yarkivaev/source-to-sink';
import {
    alertRow,
    listedItems,
    measurementRows,
    operationRow,
    segmentRow
} from './siteSyncRows.js';
import {
    segmentColumns,
    segmentConflict,
    segmentUpdateColumns
} from '../../infrastructure/ingest/pipelines/segmentPipeline.js';

/**
 * Default local write targets for site sync kinds.
 *
 * @param {object} ports - pool, postgres, operations, alerts, metrics, topic
 * @returns {object} kind → { write(machine, body) }
 *
 * @example
 *   siteSyncTargets({ operations, postgres, pool, alerts, metrics, topic });
 */
function segmentTarget(postgres, pool) {
    const sink = postgresSink(postgres, 'segments', segmentColumns, {
        pool,
        conflict: segmentConflict,
        update: segmentUpdateColumns
    });
    return {
        async write(machine, body) {
            const rows = listedItems(body).map((item) => {
                return segmentRow(machine, item);
            });
            if (rows.length > 0) {
                await sink.write(rows);
            }
            return rows.length;
        }
    };
}

function operationTarget(operations) {
    return {
        async write(machine, body) {
            const rows = listedItems(body).map((item) => {
                return operationRow(machine, item);
            });
            if (rows.length > 0) {
                await operations.upsertMany(rows);
            }
            return rows.length;
        }
    };
}

function measurementTarget(metrics, topic) {
    return {
        async write(machine, body) {
            const rows = measurementRows(machine, body, topic);
            if (rows.length > 0) {
                await metrics.write(rows);
            }
            return rows.length;
        }
    };
}

function alertTarget(alerts) {
    return {
        async write(machine, body) {
            const rows = listedItems(body).map((item) => {
                return alertRow(machine, item);
            });
            await Promise.all(rows.map((row) => {
                return alerts.put(row);
            }));
            return rows.length;
        }
    };
}

export default function siteSyncTargets(ports) {
    const targets = {};
    if (ports.postgres && ports.pool) {
        targets.segments = segmentTarget(ports.postgres, ports.pool);
    }
    if (ports.operations) {
        targets.operations = operationTarget(ports.operations);
    }
    if (ports.metrics && ports.topic) {
        targets.measurements = measurementTarget(ports.metrics, ports.topic);
    }
    if (ports.alerts && typeof ports.alerts.put === 'function') {
        targets.alerts = alertTarget(ports.alerts);
    }
    return Object.freeze(targets);
}
