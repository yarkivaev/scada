import { checkSplit, familyCover, loadFamily, replaceSplit, splitRows } from '../../../domain/segment/splitFamily.js';

function piece(raw) {
    return {
        start: new Date(Number(raw.start) * 1000),
        end: new Date(Number(raw.end) * 1000),
        tag: raw.tag || '',
        open: Boolean(raw.open)
    };
}

async function applySplit(pool, machine, start, splits) {
    const family = await loadFamily(pool, machine, start);
    if (family.length === 0) {
        return;
    }
    const ordered = checkSplit(familyCover(family), splits.map(piece));
    const [first] = ordered;
    await replaceSplit(pool, { machine, origin: first.start.getTime(), pieces: splitRows(machine, ordered) });
}

/**
 * Applies one operator decision to the segment rows it names.
 * A tag list replaces the stored tags, including an empty list.
 * A split rewrites the off family and keeps each piece tag.
 *
 * @param {object} pool - pg pool
 * @param {string} machine - machine id
 * @param {string} startTime - segment start as an ISO timestamp
 * @param {string} payload - raw user_decisions JSON
 * @returns {Promise<void>}
 *
 * @example
 *   await applyDecision(pool, 'icht2', '2026-11-17T07:17:09.930Z', '{"tags":["to_ladle"]}');
 */
export async function applyDecision(pool, machine, startTime, payload) {
    const body = JSON.parse(payload);
    if (Array.isArray(body.splits)) {
        await applySplit(pool, machine, new Date(startTime), body.splits);
        return;
    }
    if (!Array.isArray(body.tags)) {
        return;
    }
    await pool.query(
        'UPDATE segments SET tags = $1, properties = $2 WHERE machine = $3 AND start_time = $4 AND kind = \'phase\'',
        [JSON.stringify(body.tags), JSON.stringify(body.properties || {}), machine, startTime]
    );
}
