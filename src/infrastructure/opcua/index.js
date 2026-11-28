import opcuaSource from './source.js';
export { validateConnections } from './config.js';

/** Compatibility adapter for callback-based SCADA consumers. */
export default function opcuaConnections(connections, publish, options = {}) {
    if (typeof publish !== 'function') { throw new TypeError('publish must be a function'); }
    return opcuaSource(connections, { accept: ({ channel, value }) => { return publish(channel, value); } }, options);
}

export { default as opcuaSource } from './source.js';
export { default as opcuaHealth } from './health.js';
