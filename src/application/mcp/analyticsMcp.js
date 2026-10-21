import http from 'node:http';
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import mcpMetrics from './mcpMetrics.js';
import observe from './mcpObserve.js';
import registerCoverage from './mcpCoverage.js';
import registerQueries from './mcpQuery.js';
import registerReads from './mcpReads.js';
import registerResources from './mcpResources.js';

const load = createRequire(import.meta.url);
const pkg = load('../../../package.json');

/**
 * Throws when a required bundle part is absent.
 *
 * @param {boolean} ok - whether the part is present
 * @param {string} message - error context
 * @returns {void}
 *
 * @example
 *   assertPart(true, 'Analytics ports are missing');
 */
function assertPart(ok, message) {
    if (ok) {
        return;
    }
    throw new Error(message);
}

/**
 * Requires the read ports that named tools always register.
 *
 * @param {object} ports - read ports
 * @returns {void}
 *
 * @example
 *   assertPorts(ports);
 */
function assertPorts(ports) {
    const names = [
        'alerts', 'cursor', 'measurements', 'operations',
        'queryClickhouse', 'samples', 'segments', 'state'
    ];
    for (const name of names) {
        assertPart(typeof ports[name] === 'function', `Analytics port is missing: ${name}`);
    }
}

/**
 * Requires the namespace, journal, tokens, and ports.
 *
 * @param {object} bundle - analyticsMcp bundle
 * @returns {void}
 *
 * @example
 *   assertBundle(bundle);
 */
function assertBundle(bundle) {
    const treeOk = Boolean(bundle && bundle.tree && typeof bundle.tree.resolve === 'function');
    assertPart(treeOk, 'Analytics namespace tree is missing');
    assertPart(Boolean(bundle && typeof bundle.journal === 'function'), 'Analytics journal writer is missing');
    assertPart(Boolean(bundle && bundle.tokens), 'Analytics bearer map is missing');
    assertPart(Boolean(bundle && bundle.ports), 'Analytics ports are missing');
    assertPorts(bundle.ports);
}

/**
 * Server name and package version for the MCP handshake.
 *
 * @returns {{name: string, version: string}} implementation
 *
 * @example
 *   serverInfo().name;
 */
function serverInfo() {
    return { name: 'analytics', version: pkg.version };
}

/**
 * Lets a plant package register tools on the same server.
 *
 * @param {object} server - McpServer
 * @param {object} bundle - analyticsMcp bundle
 * @returns {void}
 *
 * @example
 *   extendServer(server, bundle);
 */
function extendServer(server, bundle) {
    if (typeof bundle.extend === 'function') {
        bundle.extend(server);
    }
}

/**
 * Builds one stateless server for a single HTTP request.
 *
 * @param {object} bundle - analyticsMcp bundle
 * @param {object} metrics - prometheus counters
 * @param {string} caller - bearer caller name
 * @returns {object} McpServer
 *
 * @example
 *   openServer(bundle, metrics, 'analyst');
 */
function openServer(bundle, metrics, caller) {
    const server = new McpServer(serverInfo());
    observe(server, { caller, journal: bundle.journal, metrics });
    registerReads(server, bundle.ports, bundle.tree);
    registerCoverage(server, bundle.ports, bundle.tree);
    registerQueries(server, bundle.ports);
    registerResources(server, bundle.tree);
    extendServer(server, bundle);
    return server;
}

/**
 * Resolves a bearer token to a caller name.
 *
 * @param {import('node:http').IncomingMessage} req - request
 * @param {object} tokens - token to caller name
 * @returns {string} caller name or an empty string
 *
 * @example
 *   callerName(req, { secret: 'analyst' });
 */
function callerName(req, tokens) {
    const header = req.headers.authorization;
    if (typeof header !== 'string') {
        return '';
    }
    const matched = /^Bearer\s+(?<token>\S+)$/iu.exec(header);
    if (!matched || !Object.hasOwn(tokens, matched.groups.token)) {
        return '';
    }
    const name = tokens[matched.groups.token];
    if (typeof name === 'string' && name.length > 0) {
        return name;
    }
    return '';
}

/**
 * Closes a one-request transport after the HTTP response finishes.
 *
 * The SDK writes the JSON body after handleRequest returns, so the transport
 * stays open until the response closes.
 *
 * @param {object} transport - StreamableHTTPServerTransport
 * @param {object} server - McpServer
 * @returns {Function} release
 *
 * @example
 *   const release = releaser(transport, server);
 */
function releaser(transport, server) {
    let settled = false;
    return function release() {
        if (settled) {
            return Promise.resolve();
        }
        settled = true;
        return Promise.all([transport.close(), server.close()]).then(() => {
            return undefined;
        }, () => {
            return undefined;
        });
    };
}

/**
 * Handles one MCP POST on a fresh stateless transport.
 *
 * @param {import('node:http').IncomingMessage} req - request
 * @param {import('node:http').ServerResponse} res - response
 * @param {object} bundle - analyticsMcp bundle
 * @param {object} metrics - prometheus counters
 * @param {string} caller - bearer caller name
 * @returns {Promise<void>}
 *
 * @example
 *   dispatch(req, res, bundle, metrics, 'analyst');
 */
async function dispatch(req, res, bundle, metrics, caller) {
    const server = openServer(bundle, metrics, caller);
    const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: undefined
    });
    const done = releaser(transport, server);
    res.on('close', () => {
        done();
    });
    try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
    } catch (err) {
        await done();
        throw err;
    }
}

/**
 * Authorizes a POST /mcp request and then hands it to the SDK.
 *
 * @param {import('node:http').IncomingMessage} req - request
 * @param {import('node:http').ServerResponse} res - response
 * @param {object} bundle - analyticsMcp bundle
 * @param {object} metrics - prometheus counters
 * @returns {Promise<void>}
 *
 * @example
 *   postMcp(req, res, bundle, metrics);
 */
async function postMcp(req, res, bundle, metrics) {
    const name = callerName(req, bundle.tokens);
    if (name.length === 0) {
        res.writeHead(401).end();
        return;
    }
    await dispatch(req, res, bundle, metrics, name);
}

/**
 * Writes the Prometheus scrape body.
 *
 * @param {import('node:http').ServerResponse} res - response
 * @param {object} metrics - prometheus counters
 * @returns {void}
 *
 * @example
 *   writeMetrics(res, metrics);
 */
function writeMetrics(res, metrics) {
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(metrics.text());
}

/**
 * Routes /metrics and /mcp.
 *
 * @param {import('node:http').IncomingMessage} req - request
 * @param {import('node:http').ServerResponse} res - response
 * @param {object} bundle - analyticsMcp bundle
 * @param {object} metrics - prometheus counters
 * @returns {Promise<void>}
 *
 * @example
 *   route(req, res, bundle, metrics);
 */
function route(req, res, bundle, metrics) {
    if (req.method === 'GET' && req.url === '/metrics') {
        writeMetrics(res, metrics);
        return Promise.resolve();
    }
    if (req.method === 'POST' && req.url === '/mcp') {
        return postMcp(req, res, bundle, metrics);
    }
    res.writeHead(404).end();
    return Promise.resolve();
}

/**
 * Answers a failed request without copying the error text.
 *
 * @param {import('node:http').ServerResponse} res - response
 * @returns {void}
 *
 * @example
 *   fail(res);
 */
function fail(res) {
    if (res.headersSent) {
        return;
    }
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('MCP request failed');
}

/**
 * Forwards a request and hides handler failures.
 *
 * @param {import('node:http').IncomingMessage} req - request
 * @param {import('node:http').ServerResponse} res - response
 * @param {object} bundle - analyticsMcp bundle
 * @param {object} metrics - prometheus counters
 * @returns {void}
 *
 * @example
 *   onRequest(req, res, bundle, metrics);
 */
function onRequest(req, res, bundle, metrics) {
    route(req, res, bundle, metrics).catch(() => {
        fail(res);
    });
}

/**
 * Starts listening and resolves the bound address.
 *
 * @param {import('node:http').Server} server - HTTP server
 * @param {number} port - port, or 0 for an ephemeral port
 * @param {string} host - bind address
 * @returns {Promise<object>} address
 *
 * @example
 *   listen(server, 0, '127.0.0.1');
 */
function listen(server, port, host) {
    const chosen = typeof port === 'number' ? port : 0;
    const iface = typeof host === 'string' ? host : '127.0.0.1';
    return new Promise((resolve, reject) => {
        function failBind(err) {
            reject(err);
        }
        server.once('error', failBind);
        server.listen(chosen, iface, () => {
            server.removeListener('error', failBind);
            resolve(server.address());
        });
    });
}

/**
 * Closes the HTTP server.
 *
 * @param {import('node:http').Server} server - HTTP server
 * @returns {Promise<void>}
 *
 * @example
 *   shut(server);
 */
function shut(server) {
    return new Promise((resolve, reject) => {
        server.close((err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

/**
 * Stateless Streamable HTTP MCP for plant analytics.
 *
 * The plant package supplies a namespaceTree, read ports, a bearer map, and a
 * journal writer. query_postgres is registered only when ports.queryPostgres
 * is a function. extend(server) may register more tools. POST /mcp speaks MCP.
 * GET /metrics is Prometheus text.
 *
 * @param {object} bundle - tree, tokens, journal, ports, optional extend
 * @returns {object} listen and close
 *
 * @example
 *   const mcp = analyticsMcp({ tree, tokens, journal, ports });
 *   await mcp.listen(0, '127.0.0.1');
 */
export default function analyticsMcp(bundle) {
    assertBundle(bundle);
    const metrics = mcpMetrics();
    const server = http.createServer((req, res) => {
        onRequest(req, res, bundle, metrics);
    });
    return Object.freeze({
        close() {
            return shut(server);
        },
        listen(port, host) {
            return listen(server, port, host);
        }
    });
}
