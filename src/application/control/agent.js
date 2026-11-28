import executionSnapshot, { remoteSnapshot, remoteStatus } from './executionSnapshot.js';
import localAssignment from './localAssignment.js';
import { randomUUID } from 'node:crypto';
async function applyTasks(runtime,snapshot,nodeId,onError) {
    const ids=new Set(snapshot.assignments.map((row)=>{return row.taskId;}));
    const removals=runtime.status().tasks.filter((row)=>{return !ids.has(row.taskId);});
    const operations=[...removals.map((row)=>{return ()=>{return runtime.remove({taskId:row.taskId,generation:Math.max(snapshot.localGeneration,row.generation??0)});};}),
        ...snapshot.assignments.map((row)=>{return ()=>{return runtime.apply(localAssignment({...row,generation:snapshot.executionGenerations[row.taskId]},nodeId));};})];
    let applied=true;
    for (const operation of operations) {
        // One unavailable source must not prevent independent assignments from starting.
        // eslint-disable-next-line no-await-in-loop
        try {await operation();} catch(error) {applied=false; onError(error);}
    }
    return applied;
}
/** Keep reconciling the current assignment when the controller is unavailable. */
export default function assignmentAgent({ nodeId, store, runtime, validate, intervalMs = 5000, onError = () => {
    // Optional diagnostic sink.
} }) {
    if (!nodeId) { throw new TypeError('Control node id required'); }
    const state = { desired: null, appliedGeneration: null, stopped: false, timer: null, pending: null, sequence: 0, bootId: randomUUID() };
    // Serialized by tick and startup; mutations cannot overlap.
    /* eslint-disable require-atomic-updates */
    async function reconcile(input) {
        const remote = remoteSnapshot(input);
        await validate(remote);
        const snapshot = executionSnapshot(remote, state.desired, runtime.status().tasks);
        state.desired = snapshot;
        const applied=await applyTasks(runtime,snapshot,nodeId,onError);
        state.appliedGeneration=applied?snapshot.generation:null;
    }
    async function once() {
        if (state.stopped) { return; }
        let snapshot=state.desired;
        try {snapshot=await store.assignment(nodeId)??snapshot;} catch(error) {onError(error);}
        try {if(!state.stopped&&snapshot){await reconcile(snapshot);}} catch(error) {onError(error);}
        try {
            if (!state.stopped) { state.sequence += 1; await store.report(nodeId, { nodeId, bootId: state.bootId, sequence: state.sequence, receivedAt: Date.now(), receivedGeneration: state.desired?.generation ?? null, appliedGeneration: state.appliedGeneration, controlEpoch: state.desired?.controlEpoch ?? 'initial', ...remoteStatus(runtime.status(), state.desired) }); }
        } catch (error) { onError(error); }
    }
    function tick() {
        state.pending ??= once().finally(() => { state.pending = null; });
        return state.pending;
    }
    return {
        tick,
        status() { return { hasAssignment: Boolean(state.desired), appliedGeneration: state.appliedGeneration }; },
        async start({ waitForInitialTick = true } = {}) {
            if (waitForInitialTick) { await tick(); } else { void tick().catch(onError); }
            state.timer = setInterval(() => { void tick(); }, intervalMs);
        },
        async stop() { state.stopped = true; clearInterval(state.timer); await state.pending; }
    };
}
