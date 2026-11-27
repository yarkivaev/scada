import assert from 'assert';
import { virtualClock } from '@yarkivaev/simple-server';
import { assertThat, hasSegmentCreatedOnOpenStream } from '../../../../helpers/matchers.js';
import segmentStreamScene from '../../../../helpers/segmentStreamScene.js';
import plantApi from '../../../../../src/application/plantApi.js';
import plantDomain from '../../../../../src/domain/plant/plant.js';
import initialized from '../../../../../src/domain/shared/initialized.js';
import shop from '../../../../../src/domain/plant/shop.js';
import machine from '../../../../../src/domain/plant/machine.js';
import { alert, acknowledgedAlert, alerts } from '../../../../../index.js';

describe('timelineStream', function() {
    it('delivers segment_created on SSE when supervisor persists segment after stream opens', async function() {
        assertThat(await segmentStreamScene().afterSupervisorPersist(), hasSegmentCreatedOnOpenStream());
    });

    it('emits decorated options on segment_created', async function() {
        const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        let publish;
        const history = alerts(alert, acknowledgedAlert);
        const timeline = {
            list: async () => {
                return [];
            },
            pending: async () => {
                return [];
            },
            stream: (fn) => {
                publish = fn;
                return { cancel() {} };
            }
        };
        const item = machine(machineId, { sensors: {}, alerts: history, timeline });
        const area = shop('area', initialized({ [machineId]: item }, Object.values), history);
        const api = plantApi('/api/v1', plantDomain(initialized({ area }, Object.values)), {
            clock: virtualClock(() => {
                return new Date();
            }),
            decorateTimeline: (_id, rows) => {
                return rows.map((row) => {
                    return { ...row, options: ['repair_emergency'] };
                });
            }
        });
        const chunks = [];
        await api.handle(
            { method: 'GET', url: `/api/v1/machines/${machineId}/segments/stream`, headers: {}, on() {} },
            { writeHead() {}, write(content) { chunks.push(content); }, end() {} }
        );
        const start = new Date();
        await publish({
            type: 'created',
            segment: {
                name: 'off',
                start_time: start,
                end_time: start,
                duration: 0,
                options: ['repair']
            }
        });
        assert.ok(chunks.join('').includes('repair_emergency'), 'stream kept stored options');
    });
    it('notifies anchored phase readers on committed changes and ignores broker previews', async function() {
        const machineId = 'phase-probe';
        const history = alerts(alert, acknowledgedAlert);
        let publish;
        let close;
        let stored = [];
        const timeline = {
            async latest() { return stored; },
            stream(fn) { publish = fn; return { cancel() {} }; }
        };
        const signals = [];
        const item = machine(machineId, { sensors: {}, alerts: history, timeline });
        const area = shop('area', initialized({ [machineId]: item }, Object.values), history);
        const api = plantApi('/api/v1', plantDomain(initialized({ area }, Object.values)), { watchedPhases: new Set([machineId]) });
        await api.handle(
            { method: 'GET', url: `/api/v1/machines/${machineId}/segments/stream`, headers: {}, on(_event, stop) { close = stop; } },
            { writeHead() {}, write(content) { signals.push(content); }, end() {} }
        );
        try {
            const row = { name: 'on', duration: 0, start_time: new Date(), end_time: new Date() };
            await publish({ type: 'created', segment: row });
            assert.equal(signals.join('').match(/timeline_changed/gu).length, 1);
            assert.doesNotMatch(signals.join(''), /segment_created/u);
            stored = [row];
            await new Promise(resolve => { setTimeout(resolve, 1100); });
            assert.equal(signals.join('').match(/timeline_changed/gu).length, 2);
        } finally {
            close();
        }
    });

});
