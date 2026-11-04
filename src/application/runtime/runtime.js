import assignment, { identity } from './assignment.js';
import { halt, launch, view } from './taskSlot.js';
import resourceClaims from './resourceClaims.js';
import deadline from './deadline.js';
import taskBudget from './taskBudget.js';

function positive(value) {
    if (!Number.isSafeInteger(value) || value <= 0) { throw new TypeError('Runtime limits must be positive integers'); }
    return value;
}
function slotFor(ctx, taskId) {
    if (!ctx.slots.has(taskId)) {
        if (ctx.slots.size >= ctx.maxTasks) { throw new Error('Task capacity exceeded'); }
        ctx.slots.set(taskId, { taskId, generation: -1, state: 'idle', removed: false, task: null, chain: Promise.resolve() });
    }
    return ctx.slots.get(taskId);
}
function enqueue(ctx, input, action) {
    try {
        identity(input);
        if (ctx.stopping || ctx.fatal) { throw new Error('Runtime stopping or fatal'); }
        if (ctx.pending >= ctx.maxPending) { throw new Error('Control capacity exceeded'); }
        const slot = slotFor(ctx, input.taskId);
        ctx.pending += 1;
        const result = slot.chain.then(() => { return action(slot); }).finally(() => { ctx.pending -= 1; });
        slot.chain = result.catch(() => {
            // Preserve sequencing after a rejected command.
        });
        return result;
    } catch (error) { return Promise.reject(error); }
}
function duplicate(slot, request) {
    if (request.generation < slot.generation || (request.generation === slot.generation && slot.removed)) {
        throw new Error('stale assignment');
    }
    if (request.generation !== slot.generation) { return false; }
    if (slot.specHash !== request.specHash) { throw new Error('assignment conflict'); }
    return true;
}
async function apply(ctx, input, slot) {
    if (ctx.fatal || ctx.stopping) { throw new Error('Runtime stopping or fatal'); }
    const request = assignment(input, ctx.registry);
    if (duplicate(slot, request)) { return view(slot); }
    await deadline(() => { return request.adapter.validate(request.spec); }, ctx.startTimeoutMs);
    if (ctx.fatal || ctx.stopping) { throw new Error('Runtime stopping or fatal'); }
    const resources = request.adapter.resources(request.spec);
    ctx.claims.check(slot.taskId, resources);
    await halt(slot, ctx);
    if (ctx.fatal || ctx.stopping) { throw new Error('Runtime stopping or fatal'); }
    await launch(slot, request, ctx, resources);
    return view(slot);
}
async function remove(ctx, input, slot) {
    if (input.generation < slot.generation) { return view(slot); }
    slot.generation = input.generation;
    slot.removed = true;
    await halt(slot, ctx);
    Object.assign(slot, { state: 'stopped' });
    return view(slot);
}
function shutdown(ctx, milliseconds) {
    ctx.stopping = true;
    ctx.slots.forEach((slot) => { slot.controller?.abort(new Error('Runtime stopping')); });
    const tasks = Array.from(ctx.slots.values()).map((slot) => {
        return slot.chain.then(() => { return halt(slot, ctx); });
    });
    return deadline(() => { return Promise.all(tasks); }, milliseconds).catch((error) => {
        ctx.fatal = true;
        throw error;
    });
}
/** Identical local executors; placement and distributed ownership belong outside. */
export default function createRuntime(options) {
    const ctx = { registry: options.registry, slots: new Map(), claims: resourceClaims(), pending: 0, stopping: false, fatal: false,
        maxTasks: positive(options.maxTasks ?? 1000), maxPending: positive(options.maxPending ?? 100),
        stopTimeoutMs: positive(options.stopTimeoutMs ?? 10000), startTimeoutMs: positive(options.startTimeoutMs ?? 10000),
        budget: taskBudget(options.budgets ?? { maxBytes: 16777216, maxRecords: 16384 }),
        services: { stateStore: options.stateStore, secrets: options.secrets, report: options.report, deliveryQueue: options.deliveryQueue } };
    if (!(ctx.registry instanceof Map)) { throw new TypeError('registry must be a Map'); }
    return {
        apply(input) { return enqueue(ctx, input, (slot) => { return apply(ctx, input, slot); }); },
        remove(input) { return enqueue(ctx, input, (slot) => { return remove(ctx, input, slot); }); },
        status() { return { fatal: ctx.fatal, stopping: ctx.stopping, budget: ctx.budget.status(), tasks: Array.from(ctx.slots.values()).map(view) }; },
        stop({ deadlineMs = ctx.stopTimeoutMs } = {}) { return shutdown(ctx, positive(deadlineMs)); }
    };
}
