import assert from 'assert';
import exportQuery from '../../../src/application/export/exportQuery.js';

describe('exportQuery', function() {
    it('returns machines from the client', async function() {
        const label = `plant-${Math.random().toString(36).slice(2)}`;
        const query = exportQuery({
            machines() {
                return Promise.resolve({ items: [{ id: label }] });
            },
            machine() {
                return {};
            }
        });
        const body = await query.machines();
        assert.strictEqual(body.items[0].id, label, 'exportQuery did not return machines from the client');
    });

    it('reads measurements for a machine range', async function() {
        const machineId = `furnace-${Math.random().toString(36).slice(2)}`;
        const from = `2026-0${1 + Math.floor(Math.random() * 9)}-01T00:00:00Z`;
        let seen;
        const query = exportQuery({
            machines() {
                return Promise.resolve({ items: [] });
            },
            machine(id) {
                return {
                    measurements(range) {
                        seen = { id, range };
                        return Promise.resolve({ items: [{ key: 'U' }] });
                    }
                };
            }
        });
        await query.measurements(machineId, { from, to: '2026-07-29T12:00:00Z', step: 60 });
        assert.deepStrictEqual(
            seen,
            { id: machineId, range: { from, to: '2026-07-29T12:00:00Z', step: 60 } },
            'exportQuery did not pass the measurement range to the client'
        );
    });

    it('reads segments for a machine range', async function() {
        const machineId = `line-${Math.random().toString(36).slice(2)}`;
        const tag = `off-${Math.random().toString(36).slice(2)}`;
        const query = exportQuery({
            machines() {
                return Promise.resolve({ items: [] });
            },
            machine() {
                return {
                    segments() {
                        return Promise.resolve({ items: [{ tags: [tag] }] });
                    }
                };
            }
        });
        const body = await query.segments(machineId, { from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' });
        assert.strictEqual(body.items[0].tags[0], tag, 'exportQuery did not return segments from the client');
    });

    it('reads alerts for a machine', async function() {
        const alertId = `a-${Math.random().toString(36).slice(2)}`;
        const query = exportQuery({
            machines() {
                return Promise.resolve({ items: [] });
            },
            machine() {
                return {
                    alerts() {
                        return Promise.resolve({ items: [{ id: alertId }] });
                    }
                };
            }
        });
        const body = await query.alerts(`m-${Math.random().toString(36).slice(2)}`, { page: 1 });
        assert.strictEqual(body.items[0].id, alertId, 'exportQuery did not return alerts from the client');
    });

    it('reads operations for a machine', async function() {
        const kind = `chem-${Math.random().toString(36).slice(2)}`;
        const query = exportQuery({
            machines() {
                return Promise.resolve({ items: [] });
            },
            machine() {
                return {
                    operations() {
                        return Promise.resolve([{ kind }]);
                    }
                };
            }
        });
        const rows = await query.operations(`m-${Math.random().toString(36).slice(2)}`, { kind, from: '2026-03-01T00:00:00Z' });
        assert.strictEqual(rows[0].kind, kind, 'exportQuery did not return operations from the client');
    });

    it('forwards operation options to the client', async function() {
        const kind = `kind-${Math.random().toString(36).slice(2)}`;
        let seen;
        const query = exportQuery({
            machines() {
                return Promise.resolve({ items: [] });
            },
            machine() {
                return {
                    operations(options) {
                        seen = options;
                        return Promise.resolve([]);
                    }
                };
            }
        });
        await query.operations(`m-${Math.random().toString(36).slice(2)}`, { kind, from: '2026-03-01T00:00:00Z' });
        assert.deepStrictEqual(
            seen,
            { kind, from: '2026-03-01T00:00:00Z' },
            'exportQuery dropped operation options'
        );
    });
});
