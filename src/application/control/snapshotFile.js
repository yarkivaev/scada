import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export function checkSnapshot(value) {
    if (!value || !Number.isSafeInteger(value.generation) || value.generation < 0 || !Array.isArray(value.assignments)) { throw new TypeError('Invalid assignment snapshot'); }
    return value;
}
export async function loadSnapshot(file) {
    try { return checkSnapshot(JSON.parse(await readFile(file, 'utf8'))); } catch (error) { if (error.code === 'ENOENT') { return null; } throw error; }
}
export async function saveSnapshot(file, snapshot) {
    checkSnapshot(snapshot);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify(snapshot)); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, file);
        const directory = await open(path.dirname(file), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
    } finally { await unlink(temporary).catch(() => {
        // Rename may already have consumed the temporary file.
    }); }
}
