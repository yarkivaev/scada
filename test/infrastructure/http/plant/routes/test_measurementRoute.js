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

function mockReq(url) {
    const listeners = {};
    const req = {
        method: 'GET',
        url,
        headers: {},
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

function flagSensor(prefixes) {
    return {
        name() {
            return 'flag';
        },
        async measurements() {
            return [];
        },
        async rises() {
            return prefixes;
        },
        async changes() {
            return [];
        }
    };
}

describe('measurementRoute', function() {
    it('returns rising prefixes when mode is rises', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const at = new Date('2026-09-30T01:00:00.000Z');
        const history = alerts(alert, acknowledgedAlert);
        const item = machine(machineId, {
            sensors: {
                flag: flagSensor([{ timestamp: at, value: 1, unit: '' }])
            },
            alerts: history
        });
        const area = shop('area', initialized({ [machineId]: item }, Object.values), history);
        const api = plantApi('/api/v1', plantDomain(initialized({ area }, Object.values)), {
            clock: virtualClock(() => {
                return new Date('2026-09-30T08:00:00.000Z');
            })
        });
        const res = mockRes();
        await api.handle(
            mockReq(`/api/v1/machines/${machineId}/measurements?keys=flag&from=now-8h&to=now&mode=rises`),
            res
        );
        const item0 = JSON.parse(res.body).items[0];
        assert.deepStrictEqual(
            item0.values,
            [{ timestamp: at.toISOString(), value: 1 }],
            'rises mode returned a downsampled series'
        );
    });
});
