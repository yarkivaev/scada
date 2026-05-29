import timeline from '../domain/timeline/timeline.js';
import pgTimeline from '../infrastructure/persistence/pg/timeline.js';
import memoryTimelineFull from '../infrastructure/persistence/memory/timeline.js';
import stompTimeline from '../infrastructure/messaging/stomp/timeline.js';

/**
 * Builds a machine timeline from PostgreSQL persistence and STOMP user decisions.
 *
 * @param {string} name - machine id
 * @param {object} options - pool and userDecisions ports
 * @returns {object} timeline port
 *
 * @example
 *   const tl = shopWithTimeline('machine1', { pool, userDecisions });
 */
export default function shopWithTimeline(name, options) {
    const { pool, userDecisions: decisions } = options;
    if (pool && decisions) {
        return timeline(pgTimeline(pool, name), stompTimeline(decisions, name));
    }
    return memoryTimelineFull();
}
