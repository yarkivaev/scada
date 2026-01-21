/**
 * Collection of rules with unified evaluation.
 * Evaluates all rules against provided context.
 *
 * @param {object[]} list - array of rule objects with evaluate method
 * @returns {object} rules collection with evaluate and all methods
 *
 * @example
 *   const rs = rules([rule1, rule2, rule3]);
 *   rs.evaluate({sensor: {voltage: 340}}); // evaluates all rules
 *   rs.evaluate({event: e}); // evaluates all rules against event
 *   rs.all(); // returns array of all rules
 */
export default function rules(list) {
    return {
        evaluate(context) {
            list.forEach((item) => {
                item.evaluate(context);
            });
        },
        all: () => {return [...list]}
    };
}
