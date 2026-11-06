import deadline from '../../streams/deadline.js';

function release(token, destroy = false) {
    if (token.client && !token.released) {
        token.released = true;
        if (token.onError) { token.client.removeListener?.('error', token.onError); }
        token.client.release(destroy);
    }
}
function permanent(error) {
    return error.permanent === true || error instanceof RangeError || /^(?:22|23)/u.test(error.code ?? '');
}
async function prepare(pool, state, token) {
    token.client = await pool.connect();
    if (token.cancelled || state.stopped) { throw state.failure ?? new Error('Segment transaction stopped'); }
    token.onError = error => { state.fail(error); };
    token.client.on?.('error', token.onError);
    await token.runner.query('BEGIN');
    await token.runner.query("SELECT set_config('statement_timeout', $1, true)", [String(state.timeoutMs)]);
}
async function rollback(token) {
    if (!token.client || token.cancelled) { return false; }
    try { await token.runner.query('ROLLBACK');return true; }
    catch {
        // Unknown transaction outcome: the owner fences and destroys the connection.
        return false;
    }
}
async function apply(dispatch, records, token) {
    for (const record of records) {
        // eslint-disable-next-line no-await-in-loop
        await dispatch.accept(record, token.runner);
    }
}
async function execute(pool, dispatch, records, state, token) {
    let phase = 'prepare';
    try {
        await prepare(pool, state, token);
        phase = 'apply';await apply(dispatch, records, token);
        phase = 'commit';await token.runner.query('COMMIT');
        return { sqlCalls: token.calls };
    } catch (error) {
        const confirmed = await rollback(token);
        if (confirmed && phase !== 'prepare' && permanent(error)) { error.permanent = true; }
        else if (!state.stopped && !token.cancelled) { state.fail(error); }
        throw error;
    } finally {
        state.active.delete(token);
        release(token, token.cancelled || state.stopped);
    }
}

/** Owns one durable transaction per batch, including late-connect and timeout fencing. */
export default function segmentTransaction(pool, dispatch, { timeoutMs = 10000, onFatal } = {}) {
    const state = { stopped: false, failure: null, active: new Set(), timeoutMs,
        fail(error) {
            if (state.failure || state.stopped) { return; }
            state.failure = error;onFatal?.(error);
        } };
    return {
        write(records) {
            if (state.stopped || state.failure) { return Promise.reject(state.failure ?? new Error('Segment transaction stopped')); }
            const token = { client: null, released: false, cancelled: false, calls: 0 };
            token.runner = { query(...args) { token.calls += 1;return token.client.query(...args); } };
            state.active.add(token);
            return deadline(execute(pool, dispatch, records, state, token), timeoutMs, 'Segment transaction', error => {
                token.cancelled = true;
                try { release(token, true); } finally { state.fail(error); }
            });
        },
        abort(error = new Error('Segment transaction stopped')) {
            state.stopped = true;state.failure ??= error;
            for (const token of state.active) { token.cancelled = true;release(token, true); }
        }
    };
}
