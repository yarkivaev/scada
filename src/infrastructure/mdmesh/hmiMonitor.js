function applicationState(device, sync) {
    if (!device.application.autoStart) { return 'waiting-app-configuration'; }
    return sync?.inSync === true ? 'configuration-in-sync' : 'awaiting-device';
}

function observed(device, actual, snapshot, now) {
    const [state, sync, telemetry] = snapshot;
    const lastSeen = state?.updatedAt || actual.lastUpdate;
    return { id: device.id, machine: device.machine, state: 'enrolled',
        ...(Number.isFinite(lastSeen) && lastSeen > 0 && { lastSeen, mdmOnline: now >= lastSeen && now - lastSeen <= 600000 }),
        battery: state?.battery ?? actual.info?.batteryLevel, charging: state?.charging,
        network: telemetry?.dynamic?.networkType, agentVersion: state?.agentVersion ?? actual.launcherVersion,
        configurationSync: { supported: sync?.supported, inSync: sync?.inSync }, hmiHealth: 'unknown',
        application: { state: applicationState(device, sync) } };
}

async function deviceStatus(device, inventory, client, now) {
    const matches = inventory.filter((row) => { return row.number === device.deviceRef; });
    if (!device.deviceRef || matches.length !== 1) {
        return { id: device.id, machine: device.machine, state: device.deviceRef ? 'unknown-reference' : 'planned-unbound', hmiHealth: 'unknown' };
    }
    const route = `/private/agent/v1/devices/${encodeURIComponent(device.deviceRef)}`;
    const [state, sync, telemetry] = await Promise.all(['/state', '/configStatus', '/telemetry'].map((suffix) => { return client.request(`${route}${suffix}`); }));
    return observed(device, matches[0], [state, sync, telemetry], now);
}

/** Observe only declared tablets with the read-only MDMesh identity, without inferring app health. */
export default async function hmiMonitor(plan, client, now = Date.now()) {
    const inventory = await client.inventory();
    const devices = await Promise.all(plan.devices.map((device) => { return deviceStatus(device, inventory, client, now); }));
    return { server: plan.server, up: true, devices };
}

function label(value) {
    return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

function samples(status, device) {
    const labels = `server="${label(status.server)}",device="${label(device.id)}"`;
    return [
        ...(typeof device.mdmOnline === 'boolean' ? [`hmi_mdm_device_online{${labels}} ${Number(device.mdmOnline)}`] : []),
        ...(Number.isFinite(device.lastSeen) ? [`hmi_device_last_seen_seconds{${labels}} ${device.lastSeen / 1000}`] : []),
        ...(typeof device.configurationSync?.inSync === 'boolean' && device.configurationSync.supported === true
            ? [`hmi_config_drift{${labels}} ${Number(!device.configurationSync.inSync)}`] : [])
    ];
}

/** Prometheus labels come exclusively from the validated DSL catalog. */
export function metrics(status) {
    return [`# TYPE hmi_up gauge`, `hmi_up{server="${label(status.server)}"} ${Number(status.up)}`,
        '# TYPE hmi_mdm_device_online gauge', '# TYPE hmi_device_last_seen_seconds gauge', '# TYPE hmi_config_drift gauge',
        ...status.devices.flatMap((device) => { return samples(status, device); }), ''].join('\n');
}
