import { deploymentKube, readKube, verifyKubeNode } from './deploymentKube.js';

function verifyDestination(kube, target, allowedPods) {
    verifyKubeNode(kube, target.nodeAddress);
    const { items } = JSON.parse(readKube(kube, 'pods'));
    if (items.some((pod) => { return !['Succeeded', 'Failed'].includes(pod.status?.phase) && !allowedPods.includes(pod.metadata.name); })) {
        throw new Error('Stop all application writers before history seed');
    }
}

/** Complete all bounded exports before writing to a verified, quiescent destination. */
export default function executeKubeSeed({ source, destination, transfers, allowedPods }, execute) {
    if (source.context === destination.context) { throw new Error('Separate exact source and destination required'); }
    const options = { timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] };
    const origin = deploymentKube(source, execute, { ...options, encoding: null, maxBuffer: 64 * 1024 * 1024 });
    const receiver = deploymentKube(destination, execute, { ...options, maxBuffer: 1024 * 1024 });
    verifyDestination(receiver, destination, allowedPods);
    const exports = transfers.map(({ read }) => { return origin(['exec', ...read]); });
    verifyDestination(receiver, destination, allowedPods);
    return transfers.map(({ name, write }, index) => {
        receiver(['exec', '-i', ...write], exports[index]);
        return name;
    });
}
