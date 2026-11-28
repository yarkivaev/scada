import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import hmiMonitor, { metrics } from './hmiMonitor.js';
import hmiReconcile from './hmiReconcile.js';

function fault(status, message) {
    return Object.assign(new Error(message), { status });
}

function authorized(request, token) {
    const actual = Buffer.from(request.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    return Boolean(token) && actual.length === expected.length && timingSafeEqual(actual, expected);
}

function json(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
}

async function body(request) {
    const chunks = [];
    let length = 0;
    for await (const chunk of request) {
        length += chunk.length;
        if (length > 4096) { throw fault(413, 'HMI request body is too large'); }
        chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fault(400, 'HMI action requires JSON'); }
}

async function action(settings, request) {
    const input = await body(request);
    if (!input || typeof input !== 'object' || !['sync', 'reboot'].includes(input.action)
        || Object.keys(input).some((key) => { return !['device', 'action'].includes(key); })) {
        throw fault(400, 'HMI action must be explicit sync or reboot');
    }
    const device = settings.plan.devices.find((entry) => { return entry.id === input.device; });
    if (!device?.deviceRef) { throw fault(409, 'HMI action requires a declared enrolled tablet'); }
    if (input.action === 'reboot') { throw fault(422, 'HMI reboot unsupported without discoverable device capability evidence'); }
    const matches = (await settings.control.inventory()).filter((entry) => { return entry.number === device.deviceRef; });
    if (matches.length !== 1) { throw fault(409, 'HMI action references an unknown enrolled tablet'); }
    await settings.control.request(`/private/agent/v1/devices/${encodeURIComponent(device.deviceRef)}/sync`, 'POST', {});
    return { device: device.id, action: 'sync', state: 'wake-requested', hmiHealth: 'unknown' };
}

async function metricResponse(settings, response) {
    let status;
    try { status = await hmiMonitor(settings.plan, settings.monitor); } catch { status = { server: settings.plan.server, up: false, devices: [] }; }
    response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(metrics(status));
}

async function observe(settings, response, route) {
    if (route === '/healthz') { json(response, 200, { status: 'ok' }); return; }
    if (route === '/v1/hmi/diff') { json(response, 200, await hmiReconcile(settings.plan, settings.control, false, settings.kiosk)); return; }
    if (route === '/v1/hmi/status') { json(response, 200, await hmiMonitor(settings.plan, settings.monitor)); return; }
    if (route === '/metrics') { await metricResponse(settings, response); return; }
    throw fault(404, 'HMI route was not found');
}

function unlock(state) {
    state.busy = false;
}

async function mutate(settings, request, response, state) {
    if (!['/v1/hmi/reconcile', '/v1/hmi/actions'].includes(request.url)) { throw fault(404, 'HMI route was not found'); }
    if (!authorized(request, settings.token)) { throw fault(401, 'HMI control authorization required'); }
    if (state.busy) { throw fault(409, 'HMI control operation already in progress'); }
    state.busy = true;
    try {
        if (request.url === '/v1/hmi/actions') { json(response, 202, await action(settings, request)); }
        else { json(response, 200, await hmiReconcile(settings.plan, settings.control, true, settings.kiosk)); }
    } finally { unlock(state); }
}

/** HTTP boundary separates read-only observations from explicitly authorized mutations. */
export default function hmiControl(settings) {
    const state = { busy: false };
    return http.createServer(async (request, response) => {
        try {
            if (request.method === 'GET') { await observe(settings, response, request.url); }
            else if (request.method === 'POST') { await mutate(settings, request, response, state); }
            else { throw fault(405, 'HMI HTTP method is unsupported'); }
        } catch (error) { json(response, error.status || 502, { error: error.status ? error.message : 'MDMesh operation failed' }); }
    });
}
