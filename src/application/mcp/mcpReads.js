import { z } from 'zod';
import { capMeasurements, capRows, toolText } from './mcpText.js';

/**
 * Loads rows for one namespace path and caps them.
 *
 * @param {object} tree - namespaceTree
 * @param {string} path - namespace path
 * @param {Function} load - port call
 * @returns {Promise<object>} tool result
 *
 * @example
 *   loadRows(tree, 'site', () => []);
 */
async function loadRows(tree, path, load) {
    tree.resolve(path);
    const rows = await load();
    return toolText(capRows(rows));
}

/**
 * Adds age and live or stale from the node silence threshold.
 *
 * @param {object} raw - state port payload
 * @param {number} silenceSeconds - liveness seconds
 * @returns {object} state payload
 *
 * @example
 *   fresh({ found: false }, 60);
 */
function fresh(raw, silenceSeconds) {
    if (raw && raw.found === true && typeof raw.time === 'string') {
        const ageMs = Date.now() - Date.parse(raw.time);
        const freshness = ageMs <= silenceSeconds * 1000 ? 'live' : 'stale';
        return { ...raw, ageMs, freshness };
    }
    return raw;
}

/**
 * Reads metric points for namespace paths.
 *
 * @param {object} args - paths, from, to, step, mode
 * @param {object} ports - read ports
 * @param {object} tree - namespaceTree
 * @returns {Promise<object>} tool result
 *
 * @example
 *   runMeasurements({ paths: ['site'], from: 'a', to: 'b', step: 60 }, ports, tree);
 */
async function runMeasurements(args, ports, tree) {
    for (const path of args.paths) {
        tree.resolve(path);
    }
    const raw = await ports.measurements(args);
    return toolText(capMeasurements(raw, args.step));
}

/**
 * Reads the latest values under a path.
 *
 * @param {object} args - path
 * @param {object} ports - read ports
 * @param {object} tree - namespaceTree
 * @returns {Promise<object>} tool result
 *
 * @example
 *   runState({ path: 'site' }, ports, tree);
 */
async function runState(args, ports, tree) {
    const node = tree.resolve(args.path);
    const raw = await ports.state(args);
    return toolText(fresh(raw, node.silenceSeconds));
}

/**
 * Registers the measurements tool.
 *
 * @param {object} server - McpServer
 * @param {object} ports - read ports
 * @param {object} tree - namespaceTree
 * @returns {void}
 *
 * @example
 *   registerMeasurements(server, ports, tree);
 */
function registerMeasurements(server, ports, tree) {
    server.registerTool('measurements', {
        description: 'Metric points for namespace paths over an interval',
        inputSchema: {
            from: z.string(),
            mode: z.string().optional(),
            paths: z.array(z.string()),
            step: z.number(),
            to: z.string()
        }
    }, (args) => {
        return runMeasurements(args, ports, tree);
    });
}

/**
 * Registers the segments tool.
 *
 * @param {object} server - McpServer
 * @param {object} ports - read ports
 * @param {object} tree - namespaceTree
 * @returns {void}
 *
 * @example
 *   registerSegments(server, ports, tree);
 */
function registerSegments(server, ports, tree) {
    server.registerTool('segments', {
        description: 'Timeline segments for a namespace path',
        inputSchema: {
            from: z.string(),
            kinds: z.array(z.string()).optional(),
            path: z.string(),
            to: z.string()
        }
    }, (args) => {
        return loadRows(tree, args.path, () => {
            return ports.segments(args);
        });
    });
}

/**
 * Registers the operations tool.
 *
 * @param {object} server - McpServer
 * @param {object} ports - read ports
 * @param {object} tree - namespaceTree
 * @returns {void}
 *
 * @example
 *   registerOperations(server, ports, tree);
 */
function registerOperations(server, ports, tree) {
    server.registerTool('operations', {
        description: 'Operation rows for a namespace path and an opaque kind',
        inputSchema: {
            from: z.string(),
            kind: z.string(),
            path: z.string(),
            to: z.string()
        }
    }, (args) => {
        return loadRows(tree, args.path, () => {
            return ports.operations(args);
        });
    });
}

/**
 * Registers the alerts tool.
 *
 * @param {object} server - McpServer
 * @param {object} ports - read ports
 * @param {object} tree - namespaceTree
 * @returns {void}
 *
 * @example
 *   registerAlerts(server, ports, tree);
 */
function registerAlerts(server, ports, tree) {
    server.registerTool('alerts', {
        description: 'Alert rows for a namespace path',
        inputSchema: {
            from: z.string(),
            path: z.string(),
            to: z.string()
        }
    }, (args) => {
        return loadRows(tree, args.path, () => {
            return ports.alerts(args);
        });
    });
}

/**
 * Registers the state tool.
 *
 * @param {object} server - McpServer
 * @param {object} ports - read ports
 * @param {object} tree - namespaceTree
 * @returns {void}
 *
 * @example
 *   registerState(server, ports, tree);
 */
function registerState(server, ports, tree) {
    server.registerTool('state', {
        description: 'Latest readings under a namespace path',
        inputSchema: {
            path: z.string()
        }
    }, (args) => {
        return runState(args, ports, tree);
    });
}

/**
 * Registers measurement, segment, operation, alert, and state tools.
 *
 * @param {object} server - McpServer
 * @param {object} ports - read ports
 * @param {object} tree - namespaceTree
 * @returns {void}
 *
 * @example
 *   registerReads(server, ports, tree);
 */
export default function registerReads(server, ports, tree) {
    registerMeasurements(server, ports, tree);
    registerSegments(server, ports, tree);
    registerOperations(server, ports, tree);
    registerAlerts(server, ports, tree);
    registerState(server, ports, tree);
}
