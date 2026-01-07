/**
 * Melting machine that tracks metal weight and sensor measurements.
 * Supports loading and dispensing metal during melting operations.
 *
 * @param {string} name - unique machine identifier
 * @param {object} sensors - object containing sensor instances
 * @param {object} alerts - centralized alerts collection
 * @returns {object} machine with name, sensors, alerts, weight, load, dispense
 *
 * @example
 *   const machine = meltingMachine('icht1', { voltage: voltageSensor(), cosphi: cosphiSensor() }, alerts());
 *   machine.sensors.voltage.measurements(range);
 *   machine.load(500);
 *   machine.weight(); // 500
 */
export default function meltingMachine(name, sensors, alerts) {
    let weight = 0;
    return {
        name() {
            return name;
        },
        sensors,
        alerts() {
            return alerts.all((item) => {
                return item.object === name;
            });
        },
        weight() {
            return weight;
        },
        load(w) {
            weight += w;
        },
        dispense(w) {
            weight -= w;
        }
    };
}
