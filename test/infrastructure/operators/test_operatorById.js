import assert from 'assert';
import operator from '../../../src/domain/operator/operator.js';
import operatorById from '../../../src/infrastructure/operators/operatorById.js';

describe('operatorById', function() {
    it('returns operator row when id exists in provider list', async function() {
        const uid = `card-${Math.random()}`;
        const provider = {
            async list() {
                return [operator(5, uid, 'Анна', 'Козлова', 'Анна Козлова')];
            }
        };
        const lookup = operatorById(provider);
        const row = await lookup.resolve(5);
        assert.strictEqual(row.displayName, 'Анна Козлова', 'operatorById did not return matching operator');
    });

    it('returns undefined when id is absent from provider list', async function() {
        const provider = {
            async list() {
                return [];
            }
        };
        const lookup = operatorById(provider);
        const row = await lookup.resolve(99 + Math.floor(Math.random() * 1000));
        assert.strictEqual(row, undefined, 'operatorById did not return undefined for unknown id');
    });
});
