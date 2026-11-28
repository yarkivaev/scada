function native(device, kiosk) {
    const { apk } = device.application;
    return { name: kiosk.applicationName, pkg: apk.package, version: apk.version, versionCode: apk.versionCode,
        url: apk.url, sha256: apk.sha256, type: 'app', showIcon: true, runAfterInstall: true };
}

async function existing(client, desired) {
    const rows = await client.request('/private/configurations/applications');
    if (!Array.isArray(rows)) { throw new Error('MDMesh application inventory is invalid'); }
    const found = rows.filter(row => { return row.pkg === desired.pkg; });
    if (found.length > 1 || found.some(row => { return row.name !== desired.name; })) { throw new Error('HMI application package is ambiguous or unmanaged'); }
    if (!found[0]) { return undefined; }
    const current = await client.request(`/private/applications/${found[0].id}`);
    const versions = await client.request(`/private/applications/${found[0].id}/versions`);
    const version = versions.find(row => {return row.id === current.latestVersion});
    return { ...current, sha256: version?.apkHash ? Buffer.from(version.apkHash, 'base64url').toString('hex') : '' };
}

function matches(current, desired) {
    return current && ['pkg', 'version', 'versionCode', 'url', 'sha256'].every(key => { return current[key] === desired[key]; });
}

async function store(client, current, desired) {
    if (current) {
        await client.request('/private/applications/versions', 'PUT', { applicationId: current.id,
            version: desired.version, versionCode: desired.versionCode, url: desired.url,
            apkHash: Buffer.from(desired.sha256, 'hex').toString('base64url'), split: false });
    } else { await client.request('/private/applications/android', 'PUT', desired); }
}

function removal(row) {
    if (!Number.isSafeInteger(row.id) || row.id <= 0) { throw new Error('HMI retired package has invalid identity'); }
    return { id: row.id, usedVersionId: row.latestVersion || row.usedVersionId || row.id, action: 1, showIcon: false, remove: true };
}

async function retired(device, client) {
    const names = device.application.apk.retire || [];
    if (!names.length) { return []; }
    const rows = await client.request('/private/configurations/applications');
    if (!Array.isArray(rows)) { throw new Error('MDMesh application inventory is invalid'); }
    return names.flatMap((pkg) => {
        const found = rows.filter((row) => { return row.pkg === pkg; });
        if (found.length > 1) { throw new Error('HMI retired package is ambiguous'); }
        return found[0] ? [removal(found[0])] : [];
    });
}

/** Reconcile a signed, immutable HMI APK before using its VERSION identity in a kiosk configuration. */
export default async function hmiApplication(device, client, apply, kiosk) {
    const desired = native(device, kiosk);
    let current = await existing(client, desired);
    if (current && !matches(current, desired) && (current.version === desired.version || desired.versionCode <= current.versionCode)) {
        throw new Error('HMI APK identity is immutable; publish a new version with an increased versionCode');
    }
    if (apply && !matches(current, desired)) {
        await store(client, current, desired);
        current = await existing(client, desired);
        if (!matches(current, desired)) { throw new Error('MDMesh HMI application readback did not match its immutable APK'); }
    }
    if (!current || !matches(current, desired)) { return { ready: false, settings: {} }; }
    if (!Number.isSafeInteger(current.latestVersion) || current.latestVersion <= 0) { throw new Error('MDMesh HMI application has no version identity'); }
    const applications = [{ id: current.id, usedVersionId: current.latestVersion, action: 1, showIcon: true, remove: false }, ...await retired(device, client)];
    return { ready: true, settings: { mainAppId: current.latestVersion, autostartForeground: true, applications } };
}
