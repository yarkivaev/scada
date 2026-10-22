import assert from 'assert';
import metricsPlant from '../../src/application/metricsPlant.js';

describe('metricsPlant alerts', function() {
    it('exposes pgAlerts on the plant when a pool exists', async function() {
        const machine = `ихт-δ-${Math.floor(Math.random() * 9000 + 1000)}`;
        const listed = [];
        const pool = {
            async query(sql, params) {
                listed.push({ params, sql: String(sql) });
                return { rows: [] };
            }
        };
        const built = await metricsPlant([{ device: 'α-1', machine }], {
            buildSensors() {
                return {};
            },
            connection() {
                return Promise.resolve({});
            },
            pool,
            shopFactory() {
                return {
                    alerts: {},
                    init() {},
                    machines: {
                        get() {
                            return {};
                        },
                        init() {}
                    },
                    name() {
                        return 'цех';
                    }
                };
            }
        });
        await built.alerts.list({ machine });
        assert.strictEqual(
            listed[0].sql.includes('FROM alerts'),
            true,
            'metricsPlant did not wire pgAlerts when a pool exists'
        );
    });
});
