import { listedItems } from './siteSyncRows.js';
import { siteById } from './siteSyncSites.js';

/**
 * Pulls selected kinds from a remote plantApi into local targets.
 *
 * @param {object} ports - { sites, queryFor, targets }
 * @returns {object} frozen sync with run(request, ports)
 *
 * @example
 *   const sync = siteSync({ sites, queryFor, targets });
 *   await sync.run({ site: 'edge-icht-1', from, to, machines: ['icht1'], kinds: ['segments'] });
 */
function pull(query, kind, machine, range) {
    if (kind === 'segments') {
        return query.segments(machine, range);
    }
    if (kind === 'operations') {
        return query.operations(machine, range);
    }
    if (kind === 'measurements') {
        return query.measurements(machine, range);
    }
    if (kind === 'alerts') {
        return query.alerts(machine, range);
    }
    throw new Error(`site sync cannot pull unknown kind ${kind}`);
}

function kindsOf(request, targets) {
    const selected = request.kinds && request.kinds.length > 0 ? request.kinds : Object.keys(targets);
    selected.forEach((kind) => {
        if (!targets[kind]) {
            throw new Error(`site sync unknown kind ${kind}`);
        }
    });
    return selected;
}

function machinesOf(request, site, query) {
    if (request.machines && request.machines.length > 0) {
        return Promise.resolve(request.machines);
    }
    if (site.machines && site.machines.length > 0) {
        return Promise.resolve(site.machines);
    }
    return query.machines().then((body) => {
        return listedItems(body).map((item) => {
            return item.id;
        });
    });
}

function zero(kinds) {
    return Object.fromEntries(kinds.map((kind) => {
        return [kind, 0];
    }));
}

function jobsOf(machines, kinds) {
    return machines.flatMap((machine) => {
        return kinds.map((kind) => {
            return { machine, kind };
        });
    });
}

function add(counts, kind, added) {
    return { ...counts, [kind]: counts[kind] + added };
}

function writeKind(query, targets, job, range) {
    return pull(query, job.kind, job.machine, range).then((body) => {
        return targets[job.kind].write(job.machine, body);
    });
}

function stopped() {
    const error = new Error('job stopped');
    error.code = 'STOPPED';
    throw error;
}

function ignore(progress) {
    return progress;
}

function extrasOf(ports) {
    return {
        signal: ports && ports.signal ? ports.signal : { aborted: false },
        report: ports && ports.report ? ports.report : ignore
    };
}

function step(query, targets, job, ctx) {
    if (ctx.extras.signal.aborted) {
        stopped();
    }
    return writeKind(query, targets, job, ctx.range).then((added) => {
        const next = add(ctx.counts, job.kind, added);
        ctx.extras.report({ machine: job.machine, kind: job.kind, counts: next });
        return next;
    });
}

function fill(query, targets, kinds, machines, ctx) {
    return jobsOf(machines, kinds).reduce((chain, job) => {
        return chain.then((counts) => {
            return step(query, targets, job, { ...ctx, counts });
        });
    }, Promise.resolve(zero(kinds)));
}

export default function siteSync(ports) {
    return Object.freeze({
        async run(request, extras) {
            if (!request.from || !request.to) {
                throw new Error('site sync requires from and to');
            }
            const site = siteById(ports.sites, request.site);
            const query = ports.queryFor(site);
            const kinds = kindsOf(request, ports.targets);
            const machines = await machinesOf(request, site, query);
            const range = { from: request.from, to: request.to };
            const counts = await fill(query, ports.targets, kinds, machines, {
                range,
                extras: extrasOf(extras)
            });
            return { site: site.id, machines, counts };
        }
    });
}
