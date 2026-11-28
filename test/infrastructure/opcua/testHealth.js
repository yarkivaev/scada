import assert from 'node:assert/strict';
import opcuaHealth from '../../../src/infrastructure/opcua/health.js';

it('watermarks device health zero when an OPC UA connection fails', function() {
    const pulses = [];
    const channel = { device: 'fixture-drive', key: 'speed' };
    const connection = { url: 'opc.tcp://sensor', channels: [channel] };
    const health = opcuaHealth([connection], () => {}, {
        now: () => {return 0},
        schedule: () => { return () => {}; },
        pulse(value, device) { pulses.push({ value, device }); }
    });
    health.failed(new Error('socket disconnected'), connection);
    health.stop();
    assert.deepEqual(pulses, [{ value: 0, device: channel.device }], 'a dead OPC UA socket did not watermark device health');
});

it('marks device health when an OPC UA channel delivers', function() {
    const pulses = [];
    const channel = { device: 'fixture-pump', key: 'speed' };
    const health = opcuaHealth([{ url: 'opc.tcp://sensor', channels: [channel] }], () => {}, {
        now: () => {return 10},
        schedule: () => { return () => {}; },
        pulse(value, device) { pulses.push({ value, device }); }
    });
    health.good(channel);
    health.stop();
    assert.deepEqual(pulses.at(-1), { value: 1, device: channel.device }, 'a live OPC UA sample did not mark device health');
});

it('does not surface a rejected device health pulse as an unhandled rejection', async function() {
    const seen = [];
    function capture(reason) { seen.push(reason); }
    process.on('unhandledRejection', capture);
    try {
        const channel = { device: 'fixture-drive', key: 'speed' };
        const connection = { url: 'opc.tcp://sensor', channels: [channel] };
        const health = opcuaHealth([connection], () => {}, {
            now: () => {return 0},
            schedule: () => { return () => {}; },
            pulse() { return Promise.reject(new Error('queue full')); }
        });
        health.failed(new Error('socket disconnected'), connection);
        await new Promise((resolve) => { setImmediate(resolve); });
        health.stop();
        assert.equal(seen.length, 0, 'a rejected device health pulse became an unhandled rejection');
    } finally {
        process.off('unhandledRejection', capture);
    }
});

it('bounds slow device health writes per device and coalesces to the latest value', async function() {
    const channels = [{ device: 'device-a', key: 'one' }, { device: 'device-a', key: 'two' },
        { device: 'device-b', key: 'one' }];
    const connection = { url: 'opc.tcp://sensor', channels };
    const pulses = [];
    let tick;
    let time = 0;
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const health = opcuaHealth([connection], () => {}, {
        now: () => {return time},
        schedule(callback) { tick = callback; return () => {}; },
        pulse(value, device) {
            pulses.push([device, value]);
            if (pulses.length === 1) { return blocked; }
            return undefined;
        }
    });
    try {
        health.good(channels[0]);
        for (let sample = 0; sample < 15; sample += 1) { health.good(channels[1]); }
        health.good(channels[2]);
        time = 500;
        health.good(channels[2]);
        tick();
        assert.deepEqual(pulses, [['device-a', 1], ['device-b', 1]]);
        await new Promise(resolve => { setImmediate(resolve); });
        time = 16000;
        tick();
        assert.deepEqual(pulses.at(-1), ['device-b', 0]);
        assert.equal(pulses.filter(([device]) => {return device === 'device-a'}).length, 1);
        release();
        await new Promise(resolve => { setImmediate(resolve); });
        tick();
        assert.deepEqual(pulses.at(-1), ['device-a', 0]);
        assert.equal(pulses.length, 4);
    } finally {
        release();
        health.stop();
    }
    time += 1000;
    tick();
    assert.equal(pulses.length, 4);
});

it('writes zero when a fresh value shares a device with an expired required channel', async function() {
    let time = 0;
    const channels = [{ device: 'device', key: 'one' }, { device: 'device', key: 'two' }];
    const pulses = [];
    const health = opcuaHealth([{ url: 'opc.tcp://sensor', channels }], () => {}, {
        now: () => {return time}, schedule: () => {return () => {}}, pulse(value) { pulses.push(value); }
    });
    try {
        channels.forEach(channel => { health.good(channel); });
        await new Promise(resolve => { setImmediate(resolve); });
        time = 16000;
        health.good(channels[0]);
        assert.deepEqual(pulses, [1, 0]);
    } finally {
        health.stop();
    }
});

it('keeps the marker for a required device independent of failures on its optional endpoint', async function() {
    let time = 0;
    const required = { url: 'opc.tcp://caster', channels: [{ device: 'caster', key: 'temperature' }] };
    const optional = { url: 'opc.tcp://cooling', healthRequired: false, channels: [{ device: 'caster', key: 'cooling' }] };
    const pulses = [];
    const health = opcuaHealth([required, optional], () => {}, {
        now: () => {return time}, schedule: () => {return () => {}}, pulse(value) { pulses.push(value); }
    });
    try {
        health.good(required.channels[0]);
        await new Promise(resolve => { setImmediate(resolve); });
        time = 1000;
        health.failed(new Error('optional disconnected'), optional);
        health.good(required.channels[0]);
        assert.deepEqual(pulses, [1, 1]);
    } finally {
        health.stop();
    }
});
