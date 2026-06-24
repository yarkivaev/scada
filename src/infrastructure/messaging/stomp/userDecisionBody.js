/**
 * Builds a user_decisions STOMP payload for supervisor DecisionMessage.Resolve.
 *
 * @param {string} machine - machine id
 * @param {Date} start - segment start time
 * @param {string[]} tags - selected tags
 * @param {object} properties - segment properties
 * @param {object} audit - displayName, id, decidedAt
 * @returns {object} JSON body for stompSend
 */
export default function userDecisionBody(machine, start, tags, properties, audit) {
    const epoch = start.getTime() / 1000;
    const body = {
        machine,
        start: epoch,
        user: audit.displayName,
        tags: tags || [],
        properties: properties || {},
        decided_at: audit.decidedAt.getTime() / 1000
    };
    if (audit.id !== undefined && audit.id !== null) {
        body.operator_id = audit.id;
    }
    return body;
}
