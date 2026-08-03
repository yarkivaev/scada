/**
 * Stamps operator audit into an operation payload and builds decision rows.
 *
 * @example
 *   const next = stampPayload(payload, audit);
 *   const row = decisionRow(machine, item, audit, 'create');
 */

/**
 * Copies payload and adds operator display fields from audit.
 *
 * @param {*} payload - original operation payload
 * @param {object} audit - { id, displayName, decidedAt }
 * @returns {object} stamped payload object
 */
export function stampPayload(payload, audit) {
    const base = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? { ...payload }
        : { value: payload };
    base.operator = audit.displayName;
    base.decided_at = audit.decidedAt.toISOString();
    if (audit.id !== undefined && audit.id !== null) {
        base.operator_id = audit.id;
    }
    return base;
}

/**
 * Builds a user_decisions insert row for an operation write.
 *
 * @param {string} machine - machine id
 * @param {object} item - operation with key, kind, occurred_at, payload
 * @param {object} audit - resolved operator audit
 * @param {string} verb - create | update | delete
 * @returns {object} insert row for userDecisions.insert
 */
export function decisionRow(machine, item, audit, verb) {
    const kind = item.kind === 'bath' ? 'bath_op' : 'operation_op';
    return {
        machine: machine,
        startTime: item.occurred_at instanceof Date
            ? item.occurred_at
            : new Date(item.occurred_at),
        username: audit.displayName,
        operatorId: audit.id,
        decidedAt: audit.decidedAt,
        payload: {
            kind: kind,
            verb: verb,
            key: item.key,
            operation_kind: item.kind,
            occurred_at: item.occurred_at instanceof Date
                ? item.occurred_at.toISOString()
                : new Date(item.occurred_at).toISOString()
        }
    };
}
