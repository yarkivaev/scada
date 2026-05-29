/**
 * SSE connection wrapper with event callbacks.
 * Returns immutable object with on() and close() methods.
 *
 * @param {string} url - SSE endpoint URL
 * @param {function} eventSource - EventSource constructor (for testing)
 * @param {object} [logger] - optional logger with error(tag, detail)
 * @returns {object} connection with on, close methods
 *
 * @example
 *   const conn = sseConnection(url, EventSource, logger);
 *   conn.on('measurement', data => console.log(data));
 *   conn.close();
 */
export default function sseConnection(url, EventSourceCtor, logger) {
    const source = new EventSourceCtor(url);
    if (logger && typeof logger.error === 'function') {
        source.onerror = function onerror() {
            logger.error('sse.connection', { url });
        };
    }
    return {
        on(event, notify) {
            source.addEventListener(event, (ev) => {
                let payload;
                try {
                    payload = JSON.parse(ev.data);
                } catch (cause) {
                    if (logger && typeof logger.error === 'function') {
                        logger.error('sse.parse', { url, event, cause });
                    }
                    return;
                }
                notify(payload);
            });
            return this;
        },
        close() {
            source.close();
        }
    };
}
