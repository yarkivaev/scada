import machineInPlant from '../../../../application/machineInPlant.js';
import { route, sseResponse } from '@yarkivaev/simple-server';

function segmentPayload(segment) {
    const start = segment.start_time || segment.startTime;
    const end = segment.end_time || segment.endTime;
    const data = {
        name: segment.name,
        start: start.toISOString(),
        end: end.toISOString(),
        duration: segment.duration
    };
    if (segment.options) {
        data.options = segment.options;
    }
    if (segment.tags) {
        data.tags = segment.tags;
    }
    if (segment.properties) {
        data.properties = segment.properties;
    }
    return data;
}

async function emitSegment(sse, event, decorate, machineId) {
    if (event.type === 'created' && event.segment) {
        const [row] = await decorate(machineId, [event.segment]);
        sse.emit('segment_created', segmentPayload(row));
        return;
    }
    if (event.type === 'resolved' && event.segment) {
        const [row] = await decorate(machineId, [event.segment]);
        sse.emit('segment_resolved', segmentPayload(row));
    }
}

async function emitRequest(sse, event, decorate, machineId) {
    if (event.type === 'created' && event.request) {
        const [row] = await decorate(machineId, [event.request]);
        const start = row.start_time || row.startTime;
        const end = row.end_time || row.endTime;
        sse.emit('request_created', {
            id: row.id,
            segment: {
                name: row.name,
                start: start.toISOString(),
                end: end.toISOString(),
                duration: row.duration
            },
            options: row.options
        });
        return;
    }
    if (event.type === 'resolved' && event.request) {
        sse.emit('request_resolved', { id: event.request.id });
    }
}

function watchPhase(timeline, sse) {
    const state = { closed: false, version: undefined, timer: undefined };
    async function read() {
        try {
            const rows = await timeline.latest(['phase']);
            const version = JSON.stringify(rows[0] ?? null);
            if (!state.closed && version !== state.version) {
                state.version = version;
                sse.emit('timeline_changed', {});
            }
        } catch {
            // A later read can detect a change after the database reconnects.
        } finally {
            if (!state.closed) {
                state.timer = setTimeout(read, 1000);
                state.timer.unref?.();
            }
        }
    }
    void read();
    return function stop() {
        state.closed = true;
        clearTimeout(state.timer);
    };
}

/**
 * Timeline SSE routes for segments and label requests.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object
 * @param {function} clock - time provider
 * @param {function} decorate - (machineId, rows) => rows
 * @returns {array} route objects
 *
 * @example
 *   timelineStream('/api/v1', plant, clock);
 */
export default function timelineStream(basePath, plant, clock, decorate, watchedPhases = new Set()) {
    return [
        route('GET', `${basePath}/machines/:machineId/segments/stream`, (req, res, params) => {
            const sse = sseResponse(res, clock);
            sse.heartbeat();
            const result = machineInPlant(plant, params.machineId);
            if (!result) {
                sse.close();
                return;
            }
            const watched = watchedPhases.has(params.machineId);
            const stop = watched ? watchPhase(result.machine.timeline, sse) : undefined;
            const subscription = result.machine.timeline.stream((event) => {
                return watched && event.type === 'created' && !event.retag ? undefined : emitSegment(sse, event, decorate, params.machineId);
            });
            const heartbeat = setInterval(() => {
                sse.heartbeat();
            }, 30000);
            (typeof res.once === 'function' ? res : req).on('close', () => {
                clearInterval(heartbeat);
                stop?.();
                subscription.cancel();
            });
        }),
        route('GET', `${basePath}/machines/:machineId/requests/stream`, (req, res, params) => {
            const sse = sseResponse(res, clock);
            sse.heartbeat();
            const result = machineInPlant(plant, params.machineId);
            if (!result) {
                sse.close();
                return;
            }
            const subscription = result.machine.timeline.stream((event) => {
                return emitRequest(sse, event, decorate, params.machineId);
            });
            const heartbeat = setInterval(() => {
                sse.heartbeat();
            }, 30000);
            req.on('close', () => {
                clearInterval(heartbeat);
                subscription.cancel();
            });
        })
    ];
}
