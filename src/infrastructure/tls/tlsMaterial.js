import {createPrivateKey, createPublicKey, X509Certificate} from 'node:crypto';
import {rootCertificates} from 'node:tls';
import { readFileSync } from 'node:fs';
import { jsonDigest } from '../replication/canonicalJSON.js';

export const tlsMaterialLimit = 1024 * 1024;
const defaultFormat = 'tls-material-v1';

function invalid() { throw new Error('Public TLS renewal is invalid'); }

export function sealTLSMaterial(cert, key, { format = defaultFormat } = {}) {
    const content = {cert:Buffer.from(cert).toString('base64'),key:Buffer.from(key).toString('base64')};
    return {format, ...content, hash: jsonDigest(content)};
}

function chain(cert) {
    const blocks = cert.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu);
    if (!blocks?.length || blocks.length > 8) { invalid(); }
    return blocks.map(block => { return new X509Certificate(block); });
}

function trusted(certificates, roots, now) {
    if (certificates.some(cert => { return now < Date.parse(cert.validFrom) || now >= Date.parse(cert.validTo); })) { invalid(); }
    const linked = certificates.every((cert,index) => {
        return index === certificates.length - 1 || certificates[index + 1].ca
            && cert.checkIssued(certificates[index + 1]) && cert.verify(certificates[index + 1].publicKey);
    });
    const last = certificates[certificates.length - 1];
    if (!linked || !roots.some(pem => {
        const root = new X509Certificate(pem);
        return now >= Date.parse(root.validFrom) && now < Date.parse(root.validTo)
            && (last.raw.equals(root.raw) || last.checkIssued(root) && last.verify(root.publicKey));
    })) { invalid(); }
}

export function validateTLSMaterial(payload, { hosts, roots = rootCertificates, now = Date.now(), format = defaultFormat }) {
    try {
        if (!payload || payload.format !== format || typeof payload.cert !== 'string'
            || typeof payload.key !== 'string' || payload.hash !== jsonDigest({cert:payload.cert,key:payload.key})
            || !Array.isArray(hosts) || !hosts.length || Buffer.byteLength(JSON.stringify(payload)) > tlsMaterialLimit) { invalid(); }
        const certificates = chain(Buffer.from(payload.cert,'base64').toString('utf8'));
        const [leaf] = certificates;
        if (leaf.ca || hosts.some(host => { return !leaf.checkHost(host); })
            || leaf.keyUsage?.length && !leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1') && !leaf.keyUsage.includes('2.5.29.37.0')) { invalid(); }
        const publicKey = createPublicKey(createPrivateKey(Buffer.from(payload.key,'base64'))).export({type:'spki',format:'der'});
        if (!leaf.publicKey.export({type:'spki',format:'der'}).equals(publicKey)) { invalid(); }
        trusted(certificates,roots,now);
        return {'tls.crt':payload.cert,'tls.key':payload.key};
    } catch { invalid(); }
    return undefined;
}

/** Read material per request so a rotating secret is served without restarting the origin. */
export function readTLSMaterial({ cert, key } = {}, options = {}) {
    if (cert && key) { return sealTLSMaterial(readFileSync(cert), readFileSync(key), options); }
    return undefined;
}
