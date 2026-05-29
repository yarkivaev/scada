import { hasAccess, sendForbidden } from '../../stateAccess.js';
import { errorResponse, jsonResponse, route } from '@yarkivaev/simple-server';

function parseFrom(raw) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

function toTopicList(topicParam) {
    if (Array.isArray(topicParam)) {
        return topicParam;
    }
    if (typeof topicParam === 'string' && topicParam.length > 0) {
        return [topicParam];
    }
    return [];
}

export default function checkpointRoutes(token, checkpointState) {
    return [
        route('GET', '/v1/checkpoint/replay-cursor', async (req, res, params, query) => {
            void params;
            if (!hasAccess(req, token)) {
                sendForbidden(res);
                return;
            }
            if (!query.machineId) {
                errorResponse('BAD_REQUEST', 'machineId is required', 400).send(res);
                return;
            }
            const cursor = await checkpointState.replayCursor(query.machineId);
            jsonResponse({ machineId: query.machineId, cursor }).send(res);
        }),
        route('GET', '/v1/checkpoint/pending-segments', async (req, res) => {
            if (!hasAccess(req, token)) {
                sendForbidden(res);
                return;
            }
            const items = await checkpointState.pendingSegments();
            jsonResponse({ items }).send(res);
        }),
        route('GET', '/v1/checkpoint/readings', async (req, res, params, query) => {
            void params;
            if (!hasAccess(req, token)) {
                sendForbidden(res);
                return;
            }
            const from = parseFrom(query.from);
            if (from === null) {
                errorResponse('BAD_REQUEST', 'from must be a number', 400).send(res);
                return;
            }
            const items = await checkpointState.readings(toTopicList(query.topic), from);
            jsonResponse({ items }).send(res);
        })
    ];
}
