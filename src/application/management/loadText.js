/** Render queue pressure by broker and site, followed by optional site metrics. */
import terminalLabel from './terminalLabel.js';

function sum(queues, field) {
    if (queues.some((queue) => { return queue[field] === undefined; })) {
        return undefined;
    }
    return queues.reduce((total, queue) => { return total + queue[field]; }, 0);
}

function queueText({ name, ready, unacked, consumers, bytes, publishRate, ackRate }) {
    return `  ${terminalLabel(name)}\tready=${ready ?? '?'}\tunacked=${unacked ?? '?'}\tconsumers=${consumers ?? '?'}` +
        `\tbytes=${bytes ?? '?'}\tpub/s=${publishRate ?? '?'}\tack/s=${ackRate ?? '?'}`;
}

function brokerText({ name, site, queues, error }) {
    if (error) {
        return [`Queues ${site}/${name}\t${error}`];
    }
    return [`Queues ${site}/${name}\tready=${sum(queues, 'ready') ?? '?'}\tunacked=${sum(queues, 'unacked') ?? '?'}`,
        ...queues.map(queueText)];
}

function metricsText({ name, site, metrics, error }) {
    if (error) {
        return [`Metrics ${site}/${name}\t${error}`];
    }
    return [`Metrics ${site}/${name}`, ...metrics.map(({ name: metric, resource, value, unit, error: issue }) => {
        const id = resource ? `${metric}/${resource}` : metric;
        return `  ${terminalLabel(id)}\t${issue ?? `${value} ${unit}`}`;
    })];
}

export default function loadText({ brokers, metrics }) {
    const lines = [...brokers.flatMap(brokerText), ...metrics.flatMap(metricsText)];
    return lines.length ? lines.join('\n') : 'no load sources configured';
}
