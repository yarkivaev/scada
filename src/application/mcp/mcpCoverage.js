import { z } from 'zod';
import coverageOverlay from '../../domain/span/coverageOverlay.js';
import coverageSpans from '../../domain/span/coverageSpans.js';
import { toolText } from './mcpText.js';

/**
 * Unwraps an ingest cursor object to its instant.
 *
 * @param {Date|number|string|object} value - cursor
 * @returns {Date|number|string} instant
 *
 * @example
 *   cursorAt({ at: '2024-11-02T03:04:05.137Z' });
 */
function cursorAt(value) {
    if (value && typeof value === 'object' && !(value instanceof Date) && Object.hasOwn(value, 'at')) {
        return value.at;
    }
    return value;
}

/**
 * Builds capped coverage spans for one path.
 *
 * @param {string} path - namespace path
 * @param {object} args - from and to
 * @param {object} ports - samples and cursor
 * @param {object} tree - namespaceTree
 * @returns {Promise<object>} path spans
 *
 * @example
 *   coverOne('site/metric', { from: 'a', to: 'b' }, ports, tree);
 */
async function coverOne(path, args, ports, tree) {
    const node = tree.resolve(path);
    const samples = await ports.samples({ from: args.from, path, to: args.to });
    const cursor = await ports.cursor({ path });
    const spans = coverageOverlay(coverageSpans(
        samples,
        args.from,
        args.to,
        node.silenceSeconds * 1000,
        cursorAt(cursor)
    ), await ports.segments({ from: args.from, path, to: args.to }));
    return {
        path,
        spans: spans.slice(0, 200),
        truncated: spans.length > 200
    };
}

/**
 * Reads present, absent, and unknown spans for each path.
 *
 * @param {object} args - paths, from, to
 * @param {object} ports - samples and cursor
 * @param {object} tree - namespaceTree
 * @returns {Promise<object>} tool result
 *
 * @example
 *   runCoverage({ paths: ['site'], from: 'a', to: 'b' }, ports, tree);
 */
async function runCoverage(args, ports, tree) {
    const jobs = args.paths.map((path) => {
        return coverOne(path, args, ports, tree);
    });
    const paths = await Promise.all(jobs);
    const truncated = paths.some((item) => {
        return item.truncated === true;
    });
    return toolText({ paths, truncated });
}

/**
 * Registers the coverage tool.
 *
 * @param {object} server - McpServer
 * @param {object} ports - read ports
 * @param {object} tree - namespaceTree
 * @returns {void}
 *
 * @example
 *   registerCoverage(server, ports, tree);
 */
export default function registerCoverage(server, ports, tree) {
    server.registerTool('coverage', {
        description: 'Present, absent, and unknown spans for metric paths',
        inputSchema: {
            from: z.string(),
            paths: z.array(z.string()),
            to: z.string()
        }
    }, (args) => {
        return runCoverage(args, ports, tree);
    });
}
