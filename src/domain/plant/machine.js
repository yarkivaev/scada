/**
 * Generic monitored machine with sensors, timeline, and alerts.
 *
 * @param {string} name - unique machine identifier
 * @param {object} deps - machine dependencies
 * @param {object} deps.sensors - sensor instances keyed by name
 * @param {object} deps.alerts - shop-level alerts collection
 * @param {object} deps.timeline - timeline port with list, retag, pending, respond, stream
 * @returns {object} machine with name, sensors, timeline, alerts methods
 *
 * @example
 *   const m = machine('m1', { sensors: { voltage }, alerts: history, timeline: tl });
 *   m.name();
 */
export default function machine(name, deps) {
    const { sensors, alerts: alertHistory, timeline: tl } = deps;
    return {
        name() {
            return name;
        },
        sensors,
        timeline: tl,
        alerts() {
            return alertHistory.all((item) => {
                return item.object === name;
            });
        },
        init() {
            return this;
        }
    };
}
