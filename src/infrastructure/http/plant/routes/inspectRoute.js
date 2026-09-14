import { errorResponse } from '@yarkivaev/simple-server';
import cdpGateway from '../inspect/cdpGateway.js';
import { inspectUrl } from '../inspect/inspectUpgrade.js';

function inspectOf(plant, id) {
    if (typeof plant.topology !== 'function') {
        return undefined;
    }
    const node = plant.topology().nodes.find((item) => {
        return item.id === id;
    });
    return node && node.inspect;
}

function hostOf(req) {
    return req.headers.host || req.headers.Host || 'localhost';
}

function protoOf(req) {
    return req.headers['x-forwarded-proto'] || req.headers['X-Forwarded-Proto'];
}

function cdpPath(rest) {
    if (rest === '/json' || rest === '/json/list') {
        return '/json/list';
    }
    if (rest === '/json/version') {
        return '/json/version';
    }
    if (rest.startsWith('/devtools/')) {
        return rest;
    }
    return undefined;
}

function missing(res, url) {
    errorResponse('NOT_FOUND', `Inspect path '${url}' was not found`, 404).send(res);
}

function queryOf(url) {
    return url.includes('?') ? `?${url.split('?')[1]}` : '';
}

async function sendJson(cdp, target, req, res, nodeId) {
    const path = cdpPath(inspectUrl(req.url).path);
    const body = await cdp.json(target, path, hostOf(req), nodeId, protoOf(req));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
}

async function sendShot(cdp, target, res) {
    const png = await cdp.shot(target);
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(png);
}

async function sendCdp(cdp, target, req, res, match) {
    const path = cdpPath(match.path);
    if (!path) {
        missing(res, req.url);
        return;
    }
    if (path.startsWith('/devtools/')) {
        cdp.proxy(target, `${path}${queryOf(req.url)}`, res);
        return;
    }
    await sendJson(cdp, target, req, res, match.id);
}

async function dispatchInspect(plant, cdp, req, res, match) {
    const target = inspectOf(plant, match.id);
    if (!target) {
        missing(res, req.url);
        return;
    }
    if (match.path === '/shot') {
        await sendShot(cdp, target, res);
        return;
    }
    await sendCdp(cdp, target, req, res, match);
}

async function dispatch(plant, cdp, req, res) {
    const match = inspectUrl(req.url);
    if (!match) {
        missing(res, req.url);
        return;
    }
    await dispatchInspect(plant, cdp, req, res, match);
}

/**
 * Same-origin CDP inspect routes for nodes that declare inspect { host, port }.
 *
 * @param {object} plant - plant with topology()
 * @param {object} [gateway] - optional cdpGateway
 * @returns {array} route objects
 *
 * @example
 *   inspectRoute(plant);
 */
export default function inspectRoute(plant, gateway) {
    const cdp = gateway || cdpGateway();
    return [
        {
            matches(request) {
                return request.method === 'GET' && Boolean(inspectUrl(request.url));
            },
            handle(request, response) {
                return dispatch(plant, cdp, request, response);
            }
        }
    ];
}
