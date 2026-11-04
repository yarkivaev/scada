import deadline from './deadline.js';
import taskContext from './taskContext.js';

export async function halt(slot, ctx) {
    if (!slot.task) { return; }
    slot.state = 'stopping';
    slot.controller.abort(new Error('Task revoked'));
    try {
        await deadline(() => { return slot.task.stop({ signal: slot.controller.signal }); }, ctx.stopTimeoutMs);
        ctx.claims.release(slot.taskId);
        slot.task = null;
        slot.state = 'stopped';
    } catch (error) {
        slot.state = 'failed';
        ctx.fatal = true;
        slot.reason = error.code ?? error.name;
        throw error;
    }
}
function validateTask(task) {
    if (!task || typeof task.start !== 'function' || typeof task.stop !== 'function') {
        throw new TypeError('Adapter must return synchronous lifecycle object');
    }
}
export async function launch(slot, request, ctx, resources) {
    ctx.claims.acquire(slot.taskId, resources);
    Object.assign(slot, { generation: request.generation, specHash: request.specHash, removed: false, state: 'starting', reason: null, health: 'unknown', lastRead: null, lastDelivery: null });
    slot.controller = new AbortController();
    const context = taskContext(slot, request, ctx);
    try {
        // Factories are synchronous: all I/O belongs in cancellable start().
        slot.task = request.adapter.create(request.spec, context);
        validateTask(slot.task);
        await deadline(() => { return slot.task.start(); }, ctx.startTimeoutMs);
        Object.assign(slot, { state: 'running' });
    } catch (error) {
        if (slot.task && typeof slot.task.stop === 'function') { await halt(slot, ctx); }
        else { ctx.claims.release(slot.taskId); slot.task = null; }
        Object.assign(slot, { state: 'failed', reason: error.code ?? error.name });
        throw error;
    }
}
export function view(slot) {
    return { taskId: slot.taskId, generation: slot.generation, specHash: slot.specHash,
        state: slot.state, health: slot.health ?? 'unknown', lastRead: slot.lastRead ?? null, lastDelivery: slot.lastDelivery ?? null, reason: slot.reason ?? null };
}
