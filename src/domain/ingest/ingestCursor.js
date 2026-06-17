/**
 * Absent ingest poll cursor for first-run backfill.
 *
 * @returns {{ kind: 'empty' }} discriminated union tag without cursor instant
 *
 * @example
 *   const cursor = ingestCursorEmpty();
 *   cursor.kind;
 */
export function ingestCursorEmpty() {
    return { kind: 'empty' };
}

/**
 * Positioned ingest poll cursor after a processed source batch.
 *
 * @param {Date} at - last processed source updatedAt instant
 * @returns {{ kind: 'cursor', at: Date }} discriminated union tag with cursor instant
 *
 * @example
 *   const cursor = ingestCursorAt(new Date('2024-06-01T10:00:00.000Z'));
 *   cursor.at.toISOString();
 */
export function ingestCursorAt(at) {
    return { kind: 'cursor', at };
}
