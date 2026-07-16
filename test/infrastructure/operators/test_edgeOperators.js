import assert from 'assert';
import operator from '../../../src/domain/operator/operator.js';
import operators from '../../../src/infrastructure/operators/operators.js';
import edgeOperators from '../../../src/infrastructure/operators/edgeOperators.js';

describe('edgeOperators', function() {
    it('create posts to central and refreshes local cache from pull', async function() {
        const uid = `edge-create-${Math.random().toString(36).slice(2)}`;
        const cache = operators();
        const created = operator(11, uid.toUpperCase(), 'Наталья', 'Фёдорова', 'Наталья Фёдорова');
        const source = {
            async create(fields) {
                assert.strictEqual(fields.cardUid, uid.toUpperCase(), 'edge create did not forward draft');
                return created;
            },
            async pull() {
                return [created];
            }
        };
        const provider = edgeOperators(cache, source);
        const row = await provider.create({
            cardUid: uid.toUpperCase(),
            firstName: 'Наталья',
            lastName: 'Фёдорова',
            displayName: 'Наталья Фёдорова'
        });
        const rows = await cache.list();
        assert.deepStrictEqual(
            { id: row.id, cached: rows[0].cardUid },
            { id: 11, cached: uid.toUpperCase() },
            'edge operators did not create on central and refresh cache'
        );
    });

    it('create fails without central and leaves cache empty', async function() {
        const cache = operators();
        const provider = edgeOperators(cache, undefined);
        let threw = false;
        try {
            await provider.create({
                cardUid: `NO-CENTRAL-${Math.random().toString(36).slice(2)}`,
                firstName: 'Олег',
                lastName: 'Морозов',
                displayName: 'Олег Морозов'
            });
        } catch {
            threw = true;
        }
        const rows = await cache.list();
        assert.deepStrictEqual(
            { threw, length: rows.length },
            { threw: true, length: 0 },
            'edge operators created a phantom without central'
        );
    });

    it('create leaves cache unchanged when central create fails', async function() {
        const uid = `stale-edge-${Math.random().toString(36).slice(2)}`;
        const cache = operators([operator(1, uid, 'Илья', 'Громов', 'Илья Громов')]);
        const source = {
            async create() {
                throw new Error('central unreachable');
            },
            async pull() {
                return [];
            }
        };
        const provider = edgeOperators(cache, source);
        let threw = false;
        try {
            await provider.create({
                cardUid: `FAIL-${Math.random().toString(36).slice(2)}`,
                firstName: 'Кирилл',
                lastName: 'Белов',
                displayName: 'Кирилл Белов'
            });
        } catch {
            threw = true;
        }
        const rows = await cache.list();
        assert.deepStrictEqual(
            { threw, cardUid: rows[0].cardUid, length: rows.length },
            { threw: true, cardUid: uid, length: 1 },
            'edge operators mutated cache after failed central create'
        );
    });

    it('enabled returns registration flag from local cache', async function() {
        const cache = operators();
        await cache.permit(true);
        const provider = edgeOperators(cache, {
            async create() {
                throw new Error('unused');
            },
            async pull() {
                return [];
            }
        });
        const flag = await provider.enabled();
        assert.strictEqual(flag, true, 'edge operators did not expose cached registration flag');
    });

    it('permit rejects registration flag writes on edge', async function() {
        const provider = edgeOperators(operators(), {
            async create() {
                throw new Error('unused');
            },
            async pull() {
                return [];
            }
        });
        let status = 0;
        try {
            await provider.permit(true);
        } catch (err) {
            status = err.routeStatus;
        }
        assert.strictEqual(status, 405, 'edge operators allowed registration flag write');
    });
});
