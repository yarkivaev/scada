/** Combine queue snapshots and configured acknowledgement evidence. */
function compareQueues(left, right) {
    return (right.ready ?? 0) + (right.unacked ?? 0) - (left.ready ?? 0) - (left.unacked ?? 0) ||
        left.name.localeCompare(right.name);
}

async function observe(name, source, field) {
    try {
        const data = await source.sample();
        return { name, site: source.site, [field]: field === 'queues' ? data.toSorted(compareQueues) : data };
    } catch (error) {
        return { name, site: source.site, error: error.message };
    }
}

function observations(sources, field, select) {
    return Promise.all(Array.from(sources).filter(([name, source]) => {
        return select(name, source);
    }).map(([name, source]) => { return observe(name, source, field); }));
}

function trafficOf({ broker, queue, stream }, snapshots) {
    const data = snapshots.find(({ name }) => { return name === broker; })?.queues?.find(({ name }) => {
        return name === queue;
    });
    const rate = data?.consumers === 1 ? data.ackRate : undefined;
    if (rate === undefined) {
        return { broker, queue, stream, traffic: 'unknown' };
    }
    return { broker, queue, stream, traffic: rate > 0 ? 'flowing' : 'idle', ackRate: rate };
}

function sameRoute(left, right) {
    return left.from === right.from && left.to === right.to;
}

function withObservations(flow, links, snapshots) {
    const evidence = links.filter((link) => { return sameRoute(link, flow); }).map((link) => {
        return trafficOf(link, snapshots);
    });
    if (evidence.some(({ traffic }) => { return traffic === 'flowing'; })) {
        return { ...flow, evidence, traffic: 'flowing' };
    }
    const idle = evidence.length > 0 && evidence.every(({ traffic }) => { return traffic === 'idle'; });
    return { ...flow, evidence, traffic: idle ? 'idle' : 'unknown' };
}

function matchingLinks(links, sites) {
    return sites ? links.filter(({ from, to }) => { return sites.has(from) || sites.has(to); }) : links;
}

export default function networkLoad(brokers, metrics, links) {
    async function load(scope) {
        function selected(name, { site }) {
            return !scope || name === scope || site === scope;
        }
        const [queueSources, metricSources] = await Promise.all([
            observations(brokers, 'queues', selected), observations(metrics, 'metrics', selected)
        ]);
        if (scope && !queueSources.length && !metricSources.length) {
            throw new Error('no load sources for this site or source name');
        }
        return { load: { brokers: queueSources, metrics: metricSources } };
    }

    async function traffic(flows, sites) {
        const relevant = matchingLinks(links, sites);
        const targets = new Set(relevant.map(({ broker }) => { return broker; }));
        const snapshots = await observations(brokers, 'queues', (name) => { return targets.has(name); });
        const routes = [...flows];
        relevant.forEach(({ from, to }) => {
            if (!routes.some((flow) => { return sameRoute(flow, { from, to }); })) {
                routes.push({ from, to, streams: [], declared: false });
            }
        });
        return routes.map((flow) => { return withObservations(flow, relevant, snapshots); });
    }

    return { load, traffic };
}
