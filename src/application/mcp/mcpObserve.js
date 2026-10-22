import note from './mcpJournal.js';

/**
 * Maps a tool name to the engine gauge label.
 *
 * @param {string} name - tool name
 * @returns {string} clickhouse, postgres, or plant
 *
 * @example
 *   engineOf('query_clickhouse');
 */
function engineOf(name) {
    if (name === 'query_clickhouse') {
        return 'clickhouse';
    }
    if (name === 'query_postgres') {
        return 'postgres';
    }
    return 'plant';
}

/**
 * Reads ok or error from a tool result.
 *
 * @param {object} result - tool result
 * @returns {string} status
 *
 * @example
 *   statusOf({ isError: true });
 */
function statusOf(result) {
    if (result && result.isError === true) {
        return 'error';
    }
    return 'ok';
}

/**
 * Runs a callback and keeps the status and any thrown error.
 *
 * @param {Function} cb - tool or resource callback
 * @param {object} args - first callback argument
 * @param {object} extra - SDK extra
 * @returns {Promise<object>} outcome
 *
 * @example
 *   invoke(() => ({ content: [] }), {}, {});
 */
async function invoke(cb, args, extra) {
    try {
        const result = await cb(args, extra);
        return { result, status: statusOf(result) };
    } catch (err) {
        return { err, status: 'error' };
    }
}

/**
 * Returns the callback result or rethrows its error.
 *
 * @param {object} outcome - invoke outcome
 * @returns {object} result
 *
 * @example
 *   settle({ result: { content: [] }, status: 'ok' });
 */
function settle(outcome) {
    if (outcome.err) {
        throw outcome.err;
    }
    return outcome.result;
}

/**
 * Times one tool call after the engine slot is held.
 *
 * @param {string} name - tool name
 * @param {object} args - tool arguments
 * @param {object} extra - SDK extra
 * @param {Function} cb - tool callback
 * @param {object} ctx - journal context
 * @returns {Promise<object>} tool result
 *
 * @example
 *   invokeTool('state', {}, {}, () => ({ content: [] }), ctx);
 */
async function invokeTool(name, args, extra, cb, ctx) {
    const engine = engineOf(name);
    const started = Date.now();
    ctx.metrics.begin(engine);
    const outcome = await invoke(cb, args, extra);
    ctx.metrics.end(engine);
    note(ctx, name, outcome.status, started, args);
    return settle(outcome);
}

/**
 * Times one tool call, counts it, and tracks the engine gauge.
 *
 * SQL engines wait for the previous query on that engine so the in-flight
 * gauge stays at one. Named plant tools are not queued.
 *
 * @param {string} name - tool name
 * @param {object} args - tool arguments
 * @param {object} extra - SDK extra
 * @param {Function} cb - tool callback
 * @param {object} ctx - journal context
 * @returns {Promise<object>} tool result
 *
 * @example
 *   trackedTool('state', {}, {}, () => ({ content: [] }), ctx);
 */
function trackedTool(name, args, extra, cb, ctx) {
    const engine = engineOf(name);
    if (engine === 'plant') {
        return invokeTool(name, args, extra, cb, ctx);
    }
    return ctx.flight.run(engine, () => {
        return invokeTool(name, args, extra, cb, ctx);
    });
}

/**
 * Times one resource read.
 *
 * @param {string} uri - resource URI
 * @param {object} target - SDK uri argument
 * @param {object} extra - SDK extra
 * @param {Function} cb - read callback
 * @param {object} ctx - journal context
 * @returns {Promise<object>} resource result
 *
 * @example
 *   trackedRead('plant://topology', new URL('plant://topology'), {}, () => ({}), ctx);
 */
async function trackedRead(uri, target, extra, cb, ctx) {
    const started = Date.now();
    const outcome = await invoke(cb, target, extra);
    note(ctx, String(uri), outcome.status, started);
    return settle(outcome);
}

/**
 * Wraps registerTool so every tools/call is journaled.
 *
 * @param {Function} registerTool - McpServer.registerTool
 * @param {object} ctx - journal context
 * @returns {Function} wrapped register
 *
 * @example
 *   wrapTool(server.registerTool, ctx);
 */
function wrapTool(registerTool, ctx) {
    return function wrap(name, config, cb) {
        return registerTool(name, config, (args, extra) => {
            return trackedTool(name, args, extra, cb, ctx);
        });
    };
}

/**
 * Wraps registerResource so every resources/read is journaled.
 *
 * @param {Function} registerResource - McpServer.registerResource
 * @param {object} ctx - journal context
 * @returns {Function} wrapped register
 *
 * @example
 *   wrapResource(server.registerResource, ctx);
 */
function wrapResource(registerResource, ctx) {
    return function wrap(name, uri, config, cb) {
        return registerResource(name, uri, config, (target, extra) => {
            return trackedRead(uri, target, extra, cb, ctx);
        });
    };
}

/**
 * Journals later tool and resource registrations on this server.
 *
 * @param {object} server - McpServer
 * @param {object} ctx - caller, journal, metrics
 * @returns {void}
 *
 * @example
 *   observe(server, { caller: 'analyst', journal() {}, metrics });
 */
export default function observe(server, ctx) {
    const registerResource = server.registerResource.bind(server);
    const registerTool = server.registerTool.bind(server);
    server.registerResource = wrapResource(registerResource, ctx);
    server.registerTool = wrapTool(registerTool, ctx);
}
