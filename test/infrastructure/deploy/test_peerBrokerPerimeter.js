import assert from 'node:assert/strict';
import verifyPeerBrokerPerimeter from '../../../src/infrastructure/deploy/verifyPeerBrokerPerimeter.js';

const now = Date.now();
function fixture() {
    const policy = { metadata: { name: 'workshop-bus', uid: 'policy', resourceVersion: '9' },
        spec: { ingress: [{ from: [{ ipBlock: { cidr: '192.0.2.1/32' } }] }] } };
    const context = 'workshop';
    const proof = { cluster: context, networkPolicyEnforced: true, allowedPeers: ['192.0.2.1'], deniedSources: ['192.0.2.99'],
        verifiedAt: new Date(now).toISOString(), policyUID: 'policy', policyResourceVersion: '9', brokerPodUID: 'broker' };
    const pods = { items: [{ metadata: { uid: 'broker' }, status: { containerStatuses: [{ ready: true }] } }] };
    const options = { policy: structuredClone(policy), context, allowedPeers: ['192.0.2.1'], selector: 'app=bus', proof };
    return { options, policy, proof, pods, kube(args) {
        return JSON.stringify(args[1].startsWith('networkpolicy/') ? policy : pods);
    } };
}

describe('peer broker perimeter deployment gate', () => {
    it('accepts fresh packet probes bound to exact live policy and broker', () => {
        const { options, kube } = fixture();
        verifyPeerBrokerPerimeter(options, kube, now);
    });
    for (const [name, edit] of [
        ['missing proof', (data) => { delete data.options.proof; }],
        ['expired probes', (data) => { data.proof.verifiedAt = new Date(now - 900001).toISOString(); }],
        ['missing allowed peer', (data) => { data.proof.allowedPeers = []; }],
        ['missing denied source', (data) => { data.proof.deniedSources = []; }],
        ['policy replacement', (data) => { data.policy.metadata.uid = 'replacement'; }],
        ['policy change', (data) => { data.policy.metadata.resourceVersion = '10'; }],
        ['broker restart', (data) => { data.pods.items[0].metadata.uid = 'replacement'; }],
        ['unready broker', (data) => { data.pods.items[0].status.containerStatuses[0].ready = false; }]
    ]) {
        it(`refuses ${name} before storage apply`, () => {
            const data = fixture();
            edit(data);
            assert.throws(() => { verifyPeerBrokerPerimeter(data.options, data.kube, now); }, /perimeter/u);
        });
    }
});
