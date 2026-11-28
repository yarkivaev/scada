import assert from 'node:assert/strict';
import { createOnlyJSON } from '../../../src/application/control/index.js';

describe('createOnlyJSON', () => {
    it('compares the version to zero and returns the existing JSON when another writer wins', async () => {
        const existing = { owner: 'fixture-east' };
        const proposed = { owner: 'fixture-west' };
        const key = Buffer.from('/fixtures/first').toString('base64');
        let won = true;
        const store = createOnlyJSON((route, transaction) => {
            assert.equal(route, '/v3/kv/txn');
            assert.deepEqual(transaction.compare, [{ key, target: 'VERSION', result: 'EQUAL', version: '0' }]);
            assert.deepEqual(transaction.failure, [{ requestRange: { key } }]);
            assert.deepEqual(JSON.parse(Buffer.from(transaction.success[0].requestPut.value, 'base64')), proposed);
            return won ? { succeeded: true } : {
                succeeded: false,
                responses: [{ response_range: { kvs: [{ value: Buffer.from(JSON.stringify(existing)).toString('base64') }] } }]
            };
        }, '/fixtures/');
        assert.deepEqual(await store.reserve('first', proposed), { won: true, record: proposed });
        won = false;
        assert.deepEqual(await store.reserve('first', proposed), { won: false, record: existing });
    });

    it('uses a bytewise prefix bound and decodes the returned keys and values', async () => {
        const prefix = '/fixtures/¿';
        const value = Buffer.from('{"ready":true}').toString('base64');
        const store = createOnlyJSON((route, query) => {
            assert.equal(route, '/v3/kv/range');
            assert.equal(query.key, Buffer.from(prefix).toString('base64'));
            const expected = Buffer.from(prefix);
            expected[expected.length - 1] += 1;
            assert.deepEqual(Buffer.from(query.rangeEnd, 'base64'), expected);
            return { kvs: [{ key: Buffer.from(`${prefix  }sensor`).toString('base64'), value }] };
        }, prefix);
        assert.deepEqual(await store.list(), [{ id: 'sensor', record: { ready: true } }]);
    });
});
