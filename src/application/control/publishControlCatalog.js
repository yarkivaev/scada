/** Publish desired catalog independently of bootstrap; disconnected agents remain explicitly pending. */
export default async function publishControlCatalog(plan, store, publish, { now = Date.now, freshnessMs = 15000, clockSkewMs = 5000 } = {}) {
    const result = await publish(store, plan.catalog);
    const view = await store.read();
    const nodes = plan.catalog.nodes.map(({ id }) => {
        const assignment = view.assignments[id];
        const report = view.reports.find((item) => { return item.nodeId === id; });
        const epoch = plan.catalog.controlEpoch ?? 'initial';
        const matching = assignment?.catalogVersion === plan.catalog.version
            && (assignment?.controlEpoch ?? 'initial') === epoch
            && (report?.controlEpoch ?? 'initial') === epoch;
        const received = matching && (report?.receivedGeneration ?? report?.appliedGeneration) === assignment.generation;
        const applied = received && report?.appliedGeneration === assignment.generation;
        const errors = received ? (report.tasks ?? []).filter((task) => { return task.state === 'failed'; })
            .map(({ taskId, state }) => { return { taskId, state }; }) : [];
        let status = applied ? 'applied' : 'pending';
        if (errors.length) { status = 'error'; }
        const at = now();
        const fresh = Number.isFinite(report?.receivedAt) && report.receivedAt <= at + clockSkewMs && at - report.receivedAt <= freshnessMs;
        if (received && !fresh) { status = 'stale'; }
        return { nodeId: id, status, errors,
            desiredGeneration: assignment?.generation ?? null, appliedGeneration: report?.appliedGeneration ?? null };
    });
    return { ...result, nodes };
}
