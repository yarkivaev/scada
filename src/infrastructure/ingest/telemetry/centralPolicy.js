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
const ruleDefaults = { compactWindowMs: 60000, historyWindowMs: 604800000, maxHistoryAgeMs: 2592000000, futureSkewMs: 300000, maxGapMs: 30000 };
export const CENTRAL_RULE_FIELDS = Object.keys(ruleDefaults);
export function centralRule(value, fallback = ruleDefaults) {
    keys(value, [...CENTRAL_RULE_FIELDS, 'topic']);
    const rule = Object.fromEntries(CENTRAL_RULE_FIELDS.map((key) => { return [key, value[key] === undefined ? fallback[key] : value[key]]; }));
    for (const [key, number] of Object.entries(rule)) {
        let minimum = Math.max(1, rule.compactWindowMs);
        if (key === 'maxGapMs') { minimum = 1; }
        if (['compactWindowMs', 'futureSkewMs'].includes(key)) { minimum = 0; }
        const maximum = key === 'compactWindowMs' ? 3600000 : Number.MAX_SAFE_INTEGER;
        if (!Number.isSafeInteger(number) || number < minimum || number > maximum) { throw new TypeError(`Invalid central policy ${key}`); }
    }
    return rule;
}
/** Native point storage with a bounded immutable archive. */
export default function centralPolicy(input = {}) {
    const config = typeof input === 'string' ? JSON.parse(input) : input;
    keys(config, ['enabled', 'default', 'topics', 'queue', 'queueMaxBytes', 'maxPendingBatches', 'batchSize']);
    if (config.enabled !== undefined && typeof config.enabled !== 'boolean') { throw new TypeError('Invalid central policy enabled'); }
    keys(config.default ?? {}, CENTRAL_RULE_FIELDS);
    const defaults = centralRule(config.default ?? {});
    if (!Array.isArray(config.topics ?? [])) { throw new TypeError('Invalid central policy topics'); }
    const topics = new Map();
    (config.topics ?? []).forEach((entry) => {
        keys(entry, ['topic', ...CENTRAL_RULE_FIELDS]);
        if (typeof entry.topic !== 'string' || !entry.topic || entry.topic.length > 1024
            // eslint-disable-next-line no-control-regex
            || /[\s\u0000-\u001f\u007f#+*]/u.test(entry.topic) || topics.has(entry.topic)) {
            throw new TypeError('Invalid or duplicate central policy topic');
        }
        topics.set(entry.topic, centralRule(entry, defaults));
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
