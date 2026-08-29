import assert from 'assert';
import { virtualClock } from '@yarkivaev/simple-server';
import plantApi from '../../../../../src/application/plantApi.js';
import plantDomain from '../../../../../src/domain/plant/plant.js';
import initialized from '../../../../../src/domain/shared/initialized.js';
import shop from '../../../../../src/domain/plant/shop.js';
import machine from '../../../../../src/domain/plant/machine.js';
import { alert, acknowledgedAlert, alerts } from '../../../../../index.js';

function mockRes() {
    return {
        statusCode: 200,
        body: null,
        writeHead(code) {
            this.statusCode = code;
        },
        end(data) {
            this.body = data;
        }
    };
}

function mockReq(meta) {
    const listeners = {};
    const req = {
        method: meta.method,
        url: meta.url,
        headers: meta.headers || {},
        on(event, fn) {
            listeners[event] = fn;
            if (listeners.end) {
                queueMicrotask(() => {
                    listeners.end();
                });
            }
            return req;
        }
    };
    return req;
}

function sensor(value, ts) {
    return {
        name() {
            return 'n';
        },
        async current() {
            if (value === undefined) {
                return { found: false };
            }
            return { found: true, value, timestamp: ts, unit: 'V' };
        }
    };
}

function buildApi(sensors, timeline) {
    const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
    const history = alerts(alert, acknowledgedAlert);
    const item = machine(machineId, { sensors, alerts: history, timeline });
    const area = shop('area', initialized({ [machineId]: item }, Object.values), history);
    const p = plantDomain(initialized({ area }, Object.values));
    const api = plantApi('/api/v1', p, {
        clock: virtualClock(() => {
            return new Date();
        })
    });
    return { api, machineId };
}

describe('stateRoute', function() {
    it('returns sensor current readings with timestamps', async function() {
        const ts = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
        const volts = Math.floor(Math.random() * 400 + 100);
        const scene = buildApi({ voltage: sensor(volts, ts) });
        const res = mockRes();
        await scene.api.handle(
            mockReq({ method: 'GET', url: `/api/v1/machines/${scene.machineId}/state` }),
            res
        );
        const item = JSON.parse(res.body).items[0];
        assert.strictEqual(item.value, volts, 'state omitted the current value');
        assert.strictEqual(item.timestamp, ts.toISOString(), 'state omitted the reading timestamp');
    });

    it('overlays latest interval values onto matching keys', async function() {
        const ts = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
        const later = new Date(Date.UTC(2026, 0, 1, 12, 0, 20));
        const kind = 'ladle_moving';
        const scene = buildApi({ [kind]: sensor(0, ts) }, {
            latest: async () => {
                return [{ kind, name: '1', end_time: later }];
            }
        });
        const res = mockRes();
        await scene.api.handle(
            mockReq({ method: 'GET', url: `/api/v1/machines/${scene.machineId}/state` }),
            res
        );
        const item = JSON.parse(res.body).items[0];
        assert.strictEqual(item.value, 1, 'state did not overlay the interval value');
        assert.strictEqual(item.timestamp, later.toISOString(), 'state did not overlay interval end_time');
    });

    it('returns empty items for an unknown machine', async function() {
        const scene = buildApi({ voltage: sensor(1, new Date()) });
        const res = mockRes();
        await scene.api.handle(
            mockReq({ method: 'GET', url: '/api/v1/machines/missing/state' }),
            res
        );
        assert.deepStrictEqual(JSON.parse(res.body).items, [], 'unknown machine did not return empty items');
    });
});
