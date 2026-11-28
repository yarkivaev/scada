import { readFileSync } from 'node:fs';
import hmiControl from './hmiControl.js';
import mdmeshClient from './mdmeshClient.js';

function required(environment, key) {
    const value = environment[key];
    if (typeof value !== 'string' || !value.trim()) { throw new Error(`HMI runtime requires ${key}`); }
    return value;
}

function load(file) {
    let plan;
    try { plan = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error('HMI runtime cannot read its validated plan file'); }
    if (!plan || typeof plan.server !== 'string' || !plan.server || !Array.isArray(plan.devices)
        || !plan.profiles || typeof plan.profiles !== 'object' || Array.isArray(plan.profiles)) {
        throw new Error('HMI runtime requires a validated server catalog');
    }
    return plan;
}

function client(environment, prefix, url) {
    return mdmeshClient({ url, login: required(environment, `${prefix}_LOGIN`), password: required(environment, `${prefix}_PASSWORD`) });
}

/** Build the HTTP runtime from a mounted validated plan and separate Secret-backed identities. */
export default function hmiRuntime(environment, { kiosk, planFile, mdmeshURL }) {
    const plan = load(environment.HMI_PLAN_FILE || planFile);
    const token = required(environment, 'HMI_CONTROL_TOKEN');
    const url = environment.MDMESH_URL || mdmeshURL;
    const address = new URL(url);
    if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) { throw new Error('HMI runtime requires an HTTP MDMesh address without credentials'); }
    return hmiControl({ plan, token, kiosk, control: client(environment, 'MDMESH_API', url), monitor: client(environment, 'MDMESH_MONITOR', url) });
}
