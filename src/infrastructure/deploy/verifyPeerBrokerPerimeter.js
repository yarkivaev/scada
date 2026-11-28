import { isDeepStrictEqual } from 'node:util';
import { readKube } from './deploymentKube.js';

/** Bind supplied packet probe evidence to the live broker pod and network policy. */
export default function verifyPeerBrokerBoundary({ context, policy, allowedPeers, selector, proof, maxAgeMs = 900000 }, kube, now = Date.now()) {
    if (!policy) { return; }
    const verifiedAt = Date.parse(proof?.verifiedAt);
    if (!proof || proof.cluster !== context || !proof.networkPolicyEnforced
        || !isDeepStrictEqual(proof.allowedPeers, [...allowedPeers].sort()) || !proof.deniedSources?.length
        || proof.deniedSources.some((source) => { return allowedPeers.includes(source); })
        || !(verifiedAt <= now && verifiedAt > now - maxAgeMs)) {
        throw new Error('Fresh verified peer broker perimeter coverage evidence required');
    }
    const live = JSON.parse(readKube(kube, `networkpolicy/${policy.metadata.name}`));
    if (live.metadata.uid !== proof.policyUID || live.metadata.resourceVersion !== proof.policyResourceVersion
        || !isDeepStrictEqual(live.spec, policy.spec)) {
        throw new Error('Peer broker perimeter policy changed after packet probes');
    }
    const { items: pods } = JSON.parse(kube(['get', 'pods', '-l', selector, '-o', 'json'], undefined, true));
    if (pods.length !== 1 || pods[0].metadata.uid !== proof.brokerPodUID
        || !pods[0].status.containerStatuses?.every((container) => { return container.ready; })) {
        throw new Error('Peer broker identity changed after perimeter packet probes');
    }
}
