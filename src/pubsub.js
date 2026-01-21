/**
 * Simple publish-subscribe mechanism for event distribution.
 * Provides emit() to publish and stream() to subscribe.
 * Abstraction point for future message broker integration.
 *
 * @returns {object} bus with emit() and stream() methods
 *
 * @example
 *   const bus = pubsub();
 *   const sub = bus.stream((e) => console.log(e));
 *   bus.emit({ type: 'created', data: {...} });
 *   sub.cancel();
 */
export default function pubsub() {
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
