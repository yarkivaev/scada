import { assertLeaf, deviceFlows, expandObjects } from './expandDevices.js';
import { availableNames, expandApis, publishedNames } from './publishedStreams.js';
import { serviceOf } from './releaseNodes.js';
import { isAddress, picked } from './expandPattern.js';

/**
 * Selects pattern matches, keeping a concrete name even when the pool lacks it.
 *
 * @param {string} pattern - flow name pattern
 * @param {string[]} pool - candidate names
 * @param {boolean} strict - whether a star that misses is an error
 * @returns {string[]} names
 * @example
 *   chosen('mill/unit', ['mill/unit'], true);
 */
function chosen(pattern, pool, strict) {
    if (!pattern.includes('*') && !pattern.includes('{')) {
        if (pattern.split('/').some((part) => {
            return part.length === 0;
        })) {
            throw new Error(`system document path ${pattern} has an empty segment`);
        }
        return [pattern];
    }
    return picked(pattern, pool, 'path', strict);
}

/**
 * Names a source already sends to one receiver, or the streams it holds.
 *
 * @param {object} source - source draft
 * @param {string} receiverId - receiver id
 * @returns {string[]} candidate names
 * @example
 *   poolOf({ fanIn: [], fanOut: [] }, 'archive');
 */
function poolOf(source, receiverId, api) {
    const available = availableNames(source, api);
    const aimed = source.fanOut.filter((flow) => {
        return flow.to === receiverId;
    }).map((flow) => {
        return flow.name;
    });
    if (aimed.length > 0) {
        return aimed.filter((name) => { return available.includes(name); });
    }
    return available;
}

/**
 * Expands fan-out to streams this server already has.
 *
 * A star does not add names from the rest of the namespace.
 *
 * @param {object} server - server draft
 * @param {string[]} ids - server ids
 * @param {boolean} strict - whether a miss is an error
 * @returns {object[]} concrete fan-out
 * @example
 *   expandOut({ fanIn: [], objects: [], patternsOut: [] }, [], true);
 */
function expandOut(server, ids, strict) {
    const rows = [];
    const streams = availableNames(server);
    server.patternsOut.forEach((flow) => {
        const destinations = picked(flow.to, ids, 'server', true);
        const names = picked(flow.name, streams, 'path', strict);
        destinations.forEach((dest) => {
            names.forEach((path) => {
                assertLeaf(server.objects, path);
                rows.push({ name: path, to: dest });
            });
        });
    });
    return rows;
}

/* A fixed object path can be held implicitly, but an API-only stream requires its service. */
function incomingNames(source, receiver, flow, strict) {
    const api = serviceOf(source, flow.api)?.id;
    const pool = poolOf(source, receiver, api);
    const names = chosen(flow.name, pool, strict);
    if (strict && api && publishedNames(source).includes(flow.name)
        && !availableNames(source, api).includes(flow.name)) {
        throw new Error(`system document stream ${flow.name} is unavailable on api ${flow.api}`);
    }
    return names;
}

/**
 * Expands fan-in whose source is a server.
 *
 * Each matching server contributes its own outgoing names.
 *
 * @param {object} server - receiver draft
 * @param {object[]} drafts - drafts with fan-out already expanded
 * @param {boolean} strict - whether a star that misses is an error
 * @returns {object[]} concrete fan-in
 * @example
 *   expandIn({ id: 'archive', objects: [], patternsIn: [] }, [], true);
 */
function expandIn(server, drafts, strict) {
    const rows = [];
    server.patternsIn.forEach((flow) => {
        if (Object.hasOwn(flow, 'mapping')) {
            throw new Error(`system document flow from ${flow.from} names a mapping`);
        }
        const sources = picked(flow.from, drafts.map((item) => {
            return item.id;
        }), 'server', true);
        sources.forEach((sourceId) => {
            const source = drafts.find((item) => {
                return item.id === sourceId;
            });
            incomingNames(source, server.id, flow, strict).forEach((path) => {
                assertLeaf(server.objects, path);
                const copy = { from: sourceId, name: path };
                if (flow.api) {
                    copy.api = flow.api;
                }
                rows.push(copy);
            });
        });
    });
    return rows;
}

/**
 * Splits device fan-in from server fan-in.
 *
 * @param {object} server - declared server
 * @param {string[]} paths - namespace paths
 * @param {object} mappings - shared point maps
 * @returns {object} server draft
 * @example
 *   draftOne({ fan_in: [], id: 'cell', profile: { id: 'cell' } }, [], {});
 */
function draftOne(server, paths, mappings) {
    if (!server.profile || typeof server.profile.id !== 'string') {
        throw new Error(`system document server ${server.id} has no profile`);
    }
    const local = [];
    const objects = expandObjects(server.objects, paths);
    const remote = [];
    (server.fan_in || []).forEach((flow) => {
        if (!flow.from) {
            throw new Error(`system document server ${server.id} fan-in has no from`);
        }
        if (isAddress(flow.from)) {
            deviceFlows(flow, paths, mappings, objects).forEach((item) => {
                local.push(item);
            });
            return;
        }
        remote.push(flow);
    });
    return {
        api: expandApis(server.api, paths, objects),
        fanIn: local,
        id: server.id,
        objects,
        ownership: server.ownership,
        modules: server.modules,
        patternsIn: remote,
        patternsOut: server.fan_out || [],
        profile: server.profile,
        service: server.service
    };
}

/**
 * Recomputes fan-out and server fan-in from the streams held so far.
 *
 * @param {object[]} drafts - server drafts
 * @param {boolean} strict - whether a miss is an error
 * @returns {object[]} next drafts
 * @example
 *   wave([], false);
 */
function wave(drafts, strict) {
    const ids = drafts.map((server) => {
        return server.id;
    });
    const withOut = drafts.map((server) => {
        return { ...server, fanOut: expandOut(server, ids, strict) };
    });
    return withOut.map((server) => {
        const incoming = expandIn(server, withOut, strict);
        const local = server.fanIn.filter((flow) => {
            return isAddress(flow.from);
        });
        return { ...server, fanIn: local.concat(incoming) };
    });
}

/**
 * Fingerprints expanded flow names.
 *
 * @param {object[]} drafts - server drafts
 * @returns {string} stable signature
 * @example
 *   signature([]);
 */
function signature(drafts) {
    return JSON.stringify(drafts.map((server) => {
        return {
            fanIn: server.fanIn.map((flow) => {
                return `${flow.from}|${flow.name}`;
            }),
            fanOut: (server.fanOut || []).map((flow) => {
                return `${flow.to}|${flow.name}`;
            })
        };
    }));
}

/**
 * Copies a draft into a server record.
 *
 * @param {object} server - settled draft
 * @returns {object} server
 * @example
 *   materialize({ fanIn: [], fanOut: [], id: 'cell', objects: [], profile: { id: 'cell' } });
 */
function materialize(server) {
    const row = {
        fan_in: server.fanIn,
        fan_out: server.fanOut,
        id: server.id,
        objects: server.objects,
        profile: server.profile
    };
    if (server.api) {
        row.api = server.api;
    }
    if (server.ownership) {
        row.ownership = server.ownership;
    }
    if (server.service) {
        row.service = server.service;
    }
    if (server.modules) {
        row.modules = server.modules;
    }
    return row;
}

/**
 * Expands flows until forwarded names stop appearing.
 *
 * @param {object[]} drafts - initial drafts
 * @returns {object[]} settled drafts
 * @example
 *   settle([]);
 */
function settle(drafts) {
    let current = drafts;
    const limit = drafts.length + 3;
    let prior = '';
    for (let turn = 0; turn < limit; turn += 1) {
        const next = wave(current, false);
        const sign = signature(next);
        if (sign === prior) {
            return wave(current, true);
        }
        prior = sign;
        current = next;
    }
    throw new Error('system document flows did not settle');
}

/**
 * Expands every server's objects, fan-in, and fan-out.
 *
 * @param {object[]} servers - declared servers
 * @param {string[]} paths - namespace paths
 * @param {object} mappings - shared point maps
 * @returns {object[]} expanded servers
 * @example
 *   expandServers([], [], {});
 */
export function expandServers(servers, paths, mappings) {
    const ids = servers.map((server) => {
        return server.id;
    });
    ids.forEach((id, index) => {
        if (ids.indexOf(id) !== index) {
            throw new Error(`system document server ${id} is duplicated`);
        }
    });
    return settle(servers.map((server) => {
        return draftOne(server, paths, mappings);
    })).map((server) => {
        return materialize(server);
    });
}
