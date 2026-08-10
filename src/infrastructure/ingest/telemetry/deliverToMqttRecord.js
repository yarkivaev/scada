/**
 * Maps AMQP deliver fields to MQTT publish record.
 *
 * @example
 *   const record = deliverToMqttRecord({ routingKey: 'MX210.m-1.GET.AI1.VALUE' }, Buffer.from('1'));
 *   // record.topic === 'MX210/m-1/GET/AI1/VALUE'
 *
 * @param {object} fields - AMQP deliver fields with routingKey
 * @param {Buffer|string} body - Raw message body
 * @returns {object} Record with topic and payload for mqttSink
 */
export default function deliverToMqttRecord(fields, body) {
    const { routingKey } = fields;
    if (typeof routingKey !== 'string' || routingKey.length === 0) {
        throw new Error('routing key is empty for telemetry deliver');
    }
    const topic = routingKey.replace(/\./gu, '/');
    return { topic, payload: body };
}
