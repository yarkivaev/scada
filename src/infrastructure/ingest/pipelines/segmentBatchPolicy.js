const defaults = { enabled: true, maxMessages: 32, maxBytes: 1048576, maxWaitMs: 100,
    completedSegments: 1, concurrency: 2, timeoutMs: 10000, statsIntervalMs: 10000 };

function checkLimits(policy) {
    for (const key of ['maxMessages', 'maxBytes', 'maxWaitMs', 'concurrency', 'timeoutMs', 'completedSegments', 'statsIntervalMs']) {
        const minimum = ['completedSegments', 'statsIntervalMs'].includes(key) ? 0 : 1;
        if (!Number.isSafeInteger(policy[key]) || policy[key] < minimum) { throw new TypeError(`${key} must be a bounded integer >= ${minimum}`); }
    }
    for (const key of ['maxWaitMs', 'timeoutMs', 'statsIntervalMs']) {
        if (policy[key] > 2147483647) { throw new TypeError(`${key} exceeds the timer limit`); }
    }
}

/** Finite batch limits shared by environment loading and direct collector composition. */
export default function segmentBatchPolicy(input = {}) {
    const unknown = Object.keys(input).find(key => { return !Object.hasOwn(defaults, key); });
    if (unknown) { throw new TypeError(`Unknown segment transaction setting: ${unknown}`); }
    const policy = { ...defaults, ...input };
    if (typeof policy.enabled !== 'boolean') { throw new TypeError('enabled must be a boolean'); }
    if (!policy.enabled) { return { enabled: false }; }
    checkLimits(policy);
    return policy;
}
