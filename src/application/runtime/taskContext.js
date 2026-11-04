import taskBudget from './taskBudget.js';

/** Context never mutates environment or installs process-global handlers. */
export default function taskContext(slot, request, ctx) {
    const budget = taskBudget({ maxBytes: request.spec.limits?.maxBytes ?? 1048576,
        maxRecords: request.spec.limits?.maxRecords ?? 1024 }, ctx.budget);
    const { controller } = slot;
    return { ...ctx.services, taskId: slot.taskId, generation: slot.generation, signal: controller.signal, budget,
        report(event) {
            if (controller.signal.aborted) { return; }
            slot.health = event.state;
            if (event.read) { slot.lastRead = Date.now(); }
            if (event.delivered) { slot.lastDelivery = Date.now(); }
            try { ctx.services.report?.({ taskId: slot.taskId, generation: slot.generation, ...event }); } catch {
                // Observability cannot interrupt collection.
            }
        }
    };
}
