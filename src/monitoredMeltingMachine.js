/**
 * Melting machine wrapper that monitors measurements and generates alerts.
 * Periodically evaluates measurements using a rule engine.
 *
 * @param {object} machine - the melting machine to monitor
 * @param {object} ruleEngine - engine that evaluates measurements and triggers alerts
 * @param {function} interval - factory to create periodic intervals
 * @returns {object} monitored machine with name, sensors, alerts, init methods
 *
 * @example
 *   const monitored = monitoredMeltingMachine(machine, ruleEngine(), interval);
 *   monitored.init(); // starts periodic monitoring
 */
export default function monitoredMeltingMachine(machine, ruleEngine, interval) {
    return {
        name() {
            return machine.name();
        },
        sensors: machine.sensors,
        alerts() {
            return machine.alerts();
        },
        init() {
            interval(1000, () => {
                const now = new Date();
                const range = {
                    start: new Date(now.getTime() - 1000),
                    end: now
                };
                const snapshot = {};
                Object.keys(machine.sensors).forEach((key) => {
                    snapshot[key] = machine.sensors[key].measurements(range);
                });
                ruleEngine.evaluate(snapshot);
            }).start();
        }
    };
}
