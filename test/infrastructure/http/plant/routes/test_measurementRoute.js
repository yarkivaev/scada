import assert from 'assert';
import { measurementItem } from '../../../../../src/infrastructure/http/plant/routes/measurementRead.js';
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
        },
        async holds() {
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

    it('returns hold spans with until when mode is holds', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const start = new Date('2026-10-03T13:32:37.000Z');
        const until = new Date('2026-10-04T08:14:12.000Z');
        const size = 700 + Math.floor(Math.random() * 4) * 100;
        const history = alerts(alert, acknowledgedAlert);
        const item = machine(machineId, {
            sensors: {
                diameter: {
                    name() {
                        return 'diameter';
                    },
                    async measurements() {
                        return [];
                    },
                    async rises() {
                        return [];
                    },
                    async changes() {
                        return [];
                    },
                    async holds() {
                        return [{ timestamp: start, value: size, until, unit: 'mm' }];
                    }
                }
            },
            alerts: history
        });
        const area = shop('area', initialized({ [machineId]: item }, Object.values), history);
        const api = plantApi('/api/v1', plantDomain(initialized({ area }, Object.values)), {
            clock: virtualClock(() => {
                return new Date('2026-10-04T08:54:00.000Z');
            })
        });
        const res = mockRes();
        await api.handle(
            mockReq(`/api/v1/machines/${machineId}/measurements?keys=diameter&from=now-60d&to=now&mode=holds&step=3`),
            res
        );
        const item0 = JSON.parse(res.body).items[0];
        assert.deepStrictEqual(
            item0.values,
            [{ timestamp: start.toISOString(), value: size, until: until.toISOString() }],
            'holds mode dropped the coverage until stamp'
        );
    });
});


describe('measurement HTTP continuity serialization', function() {
    it('preserves certified connections, explicit breaks and null separators', function() {
        const rows = [
            {timestamp:new Date(1000),value:42,continuous:false},
            {timestamp:new Date(2000),value:42,continuous:true},
            {timestamp:new Date(3000),value:null},
            {timestamp:new Date(4000),value:42,continuous:false}
        ];
        const values = measurementItem('sensor',{name(){return 'sensor';}},rows).values;
        assert.deepStrictEqual(JSON.parse(JSON.stringify(values)),rows.map((row)=>{
            const point={timestamp:row.timestamp.toISOString(),value:row.value};
            if(typeof row.continuous==='boolean'){point.continuous=row.continuous;}
            return point;
        }));
    });
});
