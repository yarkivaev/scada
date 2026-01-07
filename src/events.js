/**
 * Simple event emitter for pub/sub pattern.
 * Provides emit() to publish events and stream() to subscribe.
 * Abstraction point for future message broker integration.
 *
 * @returns {object} emitter with emit() and stream() methods
 *
 * @example
 *   const bus = events();
 *   const sub = bus.stream((e) => console.log(e));
 *   bus.emit({ type: 'created', data: {...} });
 *   sub.cancel();
 */
export default function events() {
    const subscribers = [];
    return {
        emit(event) {
            subscribers.forEach((cb) => {
                cb(event);
            });
        },
        stream(callback) {
            subscribers.push(callback);
            return {
                cancel() {
                    const index = subscribers.indexOf(callback);
                    subscribers.splice(index, 1);
                }
            };
        }
    };
}
