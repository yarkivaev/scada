/**
 * Expert system that evaluates measurements and issues alerts.
 * Checks voltage and power factor thresholds.
 *
 * @param {function} issue - callback to issue alerts with message and timestamp
 * @returns {object} rule engine with evaluate method
 *
 * @example
 *   const engine = meltingRuleEngine(function(msg, ts) { console.log(msg); });
 *   engine.evaluate({ voltage: { value: 340 }, cosphi: { value: 0.9 } });
 */
export default function meltingRuleEngine(issue) {
    return {
        evaluate(snapshot) {
            const timestamp = new Date();
            const {voltage} = snapshot;
            const {cosphi} = snapshot;
            if (voltage && voltage.value < 350) {
                issue(`Critical low voltage: ${  voltage.value.toFixed(1)  }V`, timestamp);
            } else if (voltage && voltage.value < 360) {
                issue(`Low voltage: ${  voltage.value.toFixed(1)  }V`, timestamp);
            } else if (voltage && voltage.value > 410) {
                issue(`Critical high voltage: ${  voltage.value.toFixed(1)  }V`, timestamp);
            } else if (voltage && voltage.value > 400) {
                issue(`High voltage: ${  voltage.value.toFixed(1)  }V`, timestamp);
            }
            if (cosphi && cosphi.value < 0.7) {
                issue(`Critical low power factor: ${  cosphi.value.toFixed(2)}`, timestamp);
            } else if (cosphi && cosphi.value < 0.8) {
                issue(`Low power factor: ${  cosphi.value.toFixed(2)}`, timestamp);
            }
            if (voltage && cosphi && voltage.value < 370 && cosphi.value < 0.8) {
                issue('Power quality issue detected', timestamp);
            }
        }
    };
}
