/**
 * Maps an OPC UA metrics record to an interval sample.
 *
 * @param {object} devices - device id to machine id
 * @returns {function(object): object|null} locator
 *
 * @example
 *   const locate = opcuaLocate({ 'tlc-line-8': 'line-8' });
 *   locate({ topic: 'OPCUA/tlc-line-8/GET/axis_moving/VALUE', value: 1, ts: 1 });
 */
export default function opcuaLocate(devices) {
    const map = devices || {};
    return (record) => {
        const parts = String(record.topic || '').split('/');
        if (parts[0] !== 'OPCUA' || parts[2] !== 'GET' || parts[4] !== 'VALUE') {
            return null;
        }
        const machine = map[parts[1]];
        if (!machine) {
            return null;
        }
        return { machine, kind: parts[3], value: record.value, ts: record.ts };
    };
}
