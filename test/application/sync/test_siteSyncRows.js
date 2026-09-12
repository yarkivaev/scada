import assert from 'assert';
import { operationRow, segmentRow } from '../../../src/application/sync/siteSyncRows.js';

describe('siteSyncRows', function() {
    it('maps external_key onto the operations key', function() {
        const key = `bath:icht3:\u00e9${Math.random().toString(36).slice(2)}`;
        const row = operationRow('icht3', {
            external_key: key,
            occurred_at: '2026-09-10T10:29:19.000Z',
            kind: 'bath',
            payload: { weight: 12 }
        });
        assert.strictEqual(row.key, key, 'operationRow did not map external_key to key');
    });

    it('maps segment start onto start_time', function() {
        const start = `2026-09-11T0${Math.floor(Math.random() * 9)}:03:28.000Z`;
        const row = segmentRow('icht1', {
            name: 'off',
            start,
            end: '2026-09-11T00:14:14.000Z',
            duration: 646,
            kind: 'phase'
        });
        assert.strictEqual(row.start_time, start, 'segmentRow did not map start to start_time');
    });
});
