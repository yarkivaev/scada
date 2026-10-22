import machineInPlant from '../../../../application/machineInPlant.js';
import allowedSegmentTags from '../allowedSegmentTags.js';
import segmentJson from '../json/segmentJson.js';
import timelineOperator from '../timelineOperator.js';
import { errorResponse, jsonResponse, readBody, route, sendRouteError } from '@yarkivaev/simple-server';

async function handleOperatorWrite(gate, parsed, write) {
    const audit = await gate.resolve(parsed);
    await write(audit);
}

function proposedRows(row, parsed) {
    if (!Array.isArray(parsed.splits)) {
        return [row];
    }
    return parsed.splits.map((piece) => {
        const tags = piece.tag ? [piece.tag] : [];
        return { ...row, start: piece.start, start_time: piece.start, tags };
    });
}

function tagsAt(parsed, index) {
    if (!Array.isArray(parsed.splits)) {
        return parsed.tags;
    }
    const tag = parsed.splits[index] && parsed.splits[index].tag;
    return tag ? [tag] : [];
}

function blockedTag(standing, painted, parsed) {
    return painted.some((gated, index) => {
        return !allowedSegmentTags(gated.options, standing, tagsAt(parsed, index));
    });
}

async function rejectUnknownTags(timeline, parsed, machineId, res, decorate) {
    if (typeof timeline.rowAt !== 'function') {
        return false;
    }
    const row = await timeline.rowAt(new Date(parsed.start));
    if (!row) {
        return false;
    }
    const painted = await decorate(machineId, proposedRows(row, parsed));
    if (!blockedTag(row.tags, painted, parsed)) {
        return false;
    }
    errorResponse('BAD_REQUEST', `Tag is not in segment options for ${machineId}`, 400).send(res);
    return true;
}

async function respondToRequest(gate, timeline, requestId, req, res) {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw);
    let response;
    await handleOperatorWrite(gate, parsed, async (audit) => {
        response = await timeline.respond(requestId, parsed, audit);
    });
    if (!response) {
        errorResponse('NOT_FOUND', `Request '${requestId}' not found`, 404).send(res);
        return;
    }
    jsonResponse({ id: requestId, status: 'resolved' }).send(res);
}

/**
 * Timeline REST routes for segments and label requests.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object
 * @param {object} [operatorOptions] - provider, requireOperator, defaultUser
 * @param {function} decorate - (machineId, rows) => rows, applied before JSON and PATCH gate
 * @returns {array} route objects
 *
 * @example
 *   timelineRoute('/api/v1', plant, { provider, requireOperator: true, defaultUser: 'hmi-kiosk' });
 */
export default function timelineRoute(basePath, plant, operatorOptions, decorate) {
    const gate = timelineOperator(operatorOptions);
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
            if (query.kinds) {
                options.kinds = query.kinds.split(',').filter((kind) => {
                    return kind.length > 0;
                });
            }
            const rows = await decorate(params.machineId, await result.machine.timeline.list(options));
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
                if (await rejectUnknownTags(result.machine.timeline, parsed, params.machineId, res, decorate)) {
                    return;
                }
                await handleOperatorWrite(gate, parsed, async (audit) => {
                    if (Array.isArray(parsed.splits)) {
                        await result.machine.timeline.respond(new Date(parsed.start).toISOString(), parsed, audit);
                        return;
                    }
                    await result.machine.timeline.retag(new Date(parsed.start), parsed.tags, parsed.properties, audit);
                });
                jsonResponse({ status: 'updated' }).send(res);
            } catch (err) {
                if (gate.sendError(res, err)) {
                    return;
                }
                sendRouteError(res, err);
            }
        }),
        route('GET', `${basePath}/machines/:machineId/requests`, async (req, res, params) => {
            const result = machineInPlant(plant, params.machineId);
            if (!result) {
                jsonResponse({ items: [] }).send(res);
                return;
            }
            const rows = await decorate(params.machineId, await result.machine.timeline.pending());
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
                await respondToRequest(gate, result.machine.timeline, params.requestId, req, res);
            } catch (err) {
                if (gate.sendError(res, err)) {
                    return;
                }
                sendRouteError(res, err);
            }
        })
    ];
}
