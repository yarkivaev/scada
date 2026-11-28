import hmiApplication from './hmiApplication.js';
import hmiFile, { fileChecksum } from './hmiFile.js';

function settings(profile) {
    if (typeof profile.kiosk !== 'boolean' || !['landscape', 'portrait'].includes(profile.orientation)) {
        throw new Error('HMI profile has invalid native settings');
    }
    return { kioskMode: profile.kiosk, orientation: profile.orientation === 'landscape' ? 2 : 1, ...profile.native };
}

async function defaults(client, rows, kiosk) {
    if (!rows.some((row) => { return row.id === 1 && !row.name.startsWith(`${kiosk.ownershipPrefix}:`); })) {
        throw new Error('MDMesh requires its default configuration template to create managed profiles');
    }
    const template = await client.request('/private/configurations/1');
    if (!template || !Array.isArray(template.applications)
        || ['downloadUpdates', 'requestUpdates', 'appPermissions', 'iconSize', 'desktopHeader'].some((key) => { return typeof template[key] !== 'string' || !template[key]; })) {
        throw new Error('MDMesh default configuration template is incomplete');
    }
    const base = { ...template, applications: [] };
    delete base.id;
    return base;
}

function sameApplication(row, desired) {
    return ['id', 'usedVersionId', 'action', 'showIcon', 'remove'].every(field => { return row[field] === desired[field]; });
}

function sameFile(row, desired) {
    return ['fileId', 'path', 'remove'].every((field) => { return row[field] === desired[field]; })
        && fileChecksum(row) === desired.checksum;
}

function mergeFiles(current, owned, devicePath) {
    const rest = (current || []).filter((row) => { return row.path !== devicePath; });
    return owned ? rest.concat(owned) : current;
}

function differs(current, native, devicePath) {
    return Object.entries(native).some(([key, value]) => {
        if (key === 'applications') {
            return current.applications.length !== value.length || value.some(app => {
                return !current.applications.some(row => { return sameApplication(row, app); });
            });
        }
        if (key === 'files') {
            const wanted = (value || []).filter((row) => { return row.path === devicePath; });
            const actual = (current.files || []).filter((row) => { return row.path === devicePath; });
            return wanted.length !== actual.length || wanted.some((file) => { return !actual.some((row) => { return sameFile(row, file); }); });
        }
        return current[key] !== value;
    });
}

async function details(client, id) {
    const current = await client.request(`/private/configurations/${encodeURIComponent(id)}`);
    const applications = await client.request(`/private/configurations/applications/${encodeURIComponent(id)}`);
    if (!Array.isArray(applications)) { throw new Error('MDMesh configuration application list is incomplete'); }
    return { ...current, applications: applications.filter(row => { return row.selected === true; }).map(row => {
        const application = { ...row };
        delete application.selected;
        return application;
    }) };
}

async function configuration(client, rows, id, profile, kiosk) {
    const name = `${kiosk.ownershipPrefix}:${id}`;
    const matches = rows.filter((row) => { return row.name === name; });
    if (matches.length > 1) { throw new Error('MDMesh has ambiguous managed configurations'); }
    const current = matches.length ? await details(client, matches[0].id) : undefined;
    if (current && (current.name !== name || !Array.isArray(current.applications))) { throw new Error('MDMesh full configuration is incomplete'); }
    const native = settings(profile);
    const base = current || { ...await defaults(client, rows, kiosk), name, description: name };
    return { id, current, desired: { ...base, ...native, files: mergeFiles(base.files, native.files, kiosk.devicePath) },
        drift: !current || differs(current, native, kiosk.devicePath) };
}

async function configurations(plan, client) {
    const rows = await client.request('/private/configurations/search');
    if (!Array.isArray(rows)) { throw new Error('MDMesh configuration search returned invalid data'); }
    return Promise.all(Object.entries(plan.profiles).map(([id, profile]) => { return configuration(client, rows, id, profile, plan.kiosk); }));
}

function devicesFor(plan, inventory) {
    return plan.devices.map((device) => {
        const matches = device.deviceRef ? inventory.filter((row) => { return row.number === device.deviceRef; }) : [];
        const state = device.deviceRef ? 'unknown-reference' : 'planned-unbound';
        if (matches.length > 1) { throw new Error('MDMesh has ambiguous enrolled device references'); }
        if (matches.length && (!Number.isSafeInteger(matches[0].id) || matches[0].id <= 0)) { throw new Error('MDMesh enrolled device has invalid identity'); }
        return { ...device, actual: matches[0], state: matches.length ? 'enrolled' : state };
    });
}

async function save(client, changes, index = 0) {
    if (index < changes.length) {
        await client.request('/private/configurations', 'PUT', changes[index].desired);
        await save(client, changes, index + 1);
    }
}

async function assign(client, devices, configs, index = 0) {
    if (index < devices.length) {
        const device = devices[index];
        const config = configs.find((entry) => { return entry.id === device.profile; });
        if (device.actual && config?.current?.id && device.actual.configurationId !== config.current.id) {
            await client.request('/private/devices', 'PUT', { ids: [device.actual.id], configurationId: config.current.id });
        }
        await assign(client, devices, configs, index + 1);
    }
}

function applicationState(device, applied) {
    if (!device.application.autoStart) { return 'waiting-app-configuration'; }
    if (applied) { return 'native-config-stored'; }
    return device.launchReady ? 'planned' : 'missing-apk';
}

function report(devices, configs, blocked, applied) {
    return { blocked, applied, profiles: configs.map((entry) => { return { id: entry.id, configurationId: entry.current?.id,
        drift: entry.drift, state: applied ? 'native-settings-stored' : 'planned',
        unsupported: ['orientation-delivery', 'keepScreenOnWhileCharging', 'alarmSound'] }; }),
    devices: devices.map((device) => { return { id: device.id, machine: device.machine, state: device.state,
        configurationDrift: device.actual ? device.actual.configurationId !== configs.find((entry) => { return entry.id === device.profile; })?.current?.id : undefined,
        application: { state: applicationState(device, applied), desired: device.application } }; }) };
}

function confirmed(devices, configs) {
    const matched = devices.every((device) => {
        const config = configs.find((entry) => { return entry.id === device.profile; });
        return !device.deviceRef || device.actual && device.actual.configurationId === config?.current?.id;
    });
    if (!matched) { throw new Error('MDMesh device assignment readback did not match the desired configuration'); }
    return devices;
}

async function persist(plan, client, devices, configs) {
    await save(client, configs.filter((entry) => { return entry.drift; }));
    const refreshed = await configurations(plan, client);
    if (refreshed.some((entry) => { return entry.drift || !Number.isSafeInteger(entry.current?.id) || entry.current.id <= 0; })) {
        throw new Error('MDMesh configuration readback did not match the desired native settings');
    }
    await assign(client, devices, refreshed);
    const inventory = devicesFor(plan, await client.inventory());
    return report(confirmed(inventory, refreshed), refreshed, false, true);
}

async function launchPlan(plan, client, apply) {
    const entries = await Promise.all(plan.devices.map(async device => {
        if (!device.application.autoStart) { return { device }; }
        const application = await hmiApplication(device, client, apply, plan.kiosk);
        const stored = await hmiFile(device, client, apply, plan.kiosk);
        const profile = `${device.profile}:${device.id}`;
        return { device: { ...device, profile, launchReady: application.ready && stored.ready }, profile,
            settings: { ...plan.profiles[device.profile], native: { ...application.settings, files: stored.file ? [stored.file] : undefined } } };
    }));
    return { ...plan, profiles: { ...plan.profiles, ...Object.fromEntries(entries.filter(entry => { return entry.profile; }).map(entry => { return [entry.profile, entry.settings]; })) },
        devices: entries.map(entry => { return entry.device; }) };
}

/** Store only owned native fields, preserving complete upstream documents and enrolled identities. */
export default async function hmiReconcile(source, client, apply, kiosk) {
    const initial = devicesFor(source, await client.inventory());
    const missing = initial.some(device => {return device.state === 'unknown-reference'});
    const plan = await launchPlan({ ...source, kiosk }, client, apply && !missing);
    const devices = devicesFor(plan, await client.inventory());
    const configs = await configurations(plan, client);
    const blocked = devices.some((device) => { return device.state === 'unknown-reference' || device.application.autoStart && !device.launchReady; });
    if (apply && !blocked) { return persist(plan, client, devices, configs); }
    return report(devices, configs, blocked, false);
}
