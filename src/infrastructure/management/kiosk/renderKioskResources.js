import { readFileSync } from 'node:fs';
import shellArgument from './shellArgument.js';

const assets = new Map([
    ['watchdog.sh', './watchdog.sh'],
    ['listen.mjs', './listen.mjs.txt'],
    ['watchdog-liveness.sh', './watchdog-liveness.sh'],
    ['watchdog-readiness.sh', './watchdog-readiness.sh'],
    ['wait-x11.sh', './wait-x11.sh']
]);

function asset(name) {
    const filename = assets.get(name);
    if (!filename) { throw new TypeError(`Unknown kiosk asset: ${name}`); }
    return readFileSync(new URL(filename, import.meta.url), 'utf8');
}

function argument(value) {
    if (typeof value !== 'string' || value.includes('\0')) { throw new TypeError('Invalid kiosk argument'); }
    return /^[\w/:.,=+@-]+$/u.test(value) ? value : shellArgument(value);
}

function launch({ executable, args, urlEnvironment }) {
    if (typeof executable !== 'string' || !executable.startsWith('/') || !Array.isArray(args)
        || typeof urlEnvironment !== 'string' || !/^[A-Za-z_]\w*$/u.test(urlEnvironment)) {
        throw new TypeError('Invalid kiosk executable declaration');
    }
    return `exec ${[executable, ...args].map(argument).join(' ')} "$${urlEnvironment}"\n`;
}

/** Materialize packaged kiosk scripts and a declared browser launch in Kubernetes objects. */
export default function renderKioskResources(value) {
    if (Array.isArray(value)) { return value.map(renderKioskResources); }
    if (value === null || typeof value !== 'object') { return value; }
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === 'kioskAsset') { return asset(value.kioskAsset); }
    if (keys.length === 1 && keys[0] === 'kioskLaunch') { return launch(value.kioskLaunch); }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
        return [key, renderKioskResources(item)];
    }));
}
