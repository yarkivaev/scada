/**
 * Builds a user_decisions STOMP payload for supervisor DecisionMessage.Resolve.
 *
 * @param {string} machine - machine id
 * @param {Date} start - segment start time
 * @param {string} user - operator id for audit
 * @param {string[]} tags - selected tags
 * @param {object} properties - segment properties
 * @returns {object} JSON body for stompSend
 */
export default function userDecisionBody(machine, start, user, tags, properties) {
    const epoch = start.getTime() / 1000;
    return {
        machine,
        start: epoch,
        user,
        tags: tags || [],
        properties: properties || {}
    };
}
