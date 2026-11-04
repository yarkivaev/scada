import localAssignment from './localAssignment.js';
import { randomUUID } from 'node:crypto';
import { checkSnapshot, loadSnapshot, saveSnapshot } from './snapshotFile.js';
/** Control connectivity never determines whether the saved assignment may execute. */
export default function assignmentAgent({ nodeId, file, store, runtime, validate, intervalMs = 5000, onError = () => {
    // Optional diagnostic sink.
} }) {
    if (!nodeId || !file) { throw new TypeError('Control node id and assignment file required'); }
    const state = { desired: null, appliedGeneration: null, stopped: false, timer: null, pending: null, sequence: 0, bootId: randomUUID() };
    // Serialized by tick and startup; mutations cannot overlap.
    /* eslint-disable require-atomic-updates */
    // eslint-disable-next-line max-statements
    async function reconcile(snapshot) {
        checkSnapshot(snapshot);
        if (state.desired && snapshot.generation < state.desired.generation) { throw new Error('Stale assignment snapshot'); }
        if (state.desired && snapshot.generation === state.desired.generation && JSON.stringify(snapshot) !== JSON.stringify(state.desired)) { throw new Error('Conflicting assignment snapshot'); }
        await validate(snapshot);
        if (!state.desired || snapshot.generation !== state.desired.generation) {
            await saveSnapshot(file, snapshot);
            state.desired = snapshot;
        }
        const ids = new Set(snapshot.assignments.map((row) => { return row.taskId; }));
        for (const row of runtime.status().tasks) {
            if (!ids.has(row.taskId)) {
                // eslint-disable-next-line no-await-in-loop
                await runtime.remove({ taskId: row.taskId, generation: Math.max(snapshot.generation, row.generation ?? 0) });
            }
        }
        for (const row of snapshot.assignments) {
            // eslint-disable-next-line no-await-in-loop
            await runtime.apply(localAssignment(row, nodeId));
        }
        state.appliedGeneration = snapshot.generation;
    }
    async function once() {
        if (state.stopped) { return; }
        try {
            const snapshot = await store.assignment(nodeId);
            if (!state.stopped && snapshot) { await reconcile(snapshot); }
        } catch (error) { onError(error); }
        try {
            if (!state.stopped) { state.sequence += 1; await store.report(nodeId, { nodeId, bootId: state.bootId, sequence: state.sequence, receivedAt: Date.now(), receivedGeneration: state.desired?.generation ?? null, appliedGeneration: state.appliedGeneration, ...runtime.status() }); }
        } catch (error) { onError(error); }
    }
    function tick() {
        state.pending ??= once().finally(() => { state.pending = null; });
        return state.pending;
    }
    return {
        tick,
        async start() {
            const saved = await loadSnapshot(file);
            if (saved) { await reconcile(saved); }
            await tick();
            state.timer = setInterval(() => { void tick(); }, intervalMs);
            state.timer.unref();
        },
        async stop() { state.stopped = true; clearInterval(state.timer); await state.pending; }
    };
}
