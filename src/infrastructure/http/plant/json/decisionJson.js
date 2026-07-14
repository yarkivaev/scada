function iso(value) {
    if (value instanceof Date) {
        return value.toISOString();
    }
    return new Date(value).toISOString();
}

function body(raw) {
    if (typeof raw !== 'string') {
        return raw;
    }
    return JSON.parse(raw);
}

/**
 * Maps a user_decisions audit row to Plant API JSON item.
 *
 * @param {object} row - username, operatorId, decidedAt, payload
 * @returns {object} JSON-serializable decision with operator display and tags
 *
 * @example
 *   decisionJson({
 *     username: 'Елена Волкова', operatorId: 2,
 *     decidedAt: new Date('2024-06-01T12:05:00.000Z'),
 *     payload: '{"tags":["charge_loading"]}'
 *   });
 */
export default function decisionJson(row) {
    const payload = body(row.payload);
    const item = {
        operator: row.username,
        payload
    };
    if (row.operatorId !== undefined && row.operatorId !== null) {
        item.operatorId = row.operatorId;
    }
    if (row.decidedAt !== undefined && row.decidedAt !== null) {
        item.decidedAt = iso(row.decidedAt);
    }
    if (payload && Array.isArray(payload.tags)) {
        item.tags = payload.tags;
    }
    return item;
}
