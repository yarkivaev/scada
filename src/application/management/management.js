import topologyStatus from './topologyStatus.js';

function presentation(execute, topology, describe, network) {
    return (command) => {
        if (command.action === 'load') {
            return network.load(command.context);
        }
        if (command.action === 'status' && topology) {
            return topologyStatus(topology, describe, command.context, network.traffic);
        }
        return execute(command);
    };
}

/**
 * Runtime port: components(), logs(id, tail), plan(), apply().
 * The application only knows context names and normalized results.
 */
export default function management(targets, topology, network) {
    const applying = new Set();

    function targetOf(name, forwarded) {
        const target = targets.get(name);
        if (!target) {
            throw new Error('unknown context');
        }
        if (forwarded && target.forwards) {
            throw new Error('remote contexts support one forwarding hop');
        }
        return target;
    }

    async function describe(name, forwarded) {
        try {
            return { name, components: await targetOf(name, forwarded).adapter.components() };
        } catch (error) {
            return { name, error: error.message };
        }
    }

    async function apply({ adapter, locks }) {
        if (locks.some((key) => { return applying.has(key); })) {
            throw new Error('apply already in progress for this target');
        }
        locks.forEach((key) => { applying.add(key); });
        try {
            return await adapter.apply();
        } finally {
            locks.forEach((key) => { applying.delete(key); });
        }
    }

    async function execute({ action, context, component, tail, forwarded }) {
        if (action === 'contexts') {
            return { contexts: Array.from(targets, ([name, target]) => {
                return { name, runtime: target.runtime };
            }) };
        }
        if (action === 'components' || action === 'status') {
            const names = context ? [context] : Array.from(targets.keys());
            return { contexts: await Promise.all(names.map((name) => { return describe(name, forwarded); })) };
        }
        const target = targetOf(context, forwarded);
        if (action === 'logs') {
            return { logs: await target.adapter.logs(component, tail) };
        }
        return action === 'plan' ? target.adapter.plan() : apply(target);
    }

    return { execute: presentation(execute, topology, describe, network) };
}
