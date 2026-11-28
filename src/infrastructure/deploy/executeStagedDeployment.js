import { execFileSync } from 'node:child_process';
import applyWhenChanged from './applyWhenChanged.js';
import { requireReleaseAction } from './executeRelease.js';
import executeStages from './executeStages.js';

function selected(plan, omit) {
    if (omit.length === 0) { return plan; }
    return { ...plan, stages: plan.stages.filter(({ id }) => { return !omit.includes(id); }) };
}

function stagePlans(plan, hooks) {
    return plan.stages.map((stage) => {
        return { ...stage, ...(Object.hasOwn(hooks, stage.id) ? hooks[stage.id] : {}) };
    });
}

/** Execute declared stages with guarded preparation and stage-specific application ports. */
export default function executeStagedDeployment(profile, execute = execFileSync) {
    const { action = 'render', plan, prepare, omitStages = [], validateMutation, preflight, stageHooks, afterApply,
        actions = {}, disabledActions = [] } = profile;
    if (disabledActions.includes(action)) { throw new Error(`${plan.context} deployment disabled: target is offline`); }
    const scoped = selected(plan, omitStages);
    if (Object.hasOwn(actions, action)) { return actions[action](scoped, execute); }
    requireReleaseAction(action);
    const mutate = ['apply', 'adopt'].includes(action);
    if (mutate) { validateMutation?.(scoped); }
    const prepared = prepare ? selected(prepare(action, scoped), omitStages) : scoped;
    if (action !== 'render') { preflight?.(prepared, action, mutate); }
    const output = executeStages(stagePlans(prepared, stageHooks?.(prepared) ?? {}), action, applyWhenChanged(execute)).join('\n');
    return mutate && afterApply ? `${output}\n${afterApply(prepared, execute)}` : output;
}
