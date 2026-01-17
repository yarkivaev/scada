/**
 * Melting machine wrapper that monitors measurements and generates alerts.
 * Periodically evaluates sensor readings using a rule engine via chronology.
 *
 * @param {object} machine - the melting machine to monitor
 * @param {object} ruleEngine - engine that evaluates measurements and triggers alerts
 * @param {function} interval - factory to create periodic intervals
 * @returns {object} monitored machine with name, sensors, alerts, chronology, init methods
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
        chronology() {
            return machine.chronology();
        },
        init() {
            interval(1000, async () => {
                const snapshot = await machine.chronology().get({ type: 'current' });
                ruleEngine.evaluate(snapshot);
            }).start();
        }
    };
}
