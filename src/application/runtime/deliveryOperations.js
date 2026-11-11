function positive(value, name, zero = false) {
    if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) { throw new TypeError(`${name} must be a ${zero ? 'nonnegative' : 'positive'} safe integer`); }
}
function settings(options) {
    if (options.groupCommit !== undefined && (!options.groupCommit || typeof options.groupCommit !== 'object' || Array.isArray(options.groupCommit))) {
        throw new TypeError('groupCommit must be an object');
    }
    const { maxRecords = 64, maxBytes = 1048576, maxDelayMs = 25 } = options.groupCommit ?? {};
    const group = { maxRecords, maxBytes, maxDelayMs };
    const config = { ...group, maxOperations: options.maxOperations ?? 128, maxPendingBytes: options.maxPendingBytes ?? 4194304 };
    Object.entries(config).forEach(([name, value]) => { positive(value, name, name === 'maxDelayMs'); });
    if (config.maxDelayMs > 2147483647) { throw new TypeError('maxDelayMs must be a safe timer duration'); }
    return config;
}
/** Bounded FIFO admission precedes serialization; every reservation includes actual in-flight writes. */
/* eslint max-lines-per-function: ["error", 135], max-statements: ["error", 20] */
export default function deliveryOperations(apply, options = {}) {
    const config = settings(options);
    const jobs = [];
    const state = { operations: 0, bytes: 0, running: false, timer: null, idle: null, wake: null };
    function reserve() {
        if (state.operations >= config.maxOperations) { throw new Error('Delivery operation capacity exceeded'); }
        state.operations += 1;
    }
    function notifyIdle() {
        if (!state.operations && !state.running) { state.wake?.(); Object.assign(state, { idle: null, wake: null }); }
    }
    function release(bytes) { state.operations -= 1; state.bytes -= bytes; notifyIdle(); }
    function settle(job, result) {
        release(job.reservedBytes ?? job.bytes);
        if (result.ok) { job.resolve(result.value); } else { job.reject(result.error); }
    }
    function group() {
        const selected = []; let bytes = 0;
        while (jobs.length && jobs[0].kind === 'mutation' && selected.length < config.maxRecords
            && bytes + jobs[0].bytes <= config.maxBytes) {
            const job = jobs.shift(); selected.push(job); bytes += job.bytes;
        }
        return selected;
    }
    async function executeBarrier() {
        const job = jobs.shift();
        try { const value = await job.action(); settle(job, { ok: true, value }); }
        catch (error) { settle(job, { ok: false, error }); }
    }
    async function executeGroup() {
        const selected = group();
        try {
            const results = await apply(selected.map((job) => { return job.operation; }));
            if (!Array.isArray(results) || results.length !== selected.length
                || results.some((result) => { return typeof result?.ok !== 'boolean'; })) { throw new Error('Invalid grouped mutation result'); }
            selected.forEach((job, index) => { settle(job, results[index]); });
        } catch (error) { selected.forEach((job) => { settle(job, { ok: false, error }); }); }
    }
    async function execute() {
        clearTimeout(state.timer); state.timer = null;
        if (state.running) { return; }
        state.running = true;
        try {
            while (jobs.length) {
                // eslint-disable-next-line no-await-in-loop
                await (jobs[0].kind === 'barrier' ? executeBarrier() : executeGroup());
                // Every group yields so sustained backlog cannot monopolize the event loop.
                // eslint-disable-next-line no-await-in-loop
                if (jobs.length) { await new Promise((resolve) => { setImmediate(resolve); }); }
            }
        } finally { Object.assign(state, { running: false }); notifyIdle(); }
    }
    function schedule(delay) {
        if (state.running) { return; }
        if (state.timer && delay !== 0) { return; }
        clearTimeout(state.timer); state.timer = setTimeout(execute, delay);
    }
    function enqueue(job) {
        return new Promise((resolve, reject) => {
            jobs.push({ ...job, resolve, reject });
            schedule(job.kind === 'barrier' || state.operations >= Math.min(config.maxRecords, config.maxOperations) ? 0 : config.maxDelayMs);
        });
    }
    function checkBytes(bytes, retainedBytes = 0) {
        positive(bytes, 'Mutation bytes', true);
        positive(retainedBytes, 'Retained bytes', true);
        if (state.bytes + bytes + retainedBytes > config.maxPendingBytes) { throw new Error('Delivery pending byte capacity exceeded'); }
        if (bytes > config.maxBytes) { throw new Error('Delivery group byte capacity exceeded'); }
    }
    function prepare(build) {
        reserve();
        let value;
        try {
            value = build(checkBytes); checkBytes(value.bytes, value.retainedBytes);
        } catch (error) { release(0); throw error; }
        const reservedBytes = value.bytes + (value.retainedBytes ?? 0);
        state.bytes += reservedBytes;
        let settled = false;
        return {
            commit() {
                if (settled) { return Promise.reject(new Error('Delivery reservation already settled')); }
                settled = true; return enqueue({ kind: 'mutation', ...value, reservedBytes });
            },
            cancel() { if (!settled) { settled = true; release(reservedBytes); } }
        };
    }
    return {
        prepare,
        mutate(build) {
            try { return prepare(build).commit(); } catch (error) { return Promise.reject(error); }
        },
        barrier(action) {
            try { reserve(); return enqueue({ kind: 'barrier', action, bytes: 0 }); }
            catch (error) { return Promise.reject(error); }
        },
        flush() { if (jobs.length) { schedule(0); } },
        idle() {
            if (!state.operations && !state.running) { return Promise.resolve(); }
            schedule(0);
            state.idle ??= new Promise((resolve) => { state.wake = resolve; });
            return state.idle;
        },
        status() { return { operations: state.operations, bytes: state.bytes }; }
    };
}
