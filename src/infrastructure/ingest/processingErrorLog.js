/**
 * Emits a structured processing error line to stderr.
 *
 * Keeps payloads compact to avoid flooding logs with huge messages.
 *
 * @param {string} stage - Processing stage identifier
 * @param {Error} error - Original processing error
 * @param {object} context - Optional diagnostic context
 */
export default function processingErrorLog(stage, error, context = {}) {
    const safe = {};
    for (const [key, value] of Object.entries(context)) {
        if (typeof value === 'string' && value.length > 500) {
            safe[key] = `${value.slice(0, 500)}...[truncated]`;
        } else {
            safe[key] = value;
        }
    }
    const payload = {
        stage,
        message: error?.message || String(error),
        context: safe
    };
    process.stderr.write(`[supervisor-sink] processing error ${JSON.stringify(payload)}\n`);
}
