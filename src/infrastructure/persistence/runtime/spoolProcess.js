import { fork } from 'node:child_process';
import spoolLimits from './spoolLimits.js';

function remoteError({ name, message, code }) {
    const error = name === 'TypeError' ? new TypeError(message) : new Error(message);
    error.name = name;
    if (code !== undefined) { error.code = code; }
    return error;
}

/* eslint max-lines-per-function: ["error", 90], max-statements: ["error", 24] */
export default function spoolProcess(directory, options) {
    const limits = spoolLimits(options);
    const state = {
        child: null, stopped: null, pending: null,
        status: { bytes: 0, maxBytes: limits.maxBytes, recordLimit: limits.maxRecords, pending: 0, ready: false }
    };
    function unavailable(error = new Error('Delivery spool process disconnected')) {
        state.status.ready = false;
        const { pending } = state;
        state.pending = null;
        pending?.reject(error);
    }
    function receive({ status, value, error }) {
        const { pending } = state;
        state.pending = null;
        state.status = status;
        if (error) { pending?.reject(remoteError(error)); }
        else { pending?.resolve(value); }
    }
    function start() {
        const child = fork(new URL('./spoolProcessChild.js', import.meta.url), [directory, JSON.stringify(limits)], {
            serialization: 'advanced', execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc']
        });
        state.child = child;
        state.stopped = new Promise(resolve => {
            function stopped() { unavailable(); state.child = null; resolve(); }
            child.once('exit', stopped);
            child.on('error', error => {
                unavailable(error);
                if (!child.pid) { stopped(); }
            });
        });
        child.once('disconnect', () => { unavailable(); });
        child.on('message', receive);
    }
    function call(method, ...args) {
        if (!state.child?.connected) { return Promise.reject(new Error('Delivery spool process disconnected')); }
        if (state.pending) { return Promise.reject(new Error('Spool operation in progress')); }
        return new Promise((resolve, reject) => {
            const pending = { resolve, reject };
            state.pending = pending;
            state.child.send({ method, args }, error => {
                if (error && state.pending === pending) {
                    unavailable(error);
                    if (state.child?.connected) { state.child.disconnect(); }
                }
            });
        });
    }
    return {
        async open() {
            // The previous process must release its file lock before ownership can be reacquired.
            if (state.child && !state.child.connected) { await state.stopped; }
            if (!state.child) { start(); }
            return call('open');
        },
        async mutateMany(operations) {
            const result = await call('mutateMany', operations);
            return result.map(item => { return item.ok ? item : { ...item, error: remoteError(item.error) }; });
        },
        pendingFair(limit, blocked) { return call('pendingFair', limit, [...blocked]); },
        peek(limit) { return call('peek', limit); },
        async close() {
            if (!state.child) { return; }
            try {
                if (state.child.connected) { await call('close'); }
            } finally {
                if (state.child?.connected) { state.child.disconnect(); }
                await state.stopped;
            }
        },
        status() { return { ...state.status }; }
    };
}
