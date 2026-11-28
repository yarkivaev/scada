import { execFileSync } from 'node:child_process';
import path from 'node:path';
import applyWhenChanged from './applyWhenChanged.js';
import { deploymentKube, verifyKubeNode } from './deploymentKube.js';
import executeRelease, { requireReleaseAction } from './executeRelease.js';

/** Execute a chart release after binding live checks and dependencies to its target. */
export default function executeChartDeployment(profile, execute = execFileSync) {
    const { action = 'render', plan, chartRoot, preflight, release } = profile;
    requireReleaseAction(action);
    const chart = path.resolve(chartRoot, plan.chart);
    if (action !== 'render') {
        const kube = deploymentKube(plan, execute, { stdio: ['pipe', 'pipe', 'pipe'] });
        verifyKubeNode(kube, plan.nodeAddress);
        preflight?.(plan, kube);
    }
    execute('helm', ['dependency', 'build', '--skip-refresh', chart], { stdio: 'pipe' });
    return executeRelease({ ...plan, ...release?.(plan), chart }, action, applyWhenChanged(execute));
}
