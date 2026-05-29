/**
 * STOMP-backed timeline write port for one machine.
 *
 * @param {object} decisions - userDecisions with publish(machine, start, tags, properties)
 * @param {string} machineId - machine identifier
 * @returns {object} timeline write port with retag and respond
 *
 * @example
 *   const stomp = stompTimeline(decisions, 'icht1');
 *   await stomp.retag(new Date(), ['on'], {});
 */
export default function stompTimeline(decisions, machineId) {
    return {
        async retag(start, tags, properties) {
            await decisions.publish(machineId, start, tags, properties);
        },
        async respond(start, tags, properties) {
            await decisions.publish(machineId, start, tags, properties);
        }
    };
}
