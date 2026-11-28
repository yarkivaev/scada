function pulseOutput(pulse, now, pulseIntervalMs) {
    const devices = new Map();
    function send(device, state) {
        const time = now();
        if (state.busy || state.value === undefined || time < state.nextAt) { return; }
        const { value } = state;
        Object.assign(state, { busy: true, value: undefined, nextAt: time + pulseIntervalMs });
        try {
            void Promise.resolve(pulse?.(value, device)).then(
                () => { state.busy = false; }, () => { state.busy = false; }
            );
        } catch {
            state.busy = false;
        }
    }
    return {
        mark(value, device) {
            const state = devices.get(device) ?? { busy: false, nextAt: -Infinity };
            state.value = value;
            devices.set(device, state);
        },
        flush() { devices.forEach((state, device) => { send(device, state); }); }
    };
}

function staleCount(channels, now) {
    return [...channels.values()].filter((channel) => {
        return channel.required && (channel.last === undefined || now() - channel.last > channel.maxAge);
    }).length;
}

function channelStates(connections, minimumMaxAgeMs, heartbeatMultiplier) {
    const states = new Map(connections.flatMap((connection) => {
        return connection.channels.map((channel) => {
            return [channel, { url: connection.url, required: connection.healthRequired !== false, last: undefined, maxAge: Math.max(minimumMaxAgeMs, heartbeatMultiplier * (connection.heartbeatMs ?? 1000)) }];
        });
    }));
    const requiredDevices = new Set();
    states.forEach((entry, channel) => { if (entry.required) { requiredDevices.add(channel.device); } });
    states.forEach((entry, channel) => { entry.markDevice = entry.required || !requiredDevices.has(channel.device); });
    return states;
}

/** Bad OPC values are not delivered by the source; silence therefore expires per channel. */
export default function opcuaHealth(connections, report, { now, schedule, pulse, minimumMaxAgeMs = 15000, heartbeatMultiplier = 3, pulseIntervalMs = 1000 }) {
    const channels = channelStates(connections, minimumMaxAgeMs, heartbeatMultiplier);
    const output = pulseOutput(pulse, now, pulseIntervalMs);
    let stopped = false;
    let previous;
    function check(progress = false) {
        if (stopped) { return; }
        const stale = staleCount(channels, now);
        const state = stale ? 'degraded' : 'running';
        if (previous !== state || (!stale && progress)) {
            previous = state;
            report({ state, message: stale ? `OPC UA: ${stale} channels await fresh Good delivery` : 'OPC UA channels fresh', fatal: false, ...(!stale && progress && { read: true }) });
        }
        for (const [channel, entry] of channels) {
            if (entry.required && entry.last !== undefined && now() - entry.last > entry.maxAge) {
                output.mark(0, channel.device);
            }
        }
        output.flush();
    }
    const cancel = schedule(check);
    check();
    return {
        good(channel) {
            if (stopped) { return; }
            const entry = channels.get(channel);
            if (entry) {
                entry.last = now();
                if (entry.markDevice) { output.mark(1, channel.device); }
            }
            check(Boolean(entry));
        },
        failed(error, connection) {
            if (stopped) { return; }
            const devices = new Set();
            for (const [channel, entry] of channels) {
                if (!connection || entry.url === connection.url) {
                    entry.last = undefined;
                    if (entry.markDevice) { devices.add(channel.device); }
                }
            }
            for (const device of devices) { output.mark(0, device); }
            check();
        },
        stop() { stopped = true; cancel(); }
    };
}
