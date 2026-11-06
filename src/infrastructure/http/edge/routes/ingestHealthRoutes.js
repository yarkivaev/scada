import { route } from '@yarkivaev/simple-server';

/** Health never exposes credentials, messages or application records. */
export default function ingestHealthRoutes(health) {
    return [['/ready', 'ready'], ['/live', 'live']].map(([path, key]) => {return route('GET', path, (_req, res) => {
        const available = health()[key] === true;
        res.writeHead(available ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ [key]: available }));
    })});
}
