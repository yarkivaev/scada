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

/**
 * Timeline SSE routes for segments and label requests.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object
 * @param {function} clock - time provider
 * @returns {array} route objects
 *
 * @example
 *   timelineStream('/api/v1', plant, clock);
 */
export default function timelineStream(basePath, plant, clock) {
    return [
        route('GET', `${basePath}/machines/:machineId/segments/stream`, (req, res, params) => {
            const sse = sseResponse(res, clock);
            sse.heartbeat();
            const result = machineInPlant(plant, params.machineId);
            if (!result) {
                sse.close();
                return;
            }
            const subscription = result.machine.timeline.stream((event) => {
                if (event.type === 'created' && event.segment) {
                    sse.emit('segment_created', segmentPayload(event.segment));
                } else if (event.type === 'resolved' && event.segment) {
                    sse.emit('segment_resolved', segmentPayload(event.segment));
                }
            });
            const heartbeat = setInterval(() => {
                sse.heartbeat();
            }, 30000);
            req.on('close', () => {
                clearInterval(heartbeat);
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
                if (event.type === 'created' && event.request) {
                    const reqItem = event.request;
                    const start = reqItem.start_time || reqItem.startTime;
                    const end = reqItem.end_time || reqItem.endTime;
                    sse.emit('request_created', {
                        id: reqItem.id,
                        segment: {
                            name: reqItem.name,
                            start: start.toISOString(),
                            end: end.toISOString(),
                            duration: reqItem.duration
                        },
                        options: reqItem.options
                    });
                } else if (event.type === 'resolved' && event.request) {
                    sse.emit('request_resolved', { id: event.request.id });
                }
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
