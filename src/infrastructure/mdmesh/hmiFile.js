import { createHash } from 'node:crypto';

function checksum(value) {
    return createHash('sha256').update(value).digest('hex');
}

function label(file) {
    return `${file.prefix}${checksum(file.href)}`;
}

function owned(row, file) {
    return typeof row.description === 'string' && row.description.startsWith(file.prefix);
}

export function fileChecksum(row) {
    if (typeof row.checksum === 'string' && /^[a-f0-9]{64}$/u.test(row.checksum)) { return row.checksum; }
    return String(row.description || '').split(':').at(-1);
}

function descriptor(row, path) {
    if (!Number.isSafeInteger(row.id) || row.id <= 0 || typeof row.url !== 'string' || !row.url) {
        throw new Error('MDMesh HMI file identity is incomplete');
    }
    // MDMesh assigns an association id; fileId identifies the uploaded file it links.
    return { fileId: row.id, path, overridePath: true, url: row.url, checksum: fileChecksum(row), remove: false };
}

async function locate(client, file) {
    const rows = await client.request('/private/web-ui-files/search');
    if (!Array.isArray(rows)) { throw new Error('MDMesh file inventory is invalid'); }
    return rows.find((row) => { return owned(row, file); });
}

async function commit(client, file, upload, current) {
    const body = { tmpPath: upload.serverPath, filePath: file.name, description: label(file),
        devicePath: file.path, checksum: checksum(file.href) };
    if (Number.isSafeInteger(current?.id) && current.id > 0) { body.id = current.id; }
    await client.request('/private/web-ui-files/update', 'POST', body);
    const stored = await locate(client, file);
    if (!stored || stored.description !== label(file)) {
        throw new Error('MDMesh HMI file readback did not match the catalog address');
    }
    return descriptor(stored, file.path);
}

/**
 * Store one per-tablet kiosk URL as a configuration file without embedding it in the APK.
 *
 * @example
 *   await hmiFile(device, client, true, kiosk);
 *
 * @param {object} device - catalog tablet
 * @param {object} client - MDMesh adapter with request and upload
 * @param {boolean} apply - write when true
 * @param {object} kiosk - ownership prefix, destination path and URL validator
 * @returns {Promise<{ready: boolean, file?: object}>} configuration file fragment
 */
export default async function hmiFile(device, client, apply, kiosk) {
    const file = { href: kiosk.validateAddress(device.application.href), name: `${device.id}.url`,
        path: kiosk.devicePath, prefix: `${kiosk.ownershipPrefix}:${device.id}:` };
    const current = await locate(client, file);
    if (current && current.description === label(file) && current.devicePath === file.path) {
        return { ready: true, file: descriptor(current, file.path) };
    }
    if (!apply) { return { ready: false }; }
    const upload = await client.upload(file.name, file.href);
    if (typeof upload?.serverPath !== 'string' || !upload.serverPath) { throw new Error('MDMesh HMI file upload returned no path'); }
    return { ready: true, file: await commit(client, file, upload, current) };
}
