import assert from 'node:assert/strict';
import controlStore from '../../../src/application/control/controlStore.js';

function memory() {
    const rows = new Map();
    return async (path, body) => {
        if (path === '/v3/kv/put') {
            rows.set(Buffer.from(body.key, 'base64').toString(), Buffer.from(body.value, 'base64').toString());
            return {};
        }
        if (path === '/v3/kv/range') {
            const key = Buffer.from(body.key, 'base64').toString();
            const value = rows.get(key);
            return value === undefined ? { kvs: [] } : { kvs: [{ key: body.key, value: Buffer.from(value).toString('base64') }] };
        }
        return {};
    };
}

describe('control store cursors', () => {
    it('returns the saved AWGS high-water for that task', async () => {
        const store = controlStore(memory(), '/scada/control');
        const water = { id: 91, weights: { 'см1': 12 } };
        await store.cursor.save('sokol-awgs:печь', water);
        assert.deepEqual(await store.cursor.load('sokol-awgs:печь'), water, 'saved high-water was not the loaded cursor');
    });
});
