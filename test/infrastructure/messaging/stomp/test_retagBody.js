import assert from 'assert';
import retagBody from '../../../../src/infrastructure/messaging/stomp/retagBody.js';

describe('retagBody', function() {
    it('marks the payload as a retag for the sink dispatch', function() {
        const machine = `ихт-${Math.floor(Math.random() * 9000 + 1000)}`;
        const start = new Date('2026-08-20T12:29:24.318Z');
        const end = new Date('2026-08-20T12:50:10.513Z');
        const tags = [`выдача-${Math.floor(Math.random() * 90)}`];
        const body = retagBody(machine, {
            name: 'off',
            start_time: start,
            end_time: end,
            duration: 1246.194,
            options: '["to_ladle"]'
        }, tags, {});
        assert.strictEqual(body.type, 'retag', 'retag body did not set type retag');
    });

    it('keeps existing options so central retagSink does not wipe them', function() {
        const option = `шихта-${Math.floor(Math.random() * 9000 + 1000)}`;
        const start = new Date('2026-08-20T09:10:22.885Z');
        const body = retagBody('icht1', {
            name: 'off',
            start_time: start,
            end_time: start,
            duration: 0,
            options: JSON.stringify([option])
        }, ['return_pouring'], {});
        assert.deepStrictEqual(body.options, [option], 'retag body dropped standing options');
    });
});
