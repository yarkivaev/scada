/**
 * Pulls a later fragment of the same segment back onto the previous row
 * when the uncovered gap is still inside the segmentation continuity budget.
 * An overlapping island that starts before the pending heartbeat end stays
 * one segment instead of starting a second span.
 *
 * @param {number} budgetSeconds - maximum uncovered gap that stays one segment
 * @returns {function} apply(record, prior) -> record
 *
 * @example
 *   const apply = segmentContinue(30);
 *   const row = apply(incoming, prior);
 */
export default function segmentContinue(budgetSeconds) {
    return function apply(record, prior) {
        if (!prior || prior.name !== record.name) {
            return record;
        }
        const priorStart = new Date(prior.start_time).toISOString();
        if (priorStart === record.start_time) {
            return record;
        }
        const incomingMs = Date.parse(record.start_time);
        if (incomingMs < Date.parse(priorStart)) {
            return record;
        }
        const gap = incomingMs - Date.parse(prior.end_time);
        if (gap > budgetSeconds * 1000) {
            return record;
        }
        const startMs = Date.parse(priorStart);
        const endMs = Date.parse(record.end_time);
        const duration = record.duration === 0 ? 0 : Math.max(1, (endMs - startMs) / 1000);
        return { ...record, start_time: priorStart, duration };
    };
}
