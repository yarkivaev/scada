/** Add runtime evidence to declared sites without interpreting it as stream health. */
function contextState(result) {
    if (!result.components?.length) {
        return 'unknown';
    }
    return result.components.every(({ state }) => { return state === 'ready'; }) ? 'ready' : 'degraded';
}

function aggregate(states) {
    if (states.includes('degraded')) {
        return 'degraded';
    }
    return states.length > 0 && states.every((state) => { return state === 'ready'; }) ? 'ready' : 'unknown';
}

function scopeOf(model, context) {
    if (!context) {
        return model;
    }
    const sites = model.sites.filter(({ name, contexts }) => { return name === context || contexts.includes(context); });
    if (sites.length === 0) {
        throw new Error('unknown production site or bound context');
    }
    const names = new Set(sites.map(({ name }) => { return name; }));
    const flows = model.flows.filter(({ from, to }) => { return names.has(from) || names.has(to); });
    return { ...model, sites, flows };
}

export default async function topologyStatus(topology, describe, context, traffic) {
    const model = scopeOf(topology, context);
    const selected = new Set(model.sites.flatMap(({ contexts }) => { return contexts; }));
    const scope = context ? new Set(model.sites.map(({ name }) => { return name; })) : undefined;
    const [statesByContext, flows] = await Promise.all([
        Promise.all(Array.from(selected, async (name) => { return [name, contextState(await describe(name))]; })),
        traffic(model.flows, scope)
    ]);
    const observations = new Map(statesByContext);
    const sites = model.sites.map((site) => {
        const states = site.contexts.map((name) => { return observations.get(name); });
        return { ...site, state: aggregate(states) };
    });
    const state = aggregate(sites.map((site) => { return site.state; }));
    return { topology: { ...model, sites, state, flows } };
}
