import assert from 'assert';
import opcuaLocate from '../../../../src/infrastructure/ingest/telemetry/opcuaLocate.js';

describe('opcuaLocate', function() {
    it('maps an OPC UA topic to a machine interval sample', function() {
        const machine = `cm${Math.floor(Math.random() * 90 + 10)}`;
        const key = `ladle_${Math.random().toString(36).slice(2, 8)}`;
        const locate = opcuaLocate({ 'tlc-cm8': machine });
        const ts = Date.now();
        const sample = locate({
            topic: `OPCUA/tlc-cm8/GET/${key}/VALUE`,
            value: 1,
            ts
        });
        assert.deepStrictEqual(sample, { machine, kind: key, value: 1, ts }, 'OPC UA topic was not mapped');
    });

    it('ignores non OPC UA topics', function() {
        const locate = opcuaLocate({ 'tlc-cm8': 'cm8' });
        const sample = locate({ topic: 'MX210/icht-1/GET/AI1/VALUE', value: 12, ts: Date.now() });
        assert.strictEqual(sample, null, 'non OPC UA topic produced a sample');
    });
});
