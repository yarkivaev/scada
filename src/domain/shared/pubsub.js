/**
 * Simple publish-subscribe mechanism for event distribution.
 * Provides emit() to publish and stream() to subscribe.
 *
 * @returns {object} bus with emit() and stream() methods
 *
 * @example
 *   const bus = pubsub();
 *   const sub = bus.stream((evt) => console.log(evt));
 *   bus.emit({ type: 'created', data: {} });
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
