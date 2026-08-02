import assert from 'assert';
import operationCodec from '../../../src/infrastructure/sync/operationCodec.js';

describe('operationCodec', function() {
    it('maps external_key to storage key', async function() {
        const suffix = Math.random().toString(36).slice(2);
        const accepted = [];
        const collector = {
            accept(record) {
                accepted.push(record);
                return Promise.resolve();
            }
        };
        const codec = operationCodec(collector);
        const body = JSON.stringify({
            machine: 'icht1',
            occurred_at: '2024-06-01T10:00:00.000Z',
            kind: 'chem',
            external_key: `nb-${suffix}`,
            payload: { carbon: 0.1 }
        });
        await codec.accept(Buffer.from(body));
        assert.strictEqual(accepted[0].key, `nb-${suffix}`, 'external_key must map to key');
    });
});

describe('operationCodec validation', function() {
    it('throws when machine field is missing', async function() {
        const codec = operationCodec({ accept() { return Promise.resolve(); } });
        const body = JSON.stringify({
            occurred_at: '2024-06-01T10:00:00.000Z',
            kind: 'chem',
            external_key: `nb-${Math.random()}`,
            payload: {}
        });
        await assert.rejects(
            () => { return codec.accept(Buffer.from(body)); },
            /Operation missing machine field/u,
            'did not reject payload without machine'
        );
    });
});

describe('operationCodec occurred_at', function() {
    it('accepts epoch milliseconds for occurred_at', async function() {
        const accepted = [];
        const collector = {
            accept(record) {
                accepted.push(record);
                return Promise.resolve();
            }
        };
        const codec = operationCodec(collector);
        const epoch = 1700000000000;
        const body = JSON.stringify({
            machine: 'icht1',
            occurred_at: epoch,
            kind: 'chem',
            external_key: `nb-${Math.random()}`,
            payload: { note: 'проба' }
        });
        await codec.accept(Buffer.from(body));
        assert.strictEqual(
            accepted[0].occurred_at.getTime(),
            epoch,
            'epoch occurred_at must parse to matching instant'
        );
    });
});

describe('operationCodec deleted', function() {
    it('routes type deleted to collector remove with storage key', async function() {
        const removed = [];
        const collector = {
            accept() {
                return Promise.resolve();
            },
            remove(record) {
                removed.push(record);
                return Promise.resolve();
            }
        };
        const codec = operationCodec(collector);
        const key = `gone-${Math.random().toString(36).slice(2)}`;
        const body = JSON.stringify({
            type: 'deleted',
            machine: 'icht2',
            occurred_at: '2024-06-01T14:00:00.000Z',
            kind: 'bath',
            external_key: key
        });
        await codec.accept(Buffer.from(body));
        assert.deepStrictEqual(removed[0], {
            machine: 'icht2',
            occurred_at: new Date('2024-06-01T14:00:00.000Z'),
            kind: 'bath',
            key
        }, 'deleted event must call remove with mapped key');
    });
});
