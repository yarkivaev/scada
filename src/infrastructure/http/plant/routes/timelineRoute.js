import machineInPlant from '../../../../application/machineInPlant.js';
import segmentJson from '../json/segmentJson.js';
import { errorResponse, jsonResponse, readBody, route, sendRouteError } from '@yarkivaev/simple-server';

/**
 * Timeline REST routes for segments and label requests.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object
 * @returns {array} route objects
 *
 * @example
 *   timelineRoute('/api/v1', plant);
 */
export default function timelineRoute(basePath, plant) {
    return [
        route('GET', `${basePath}/machines/:machineId/segments`, async (req, res, params, query) => {
            const result = machineInPlant(plant, params.machineId);
            if (!result) {
                jsonResponse({ items: [] }).send(res);
                return;
            }
            const options = {};
            if (query.from) {
                options.from = query.from;
            }
            if (query.to) {
                options.to = query.to;
            }
            const rows = await result.machine.timeline.list(options);
            jsonResponse({ items: rows.map(segmentJson) }).send(res);
        }),
        route('PATCH', `${basePath}/machines/:machineId/segments`, async (req, res, params) => {
            const result = machineInPlant(plant, params.machineId);
            if (!result) {
                errorResponse('NOT_FOUND', `Machine '${params.machineId}' not found`, 404).send(res);
                return;
            }
            try {
                const raw = await readBody(req);
                const parsed = JSON.parse(raw);
                await result.machine.timeline.retag(new Date(parsed.start), parsed.tags, parsed.properties);
                jsonResponse({ status: 'updated' }).send(res);
            } catch (err) {
                sendRouteError(res, err);
            }
        }),
        route('GET', `${basePath}/machines/:machineId/requests`, async (req, res, params) => {
            const result = machineInPlant(plant, params.machineId);
            if (!result) {
                jsonResponse({ items: [] }).send(res);
                return;
            }
            const rows = await result.machine.timeline.pending();
            const items = rows.map(({ id, name, start_time: startTime, end_time: endTime, duration, options }) => {
                return {
                    id,
                    segment: {
                        name,
                        start: startTime.toISOString(),
                        end: endTime.toISOString(),
                        duration
                    },
                    options
                };
            });
            jsonResponse({ items }).send(res);
        }),
        route('POST', `${basePath}/machines/:machineId/requests/:requestId/respond`, async (req, res, params) => {
            const result = machineInPlant(plant, params.machineId);
            if (!result) {
                errorResponse('NOT_FOUND', `Machine '${params.machineId}' not found`, 404).send(res);
                return;
            }
            try {
                const raw = await readBody(req);
                const parsed = JSON.parse(raw);
                const response = await result.machine.timeline.respond(params.requestId, parsed);
                if (!response) {
                    errorResponse('NOT_FOUND', `Request '${params.requestId}' not found`, 404).send(res);
                    return;
                }
                jsonResponse({ id: params.requestId, status: 'resolved' }).send(res);
            } catch (err) {
                sendRouteError(res, err);
            }
        })
    ];
}
