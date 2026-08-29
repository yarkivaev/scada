import machineInPlant from '../../../../application/machineInPlant.js';
import { jsonResponse, route } from '@yarkivaev/simple-server';

/**
 * Maps a sensor current() row to a state item.
 *
 * @param {object} sensor - sensor with current()
 * @param {string} key - sensor key
 * @returns {Promise<object>} state item
 */
async function readingOf(sensor, key) {
    const row = await sensor.current();
    if (!row.found) {
        return { key, found: false };
    }
    return {
        key,
        found: true,
        value: row.value,
        timestamp: row.timestamp.toISOString(),
        unit: row.unit
    };
}

/**
 * Overlays latest interval rows onto sensor snapshot items.
 *
 * @param {Array<object>} items - state items
 * @param {Array<object>} rows - latest timeline rows
 * @returns {Array<object>} items
 */
function overlay(items, rows) {
    const byKey = new Map(items.map((item) => {
        return [item.key, item];
    }));
    rows.forEach((row) => {
        const item = byKey.get(row.kind);
        if (!item) {
            return;
        }
        item.found = true;
        item.value = Number(row.name);
        item.timestamp = row.end_time.toISOString();
    });
    return items;
}

/**
 * Builds the latest machine snapshot from sensors and intervals.
 *
 * @param {object} machine - plant machine
 * @returns {Promise<Array<object>>} state items
 */
async function snapshot(machine) {
    const keys = Object.keys(machine.sensors || {});
    const items = await Promise.all(keys.map((key) => {
        return readingOf(machine.sensors[key], key);
    }));
    if (!machine.timeline || typeof machine.timeline.latest !== 'function') {
        return items;
    }
    const rows = await machine.timeline.latest(keys);
    return overlay(items, rows);
}

/**
 * Latest machine state route.
 *
 * @param {string} basePath - API prefix
 * @param {object} plant - plant domain
 * @returns {array} routes
 *
 * @example
 *   stateRoute('/api/v1', plant);
 */
export default function stateRoute(basePath, plant) {
    return [
        route('GET', `${basePath}/machines/:machineId/state`, async (req, res, params) => {
            const result = machineInPlant(plant, params.machineId);
            if (!result) {
                jsonResponse({ items: [] }).send(res);
                return;
            }
            jsonResponse({ items: await snapshot(result.machine) }).send(res);
        })
    ];
}
