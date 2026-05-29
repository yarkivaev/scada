/**
 * SCADA Server JS Client.
 * Provides typed methods for all API endpoints.
 *
 * @example
 *   import { scadaClient } from 'scada-server/client';
 *   const client = scadaClient('http://localhost:3000/api/v1', fetch, EventSource);
 */

export { default as machineClient } from './machineClient.js';
export { default as scadaClient } from './scadaClient.js';
export { default as sseConnection } from './sseConnection.js';
