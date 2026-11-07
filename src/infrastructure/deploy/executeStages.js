import { execFileSync } from 'node:child_process';
import executeRelease from './executeRelease.js';

/** Execute ordered full release plans, preflighting every stage before mutations.
 * Stage rollout/afterReady and beforeApply gates must succeed before continuing.
 * Read-only actions execute each stage without invoking mutation gates.
 */
export default function executeStages(stages, action = 'render', execute = execFileSync) {
    if (!Array.isArray(stages) || !stages.length) { throw new Error('stages must be a nonempty array'); }
    if (['apply', 'adopt'].includes(action)) {
        for (const stage of stages) {
            // SSA can claim legacy fields only after the stage's CSA handoff.
            // Validate all stages without mutating their current ownership first.
            executeRelease(stage, action === 'adopt' ? 'check-adoption' : 'check', execute);
        }
    }
    return stages.map((stage) => { return executeRelease(stage, action, execute); });
}
