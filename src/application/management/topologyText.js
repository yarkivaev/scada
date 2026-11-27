/** Format the production overview using logical names and flow directions. */
import terminalLabel from './terminalLabel.js';

function siteText(site) {
    return [`  ${terminalLabel(site.name)}\t${site.state}`,
        ...site.objects.map((path) => { return `    ${terminalLabel(path)}`; }),
        ...(site.localStreams.length ? [`    Local streams: ${site.localStreams.length}`] : [])];
}

function flowText({ from, to, streams, declared, traffic, evidence }) {
    const scope = declared === false ? 'observed route' : `streams=${streams.length}`;
    return [`  ${terminalLabel(from)} -> ${terminalLabel(to)}\t${scope}\t${traffic}`, ...evidence.map((item) => {
        const stream = item.stream ? `${terminalLabel(item.stream)} ` : '';
        return `    ${stream}${item.broker}/${terminalLabel(item.queue)}\t${item.traffic}\tack/s=${item.ackRate ?? '?'}`;
    })];
}

export default function topologyText({ namespace, sites, flows, state }) {
    const groups = namespace.filter((path) => { return path.split('/').length <= 3; });
    return [
        `Production  ${state}`,
        ...groups.map((path) => { return `  ${terminalLabel(path)}`; }),
        'Sites',
        ...sites.flatMap(siteText),
        'Flows',
        ...flows.flatMap(flowText)
    ].join('\n');
}
