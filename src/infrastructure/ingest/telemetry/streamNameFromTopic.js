/**
 * Extracts the stream id from a metrics MQTT/AMQP topic path.
 *
 * @example
 *   streamNameFromTopic('MX210/m-1/GET/AI1/VALUE') === 'MX210/m-1'
 *
 * @param {string} topic - Slash-separated topic
 * @returns {string|undefined} Source-family/device id
 */
export default function streamNameFromTopic(topic) {
    if (typeof topic !== 'string' || topic.length === 0) {
        return undefined;
    }
    const parts = topic.split('/').filter((part) => {
        return part.length > 0;
    });
    if (parts.length < 2) {
        return undefined;
    }
    return `${parts[0]}/${parts[1]}`;
}
