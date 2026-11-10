import validateCatalog from './catalog.js';
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function eligible(task, node) { return (!task.pinnedNode || task.pinnedNode === node.id) && (!task.eligibleNodes || task.eligibleNodes.includes(node.id)); }
function wanted(task, node) { return !node.retired && eligible(task, node); }
function inEpoch(report, epoch) { return (report?.controlEpoch ?? 'initial') === epoch; }
function clockSkew(value) {
    if (!Number.isFinite(value) || value <= 0) { throw new TypeError('Positive finite clock skew bound required'); }
}
function copies(task) { return task.pinnedNode ? 1 : task.copies ?? 2; }
function freshRead(report, input, { now, freshnessMs, controlEpoch, clockSkewMs }) {
    return inEpoch(report, controlEpoch) && report?.tasks?.some((row) => {
        return row.taskId === input.taskId && row.generation === input.generation && row.state === 'running' && !['degraded', 'failed'].includes(row.health)
            && Number.isFinite(row.lastRead) && row.lastRead <= now + clockSkewMs && now - row.lastRead <= freshnessMs;
    });
}
function failedRead(report, input, controlEpoch) {
    return input && inEpoch(report, controlEpoch) && report?.tasks?.some((row) => {
        return row.taskId === input.taskId && row.generation === input.generation && row.state === 'failed';
    });
}
function updateAllowed(task, node, slots, reports, { now, freshnessMs, controlEpoch, clockSkewMs }) {
    const owners = slots.filter((slot) => { return slot.live && slot.assignments.some((row) => { return row.taskId === task.taskId; }); });
    const modern = owners.filter((slot) => { return slot.assignments.some((row) => { return row.taskId === task.taskId && same(row.spec, task.spec); }); });
    const ready = modern.some((slot) => {
        const input = slot.assignments.find((row) => { return row.taskId === task.taskId; });
        return freshRead(reports.get(slot.id), input, { now, freshnessMs, controlEpoch, clockSkewMs });
    });
    const healthy = owners.filter((slot) => { return freshRead(reports.get(slot.id), slot.assignments.find((row) => { return row.taskId === task.taskId; }), { now, freshnessMs, controlEpoch, clockSkewMs }); });
    function failed(slot) { return failedRead(reports.get(slot.id), slot.assignments.find((row) => { return row.taskId === task.taskId; }), controlEpoch); }
    const outdated = owners.filter((slot) => { return wanted(task, slot) && !modern.includes(slot)
        && (copies(task) === 1 || failed(slot) || healthy.some((other) => { return other.id !== slot.id; })); });
    return (modern.length === 0 || ready || failed(node)) && outdated[0]?.id === node.id;
}
function snapshots(slots, taskMap, { version: catalogVersion, controlEpoch = 'initial' }, reports, timing) {
    return Object.fromEntries(slots.map((node) => {
        const base = node.assignments.map((row) => {
            const task = taskMap.get(row.taskId);
            const update = node.live && task && wanted(task, node) && !same(task.spec, row.spec) && updateAllowed(task, node, slots, reports, { ...timing, controlEpoch });
            return update ? { ...row, spec: task.spec, assignedAt: timing.now } : row;
        });
        const complete = base.every((row) => { return same(row.spec, taskMap.get(row.taskId)?.spec); });
        const appliedCatalog = complete ? catalogVersion : node.previous.catalogVersion;
        const changed = node.live && (!same(base, node.previous.assignments) || node.previous.catalogVersion !== appliedCatalog || (node.previous.controlEpoch ?? 'initial') !== controlEpoch);
        const generation = node.previous.generation + Number(changed);
        const assignments = base.map((row) => {
            const old = node.previous.assignments.find((item) => { return item.taskId === row.taskId; });
            return { ...row, generation: old && same(old.spec, row.spec) ? old.generation : generation };
        });
        return [node.id, changed ? { generation, catalogVersion: appliedCatalog, controlEpoch, assignments } : node.previous];
    }));
}
/** Conservative coverage-first placement. Unreachable executors retain their last snapshot. */
// eslint-disable-next-line max-statements
export default function schedule(catalog, reports, current, { now = Date.now(), freshnessMs = 15000, replacementDelayMs = 30000, clockSkewMs = 5000 } = {}) {
    validateCatalog(catalog); clockSkew(clockSkewMs);
    const controlEpoch = catalog.controlEpoch ?? 'initial';
    const observed = new Map(reports.map((row) => { return [row.nodeId, row]; }));
    function live(id) { const at = observed.get(id)?.receivedAt; return Number.isFinite(at) && at <= now + clockSkewMs && now - at <= freshnessMs; }
    const taskMap = new Map(catalog.tasks.map((task) => { return [task.taskId, task]; }));
    const declared = new Set(catalog.nodes.map((node) => { return node.id; }));
    const nodes = [...catalog.nodes, ...Object.keys(current).filter((id) => { return !declared.has(id); }).map((id) => { return { id, capacity: 0, retired: true }; })];
    const slots = nodes.map((node) => {
        const previous = current[node.id] ?? { generation: 0, assignments: [] };
        const assignments = previous.assignments.filter((row) => { return !live(node.id) || taskMap.has(row.taskId); });
        return { ...node, previous, assignments: [...assignments], live: live(node.id), load: assignments.reduce((total, row) => { return total + (taskMap.get(row.taskId)?.cost ?? 1); }, 0) };
    });
    const tasks = [...catalog.tasks].sort((a, b) => { return Number(Boolean(b.pinnedNode)) - Number(Boolean(a.pinnedNode)) || a.taskId.localeCompare(b.taskId); });
    function owners(task) {
        return slots.filter((node) => {
            const input = node.assignments.find((row) => { return row.taskId === task.taskId; });
            const status = observed.get(node.id)?.tasks?.find((row) => { return row.taskId === task.taskId; });
            const progressing = input && freshRead(observed.get(node.id), input, { now, freshnessMs, controlEpoch, clockSkewMs });
            const starting = input && now - (input.assignedAt ?? now) <= replacementDelayMs;
            return node.live && input && status?.state !== 'failed' && (progressing || starting);
        });
    }
    for (let round = 0; round < Math.max(1, ...tasks.map(copies)); round += 1) {
        for (const task of tasks) {
            const active = owners(task).filter((node) => { return wanted(task, node); });
            const missing = slots.filter((node) => { return !node.live && node.assignments.some((row) => { return row.taskId === task.taskId; }); });
            const surviving = active.some((node) => { return freshRead(observed.get(node.id), node.assignments.find((row) => { return row.taskId === task.taskId; }), { now, freshnessMs, controlEpoch, clockSkewMs }); });
            const waiting = surviving && missing.some((node) => { return now - (observed.get(node.id)?.receivedAt ?? 0) < replacementDelayMs; });
            const candidates = slots.filter((node) => { return node.live && wanted(task, node) && !active.includes(node) && !node.assignments.some((row) => { return row.taskId === task.taskId; }) && node.load + (task.cost ?? 1) <= node.capacity; });
            candidates.sort((a, b) => { return a.load / a.capacity - b.load / b.capacity || a.id.localeCompare(b.id); });
            if (active.length <= round && active.length < copies(task) && !waiting && candidates.length) {
                const node = candidates[0];
                node.assignments.push({ taskId: task.taskId, specVersion: 1, generation: 0, assignedAt: now, spec: task.spec });
                node.load += task.cost ?? 1;
            }
        }
    }
    for (const task of tasks) {
        const active = owners(task);
        const confirmed = active.filter((node) => { return wanted(task, node) && node.assignments.some((row) => { return row.taskId === task.taskId && same(row.spec, task.spec); }) && freshRead(observed.get(node.id), node.assignments.find((row) => { return row.taskId === task.taskId; }), { now, freshnessMs, controlEpoch, clockSkewMs }); });
        if (confirmed.length >= copies(task)) {
            const keep = new Set(confirmed.slice(0, copies(task)).map((node) => { return node.id; }));
            slots.filter((node) => { return node.live && !keep.has(node.id); }).forEach((node) => {
                node.assignments = node.assignments.filter((row) => { return row.taskId !== task.taskId; });
            });
        }
    }
    return snapshots(slots, taskMap, catalog, observed, { now, freshnessMs, clockSkewMs });
}
