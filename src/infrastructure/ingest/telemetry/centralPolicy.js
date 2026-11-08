function keys(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some((key) => { return !allowed.includes(key); })) {
        throw new TypeError('Invalid central telemetry policy');
    }
}
function positive(value, name, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) { throw new TypeError(`Invalid central policy ${name}`); }
    return value;
}
function settings(value, fallback) {
    keys(value, ['deduplicate', 'thinWindowMs', 'topic']);
    if (value.deduplicate !== undefined && value.deduplicate !== true) { throw new TypeError('Enabled central policy requires deduplication'); }
    const window = value.thinWindowMs ?? fallback.thinWindowMs;
    if (!Number.isSafeInteger(window) || window < 0) { throw new TypeError('Invalid thinning window'); }
    return { deduplicate: true, thinWindowMs: window };
}
/** Exact timestamps are first-wins; adaptive thinning preserves all differing values. */
export default function centralPolicy(input = {}) {
    const config = typeof input === 'string' ? JSON.parse(input) : input;
    keys(config, ['enabled', 'default', 'topics', 'queue', 'queueMaxBytes', 'maxPendingBatches', 'batchSize']);
    if (config.enabled !== undefined && typeof config.enabled !== 'boolean') { throw new TypeError('Invalid central policy enabled'); }
    keys(config.default ?? {}, ['deduplicate', 'thinWindowMs']);
    const defaults = settings(config.default ?? {}, { thinWindowMs: 0 });
    if (!Array.isArray(config.topics ?? [])) { throw new TypeError('Invalid central policy topics'); }
    const topics = new Map();
    (config.topics ?? []).forEach((entry) => {
        keys(entry, ['topic', 'deduplicate', 'thinWindowMs']);
        if (typeof entry.topic !== 'string' || !entry.topic || entry.topic.length > 1024
            // eslint-disable-next-line no-control-regex
            || /[\s\u0000-\u001f\u007f#+*]/u.test(entry.topic) || topics.has(entry.topic)) {
            throw new TypeError('Invalid or duplicate central policy topic');
        }
        topics.set(entry.topic, settings(entry, defaults));
    });
    const queue = config.queue ?? 'scada.telemetry.canonical';
    if (typeof queue !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(queue) || queue.startsWith('amq.')) {
        throw new TypeError('Invalid central policy queue');
    }
    return { enabled: config.enabled === true, queue, forTopic(topic) { return topics.get(topic) ?? defaults; },
        queueMaxBytes: positive(config.queueMaxBytes ?? 1073741824, 'queue bytes'),
        maxPendingBatches: positive(config.maxPendingBatches ?? 100000, 'pending batches', 2147483647),
        batchSize: positive(config.batchSize ?? 500, 'batch size', 1000) };
}
