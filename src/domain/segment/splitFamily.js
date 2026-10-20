const MIN_MS = 60000;

function dated(piece) {
    return {
        start: new Date(piece.start),
        end: new Date(piece.end),
        tag: piece.tag || '',
        open: Boolean(piece.open)
    };
}

function byStart(left, right) {
    return left.start - right.start;
}

function hasTag(piece) {
    return Boolean(piece.tag);
}

function refuseGap(ordered, piece, index) {
    const last = index === ordered.length - 1;
    if (piece.open && !last) {
        throw new RangeError('open piece is not the tail');
    }
    if (index > 0 && ordered[index - 1].end.getTime() !== piece.start.getTime()) {
        throw new RangeError('split has a gap');
    }
}

function refuseSpan(piece) {
    const span = piece.end.getTime() - piece.start.getTime();
    if (!piece.open && span < MIN_MS) {
        throw new RangeError('piece is shorter than 60 seconds');
    }
    if (piece.open && span < 0) {
        throw new RangeError('open tail ends before it starts');
    }
}

function refuseCover(parent, tail) {
    if (parent.duration === 0) {
        return;
    }
    const end = new Date(parent.end_time).getTime();
    if (tail.open || tail.end.getTime() !== end) {
        throw new RangeError('closed off is not covered through its end');
    }
}

function orderedPieces(parent, splits) {
    if (!parent || parent.name !== 'off') {
        throw new RangeError(`refusing to split ${parent && parent.name}`);
    }
    if (!Array.isArray(splits) || splits.length === 0) {
        throw new RangeError('refusing an empty split');
    }
    const ordered = splits.map(dated).sort(byStart);
    if (ordered[0].start.getTime() !== new Date(parent.start_time).getTime()) {
        throw new RangeError('split must keep the original start');
    }
    if (!ordered.some(hasTag)) {
        throw new RangeError('split has no tagged piece');
    }
    return ordered;
}

function visit(ordered, piece, index) {
    refuseGap(ordered, piece, index);
    refuseSpan(piece);
}

function rowOf(machine, origin, piece) {
    return {
        type: 'split',
        machine,
        name: 'off',
        kind: 'phase',
        start_time: piece.start.toISOString(),
        end_time: piece.end.toISOString(),
        duration: piece.open ? 0 : (piece.end.getTime() - piece.start.getTime()) / 1000,
        options: null,
        tags: piece.tag ? JSON.stringify([piece.tag]) : null,
        properties: JSON.stringify({ split_of: origin }),
        resolved: true,
        updated_at: new Date().toISOString()
    };
}

function startOf(piece) {
    return piece.start_time;
}

function writePiece(client, piece) {
    return client.query(
        `INSERT INTO segments
            (machine, kind, name, start_time, end_time, duration, options, tags, properties, resolved, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (machine, kind, start_time) DO UPDATE SET
            name = EXCLUDED.name,
            end_time = EXCLUDED.end_time,
            duration = EXCLUDED.duration,
            options = EXCLUDED.options,
            tags = EXCLUDED.tags,
            properties = EXCLUDED.properties,
            resolved = EXCLUDED.resolved,
            updated_at = EXCLUDED.updated_at`,
        [piece.machine, piece.kind, piece.name, piece.start_time, piece.end_time, piece.duration,
            piece.options, piece.tags, piece.properties, piece.resolved, piece.updated_at]
    );
}

function nextPiece(client, chain, piece) {
    return chain.then(() => {
        return writePiece(client, piece);
    });
}

async function writePieces(client, pieces) {
    await pieces.reduce((chain, piece) => {
        return nextPiece(client, chain, piece);
    }, Promise.resolve());
}

function openRow(row) {
    return row.duration === 0 || row.duration === '0';
}

function byRowStart(left, right) {
    return new Date(left.start_time) - new Date(right.start_time);
}

function widen(span, row) {
    const end = new Date(row.end_time).getTime();
    if (row.name !== 'off') {
        throw new RangeError(`refusing to split ${row.name}`);
    }
    return {
        end: end > span.end ? end : span.end,
        pending: span.pending || openRow(row)
    };
}

function refuseEmpty(record) {
    if (!record || !Array.isArray(record.pieces) || record.pieces.length === 0) {
        throw new RangeError('refusing an empty split');
    }
}

async function removeObsolete(client, record) {
    const starts = record.pieces.map(startOf);
    const origin = new Date(Number(record.origin)).toISOString();
    await client.query(
        `DELETE FROM segments
         WHERE machine = $1 AND kind = 'phase'
           AND (start_time = $2 OR (properties IS NOT NULL AND properties::jsonb ->> 'split_of' = $3))
           AND NOT (start_time = ANY($4::timestamptz[]))`,
        [record.machine, origin, String(record.origin), starts]
    );
}

/**
 * Reads every phase row of one split family. The key is the original
 * start: the first piece keeps that start_time, later pieces store it
 * in properties.split_of as epoch millis.
 *
 * @param {object} pool - pg pool
 * @param {string} machine - machine id
 * @param {Date} start - original off start
 * @returns {Promise<Array<object>>} family rows ordered by start
 */
export async function loadFamily(pool, machine, start) {
    const result = await pool.query(
        `SELECT name, start_time, end_time, duration, properties
         FROM segments
         WHERE machine = $1 AND kind = 'phase'
           AND (start_time = $2 OR (properties IS NOT NULL AND properties::jsonb ->> 'split_of' = $3))
         ORDER BY start_time`,
        [machine, start, String(start.getTime())]
    );
    return result.rows;
}

/**
 * Bounds of one stored family. A later edit must cover this span, so
 * collapsing every piece but one restores the original start and end.
 *
 * @param {Array<object>} rows - phase rows of one family
 * @returns {object} parent off with start_time, end_time, and duration
 *
 * @example
 *   const parent = familyCover(await loadFamily(pool, machine, start));
 */
export function familyCover(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new RangeError('split family is empty');
    }
    const ordered = rows.slice().sort(byRowStart);
    const start = new Date(ordered[0].start_time).getTime();
    const span = ordered.reduce(widen, { end: start, pending: false });
    return {
        name: 'off',
        start_time: new Date(start),
        end_time: new Date(span.end),
        duration: span.pending ? 0 : (span.end - start) / 1000
    };
}

/**
 * Checks one operator split against the parent off row.
 * Pieces stay contiguous, the first keeps the parent start, a closed
 * parent is covered through its end, and at least one piece has a tag.
 *
 * @param {object} parent - off row with name, start_time, end_time, duration
 * @param {Array<object>} splits - pieces with start, end, tag, open
 * @returns {Array<object>} pieces ordered by start
 */
export function checkSplit(parent, splits) {
    const ordered = orderedPieces(parent, splits);
    ordered.forEach((piece, index) => {
        visit(ordered, piece, index);
    });
    refuseCover(parent, ordered[ordered.length - 1]);
    return ordered;
}

/**
 * Builds persistence rows for one checked split. split_of is the parent
 * start in epoch millis so a later edit can find the whole family.
 *
 * @param {string} machine - machine id
 * @param {Array<object>} splits - checked pieces
 * @returns {Array<object>} segment rows
 */
export function splitRows(machine, splits) {
    const origin = String(splits[0].start.getTime());
    return splits.map((piece) => {
        return rowOf(machine, origin, piece);
    });
}

/**
 * Replaces one split family inside a transaction: drops starts that the
 * new cut no longer uses, then upserts the pieces.
 *
 * @param {object} pool - pg pool with connect()
 * @param {object} record - machine, origin millis, pieces
 * @returns {Promise<void>}
 */
export async function replaceSplit(pool, record) {
    refuseEmpty(record);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await removeObsolete(client, record);
        await writePieces(client, record.pieces);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
