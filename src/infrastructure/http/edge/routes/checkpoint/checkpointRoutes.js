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

function segmentRoute(token, checkpointState) {
    return route('GET', '/v1/checkpoint/segment', async (req, res, params, query) => {
        void params;
        if (!hasAccess(req, token)) {
            sendForbidden(res);
            return;
        }
        if (!query.machineId) {
            errorResponse('BAD_REQUEST', 'machineId is required', 400).send(res);
            return;
        }
        const start = parseFrom(query.start);
        if (start === null) {
            errorResponse('BAD_REQUEST', 'start must be a number', 400).send(res);
            return;
        }
        const item = await checkpointState.segment(query.machineId, start);
        jsonResponse({ item }).send(res);
    });
}

function cyclePriorQuery(query) {
    if (!query.machineId) {
        return { error: 'machineId is required' };
    }
    const before = parseFrom(query.before);
    if (before === null) {
        return { error: 'before must be a number' };
    }
    const reset = toTopicList(query.reset);
    if (reset.length === 0) {
        return { error: 'reset is required' };
    }
    return { machineId: query.machineId, before, reset };
}

function cyclePriorRoute(token, checkpointState) {
    return route('GET', '/v1/checkpoint/cycle-prior', async (req, res, params, query) => {
        void params;
        if (!hasAccess(req, token)) {
            sendForbidden(res);
            return;
        }
        const parsed = cyclePriorQuery(query);
        if (parsed.error) {
            errorResponse('BAD_REQUEST', parsed.error, 400).send(res);
            return;
        }
        const items = await checkpointState.cyclePrior(parsed.machineId, parsed.before, parsed.reset);
        jsonResponse({ items }).send(res);
    });
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
        segmentRoute(token, checkpointState),
        cyclePriorRoute(token, checkpointState),
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
