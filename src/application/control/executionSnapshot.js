import { checkSnapshot } from './snapshotFile.js';
export function remoteSnapshot(snapshot) {
    const remote = { ...snapshot };
    delete remote.localGeneration;
    delete remote.executionGenerations;
    return remote;
}
function epoch(snapshot) { return snapshot?.controlEpoch ?? 'initial'; }
/** Local runtime generations remain monotonic even when an operator restores etcd. */
export default function executionSnapshot(snapshot, previous, tasks, restored = false) {
    checkSnapshot(snapshot);
    const remote = remoteSnapshot(snapshot);
    if (previous && epoch(previous) === epoch(remote)) {
        if (remote.generation < previous.generation) { throw new Error('Stale assignment snapshot'); }
        if (remote.generation === previous.generation && JSON.stringify(remote) !== JSON.stringify(remoteSnapshot(previous))) { throw new Error('Conflicting assignment snapshot'); }
        if (remote.generation === previous.generation) { return previous; }
    }
    if (restored && Number.isSafeInteger(snapshot.localGeneration) && snapshot.executionGenerations) { return snapshot; }
    const localGeneration = Math.max(previous?.localGeneration ?? 0, remote.generation, ...tasks.map((row) => { return row.generation ?? 0; })) + 1;
    const executionGenerations = Object.fromEntries(remote.assignments.map((row) => {
        const prior = previous?.assignments.find((item) => { return item.taskId === row.taskId; });
        const unchanged = epoch(previous) === epoch(remote) && prior && prior.generation === row.generation && JSON.stringify(prior.spec) === JSON.stringify(row.spec);
        return [row.taskId, unchanged ? previous.executionGenerations[row.taskId] : localGeneration];
    }));
    return { ...remote, localGeneration, executionGenerations };
}
export function remoteStatus(status, snapshot) {
    return { ...status, tasks: status.tasks.map((row) => {
        const assignment = snapshot?.assignments.find((item) => { return item.taskId === row.taskId; });
        return { ...row, executionGeneration: row.generation, generation: assignment && row.generation === snapshot.executionGenerations[row.taskId] ? assignment.generation : null };
    }) };
}
