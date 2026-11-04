import { createHash } from 'node:crypto';
/** Logical task identity is stable; broker client sessions belong to a replica. */
export default function localAssignment(input, nodeId) {
    const output = structuredClone(input);
    const suffix = createHash('sha256').update(`${nodeId}:${input.taskId}`).digest('hex').slice(0, 16);
    const specs = [output.spec.config, output.spec.source?.options, ...(output.spec.sinks ?? []).map((sink) => { return sink.options; })];
    let changed = false;
    for (const spec of specs) {
        if (typeof spec?.clientId === 'string') { spec.clientId = `${spec.clientId}-${suffix}`; changed = true; }
    }
    if (changed) { delete output.specHash; }
    return output;
}
