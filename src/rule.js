/**
 * Unified trigger-action mapping for event processing.
 * Evaluates context and executes action when trigger matches.
 *
 * @param {function} trigger - predicate that receives context and returns boolean
 * @param {function} action - callback executed when trigger returns true
 * @returns {object} rule with evaluate method
 *
 * @example
 *   // Sensor rule - executes on voltage threshold
 *   const r1 = rule(
 *       (ctx) => ctx.sensor && ctx.sensor.voltage < 350,
 *       (ctx) => alerts.trigger('Low voltage')
 *   );
 *
 *   // Event rule - handles labeled events
 *   const r2 = rule(
 *       (ctx) => ctx.event && ctx.event.labels().includes('melting-start'),
 *       (ctx) => meltings.add(ctx.event.properties().machine)
 *   );
 *
 *   r1.evaluate({sensor: {voltage: 340}}); // triggers action
 *   r2.evaluate({event: e}); // triggers action if labels match
 */
export default function rule(trigger, action) {
    return {
        evaluate(context) {
            if (trigger(context)) {
                action(context);
            }
        }
    };
}
