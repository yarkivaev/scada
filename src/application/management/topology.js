/** Project the system document into a topology that can be shared with operators. */
import expand from '../deploy/expand.js';
import { treePaths } from '../deploy/expandNamespace.js';
import { isAddress } from '../deploy/expandPattern.js';
import { edgesOf } from '../deploy/releaseEdges.js';
import { asPath } from '../deploy/releaseNodes.js';

function siteOf(server, bindings, targets) {
    const { id: name } = server;
    const fallback = targets.has(name) ? [name] : [];
    const contexts = Object.hasOwn(bindings, name) ? bindings[name] : fallback;
    const objects = [...new Set([...(server.objects || []), ...(server.ownership || [])].map(asPath))];
    const localStreams = [...new Set((server.fan_in || []).filter(({ from }) => {
        return isAddress(from);
    }).map(({ name: stream }) => { return stream; }))];
    return { name, contexts, objects, localStreams };
}

export default function topology(document, bindings, targets) {
    const system = expand(document);
    const sites = system.servers.map((server) => { return siteOf(server, bindings, targets); });
    Object.entries(bindings).forEach(([site, contexts]) => {
        if (!sites.some(({ name }) => { return name === site; })) {
            throw new Error(`unknown system site ${site}`);
        }
        contexts.forEach((context) => {
            if (!targets.has(context)) {
                throw new Error(`unknown management context ${context} bound to ${site}`);
            }
        });
    });
    const flows = edgesOf(system).map(({ from, to, streams }) => {
        return { from, to, streams: Array.from(streams.keys()) };
    });
    return { namespace: treePaths(system.namespace), sites, flows };
}
