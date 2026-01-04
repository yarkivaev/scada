/**
 * Melting machine that tracks metal weight and sensor measurements.
 * Supports loading and dispensing metal during melting operations.
 *
 * @param {string} name - unique machine identifier
 * @param {object} voltageSensor - sensor providing voltage measurements
 * @param {object} cosphiSensor - sensor providing power factor measurements
 * @param {object} alerts - centralized alerts collection
 * @returns {object} machine with name, measurements, alerts, weight, load, dispense
 *
 * @example
 *   const machine = meltingMachine('icht1', voltageSensor(), cosphiSensor(), alerts());
 *   machine.load(500);
 *   machine.weight(); // 500
 *   machine.dispense(480);
 *   machine.weight(); // 20
 */
export default function meltingMachine(
    name, voltageSensor, cosphiSensor, alerts
) {
    let weight = 0;
    return {
        name() {
            return name;
        },
        measurements(range) {
            return {
                voltage: voltageSensor.measurements(range),
                cosphi: cosphiSensor.measurements(range)
            };
        },
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
