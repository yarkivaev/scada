import { virtualClock } from '@yarkivaev/simple-server';
import {
    alert,
    acknowledgedAlert,
    alerts,
    initialized,
    machine,
    plant,
    shop,
    timeline
} from '../../index.js';
import plantApi from '../../src/application/plantApi.js';
import stompTimeline from '../../src/infrastructure/messaging/stomp/timeline.js';
import segmentStateMemory from '../../src/infrastructure/persistence/memory/segments.js';
import stateDataFake from './stateDataFake.js';

function mapRow(item) {
    const tags = item.tags === undefined || item.tags === null ? null : item.tags;
    const properties = item.properties === undefined || item.properties === null ? null : item.properties;
    return {
        name: item.name,
        start_time: new Date(item.start_time),
        end_time: new Date(item.end_time),
        duration: item.duration,
        options: item.options,
        tags,
        properties
    };
}

function timelineFromStore(store, machineId, decisions) {
    const segments = segmentStateMemory(store);
    const read = {
        async list(range) {
            const rows = segments.listForMachine(machineId, range || {});
            return rows.map(mapRow);
        },
        async rowAt(start) {
            const row = segments.rowAt(machineId, start);
            return row ? mapRow(row) : null;
        },
        async pending() {
            const rows = segments.pendingRequestsForMachine(machineId);
            return rows.map((item) => {
                return {
                    id: item.id,
                    name: item.name,
                    start_time: new Date(item.start_time),
                    end_time: new Date(item.end_time),
                    duration: item.duration,
                    options: item.options
                };
            });
        }
    };
    return timeline(read, stompTimeline(decisions, machineId));
}

function fakeDecisions() {
    return {
        async publish() {
            return undefined;
        }
    };
}

function sseCapture() {
    const chunks = [];
    const res = {
        writeHead() {},
        write(content) {
            chunks.push(content);
        },
        end() {}
    };
    const req = {
        on() {
            return req;
        }
    };
    return {
        req,
        res,
        text() {
            return chunks.join('');
        }
    };
}

/**
 * Composes plant API wiring and supervisor persist without timeline bus notify.
 *
 * @returns {object} scene with afterSupervisorPersist method
 *
 * @example
 *   const text = await segmentStreamScene().afterSupervisorPersist();
 */
export default function segmentStreamScene() {
    const machineId = `icht${Math.floor(Math.random() * 9000 + 1000)}`;
    const data = stateDataFake({});
    const store = data.seed;
    const tl = timelineFromStore(store, machineId, fakeDecisions());
    const history = alerts(alert, acknowledgedAlert);
    const item = machine(machineId, { sensors: {}, alerts: history, timeline: tl });
    const area = shop('meltingShop', initialized({ [machineId]: item }, Object.values), history);
    const p = plant(initialized({ meltingShop: area }, Object.values));
    const clock = virtualClock(function clockSource() {
        return new Date();
    });
    const api = plantApi('/api/v1', p, { clock, heartbeat: 1000 });
    return {
        async afterSupervisorPersist() {
            const capture = sseCapture();
            await api.handle({
                method: 'GET',
                url: `/api/v1/machines/${machineId}/segments/stream`,
                headers: {}
            }, capture.res);
            const start = new Date(Date.now() + Math.floor(Math.random() * 1e6));
            store.segments.push({
                machine: machineId,
                name: 'on',
                start_time: start.toISOString(),
                end_time: start.toISOString(),
                duration: 0,
                options: null,
                tags: null,
                properties: null,
                resolved: true
            });
            await new Promise((resolve) => {
                setImmediate(resolve);
            });
            return capture.text();
        }
    };
}
