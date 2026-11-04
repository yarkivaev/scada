import validateCatalog from './catalog.js';
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function eligible(task, node) { return (!task.pinnedNode || task.pinnedNode === node.id) && (!task.eligibleNodes || task.eligibleNodes.includes(node.id)); }
function copies(task) { return task.pinnedNode ? 1 : task.copies ?? 2; }
function updateAllowed(task, node, slots, reports, { now, freshnessMs }) {
    const owners = slots.filter((slot) => { return slot.live && slot.assignments.some((row) => { return row.taskId === task.taskId; }); });
    const modern = owners.filter((slot) => { return slot.assignments.some((row) => { return row.taskId === task.taskId && same(row.spec, task.spec); }); });
    const ready = modern.some((slot) => {
        const input = slot.assignments.find((row) => { return row.taskId === task.taskId; });
        return reports.get(slot.id)?.tasks?.some((row) => { return row.taskId === task.taskId && row.generation === input.generation && row.state === 'running' && Number.isFinite(row.lastRead) && now - row.lastRead <= freshnessMs; });
    });
    const outdated = owners.filter((slot) => { return !modern.includes(slot); });
    return (modern.length === 0 || ready) && outdated[0]?.id === node.id;
}
function snapshots(slots, taskMap, { version: catalogVersion, controlEpoch = 'initial' }, reports, timing) {
    return Object.fromEntries(slots.map((node) => {
        const base = node.assignments.map((row) => {
            const task = taskMap.get(row.taskId);
            const update = node.live && task && !same(task.spec, row.spec) && updateAllowed(task, node, slots, reports, timing);
            return update ? { ...row, spec: task.spec, assignedAt: timing.now } : row;
        });
        const changed = node.live && (!same(base, node.previous.assignments) || node.previous.catalogVersion !== catalogVersion || (node.previous.controlEpoch ?? 'initial') !== controlEpoch);
        const generation = node.previous.generation + Number(changed);
        const assignments = base.map((row) => {
            const old = node.previous.assignments.find((item) => { return item.taskId === row.taskId; });
            return { ...row, generation: old && same(old.spec, row.spec) ? old.generation : generation };
        });
        return [node.id, changed ? { generation, catalogVersion, controlEpoch, assignments } : node.previous];
    }));
}
/** Conservative coverage-first placement. Unreachable executors retain their last snapshot. */
// eslint-disable-next-line max-statements
export default function schedule(catalog, reports, current, { now = Date.now(), freshnessMs = 15000, replacementDelayMs = 30000 } = {}) {
    validateCatalog(catalog);
    const observed = new Map(reports.map((row) => { return [row.nodeId, row]; }));
    function live(id) { const at = observed.get(id)?.receivedAt; return Number.isFinite(at) && at <= now && now - at <= freshnessMs; }
    const taskMap = new Map(catalog.tasks.map((task) => { return [task.taskId, task]; }));
    const slots = catalog.nodes.map((node) => {
        const previous = current[node.id] ?? { generation: 0, assignments: [] };
        const assignments = previous.assignments.filter((row) => { return !live(node.id) || (taskMap.has(row.taskId) && eligible(taskMap.get(row.taskId), node)); });
        return { ...node, previous, assignments: [...assignments], live: live(node.id), load: assignments.reduce((total, row) => { return total + (taskMap.get(row.taskId)?.cost ?? 1); }, 0) };
    });
    const tasks = [...catalog.tasks].sort((a, b) => { return Number(Boolean(b.pinnedNode)) - Number(Boolean(a.pinnedNode)) || a.taskId.localeCompare(b.taskId); });
    function owners(task) {
        return slots.filter((node) => {
            const input = node.assignments.find((row) => { return row.taskId === task.taskId; });
            const status = observed.get(node.id)?.tasks?.find((row) => { return row.taskId === task.taskId; });
            const progressing = Number.isFinite(status?.lastRead) && now - status.lastRead <= freshnessMs;
            const starting = input && now - (input.assignedAt ?? now) <= replacementDelayMs;
            return node.live && input && status?.state !== 'failed' && (progressing || starting);
        });
    }
    for (let round = 0; round < Math.max(1, ...tasks.map(copies)); round += 1) {
        for (const task of tasks) {
            const active = owners(task);
            const missing = slots.filter((node) => { return !node.live && node.assignments.some((row) => { return row.taskId === task.taskId; }); });
            const surviving = active.some((node) => { return observed.get(node.id)?.tasks?.some((row) => { return row.taskId === task.taskId && row.state === 'running' && Number.isFinite(row.lastRead) && now - row.lastRead <= freshnessMs; }); });
            const waiting = surviving && missing.some((node) => { return now - (observed.get(node.id)?.receivedAt ?? 0) < replacementDelayMs; });
            const candidates = slots.filter((node) => { return node.live && eligible(task, node) && !active.includes(node) && !node.assignments.some((row) => { return row.taskId === task.taskId; }) && node.load + (task.cost ?? 1) <= node.capacity; });
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
        const confirmed = active.filter((node) => { return observed.get(node.id)?.tasks?.some((row) => { return row.taskId === task.taskId && row.state === 'running' && Number.isFinite(row.lastRead) && now - row.lastRead <= freshnessMs; }); });
        if (confirmed.length >= copies(task)) {
            const keep = new Set(confirmed.slice(0, copies(task)).map((node) => { return node.id; }));
            active.filter((node) => { return !keep.has(node.id); }).forEach((node) => {
                node.assignments = node.assignments.filter((row) => { return row.taskId !== task.taskId; });
            });
        }
    }
    return snapshots(slots, taskMap, catalog, observed, { now, freshnessMs });
}
