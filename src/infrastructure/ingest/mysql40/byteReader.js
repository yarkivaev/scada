function fail(state, error) {
    state.failure ??= error;
    clearTimeout(state.timer);
    state.pending = Buffer.alloc(0);
    if (state.job) { state.job.reject(state.failure); state.job = null; }
}
function pump(state) {
    if (!state.job || state.pending.length < state.job.need) { return; }
    const current = state.job;
    state.job = null;
    clearTimeout(state.timer);
    const body = state.pending.subarray(0, current.need);
    state.pending = state.pending.subarray(current.need);
    current.resolve(body);
}
function bind(socket, state, maxBytes) {
    socket.on('data', (chunk) => {
        if (state.failure) { return; }
        if (state.pending.length + chunk.length > maxBytes) {
            fail(state, new Error('MySQL 4.0 buffer capacity exceeded'));
            socket.destroy?.();
            return;
        }
        state.pending = Buffer.concat([state.pending, chunk]);
        pump(state);
    });
    socket.on('error', (error) => { fail(state, error); });
    socket.once('end', () => { fail(state, new Error('MySQL 4.0 socket closed')); });
    socket.once('close', () => { fail(state, new Error('MySQL 4.0 socket closed')); });
}
/** Bounded one-packet reader; a failed connection is never reused. */
export default function socketBytes(socket, { maxBytes = 1048576, timeoutMs = 10000 } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new TypeError('Invalid MySQL 4.0 reader limits');
    }
    const state = { pending: Buffer.alloc(0), job: null, failure: null, timer: null };
    bind(socket, state, maxBytes);
    return function take(need) {
        if (state.failure) { return Promise.reject(state.failure); }
        if (state.job) { return Promise.reject(new Error('MySQL 4.0 read is already waiting')); }
        if (!Number.isSafeInteger(need) || need < 0 || need > maxBytes) { return Promise.reject(new Error('MySQL 4.0 packet capacity exceeded')); }
        return new Promise((resolve, reject) => {
            state.job = { need, resolve, reject };
            state.timer = setTimeout(() => {
                fail(state, new Error('MySQL 4.0 read timed out'));
                socket.destroy?.();
            }, timeoutMs);
            pump(state);
        });
    };
}
