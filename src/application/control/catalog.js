const identifier = /^[\w.:-]{1,200}$/u;
export default function validateCatalog(catalog) {
    if (!catalog || typeof catalog.version !== 'string' || !Array.isArray(catalog.nodes) || !Array.isArray(catalog.tasks)) {
        throw new TypeError('Invalid control catalog');
    }
    const nodes = new Set();
    for (const node of catalog.nodes) {
        if (typeof node.id !== 'string' || !identifier.test(node.id) || nodes.has(node.id) || !Number.isFinite(node.capacity) || node.capacity <= 0) { throw new TypeError('Invalid control node'); }
        nodes.add(node.id);
    }
    const tasks = new Set();
    for (const task of catalog.tasks) {
        if (typeof task.taskId !== 'string' || tasks.has(task.taskId) || !task.spec?.adapter || !Number.isSafeInteger(task.copies ?? 2) || (task.copies ?? 2) < 1
            || !Number.isFinite(task.cost ?? 1) || (task.cost ?? 1) <= 0 || (task.pinnedNode && !nodes.has(task.pinnedNode))
            || (task.eligibleNodes && (!Array.isArray(task.eligibleNodes) || task.eligibleNodes.some((id) => { return !nodes.has(id); })))) {
            throw new TypeError('Invalid control task');
        }
        if ((task.spec.adapter === 'serial' || String(task.spec.from ?? '').startsWith('rtu:')) && !task.pinnedNode) { throw new TypeError('Serial task requires pinnedNode'); }
        tasks.add(task.taskId);
    }
    return catalog;
}
