/**
 * SCADA domain objects for industrial plant monitoring.
 * Provides immutable objects for modeling melting operations,
 * alerting systems, and plant hierarchy.
 *
 * @example
 *   import { plant, meltingShop, meltingMachine, meltings, alerts } from 'scada';
 *   const shop = meltingShop(initializedList(machine), meltings());
 *   const p = plant(initializedList(shop));
 */

// Plant hierarchy
export { default as plant } from './src/plant.js';
export { default as meltingShop } from './src/meltingShop.js';
export { default as meltingMachine } from './src/meltingMachine.js';
export { default as monitoredMeltingMachine } from './src/monitoredMeltingMachine.js';

// Melting operations
export { default as activeMelting } from './src/activeMelting.js';
export { default as completedMelting } from './src/completedMelting.js';
export { default as meltings } from './src/meltings.js';

// Rule engine
export { default as meltingRuleEngine } from './src/meltingRuleEngine.js';

// Alerting
export { alert, acknowledgedAlert } from './src/alert.js';
export { default as alerts } from './src/alerts.js';

// Utilities
export { default as interval } from './src/interval.js';
export { default as initializedList } from './src/initializedList.js';
