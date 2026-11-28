import { readFileSync } from 'node:fs';
import { request } from 'node:https';

const identity = '/var/run/secrets/kubernetes.io/serviceaccount';

function collect(response, limit, resolve, reject) {
    const chunks = [];
    let size = 0;
    response.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) {
            response.destroy(new Error('Kubernetes API response is too large'));
        } else {
            chunks.push(chunk);
        }
    });
    response.on('error', reject);
    response.on('end', () => {
        resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') });
    });
}

/** Authenticated JSON request to the cluster API using the mounted service account. */
export default function kubeServiceAccount(address, { limit = 1048576, timeoutMs = 8000 } = {}) {
    const base = new URL(address);
    if (base.protocol !== 'https:') { throw new TypeError('Kubernetes API requires HTTPS'); }
    return function exchange(method, path, body, contentType = 'application/json') {
        const target = new URL(path, base);
        if (target.origin !== base.origin) { throw new TypeError('Invalid Kubernetes API path'); }
        const token = readFileSync(`${identity}/token`, 'utf8').trim();
        const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': contentType };
        const ca = readFileSync(`${identity}/ca.crt`);
        return new Promise((resolve, reject) => {
            const connection = request(target, { method, headers, ca, rejectUnauthorized: true }, (response) => {
                collect(response, limit, resolve, reject);
            });
            const timer = setTimeout(() => { connection.destroy(new Error('Kubernetes API request timed out')); }, timeoutMs);
            connection.on('error', reject);
            connection.on('close', () => { clearTimeout(timer); });
            connection.end(body === undefined ? undefined : JSON.stringify(body));
        });
    };
}
