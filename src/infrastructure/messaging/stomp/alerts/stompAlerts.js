/**
 * Read-only alert collection backed by PG hydration and STOMP.
 *
 * Loads unacknowledged alerts from PostgreSQL on init, subscribes to
 * STOMP for real-time in-memory updates and SSE delivery.
 *
 * @param {object} hydrate - pgAlerts or compatible port
 * @param {function} source - factory returning STOMP source with start/stop
 * @param {object} translations - map of rule names to human-readable messages
 * @returns {object} alert collection with init, all, find, stream, trigger, stop methods
 *
 * @example
 *   const history = stompAlerts(pgAlerts(pool), sourceFactory, { low_cosphi: 'Выключить...' });
 *   await history.init();
 *   history.all();
 */
import stompAlertsCollection from './stompAlertsCollection.js';

export default function stompAlerts(hydrate, source, translations) {
    return stompAlertsCollection(hydrate, source, translations);
}
