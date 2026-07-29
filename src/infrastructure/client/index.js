/**
 * SCADA Server JS Client.
 * Provides typed methods for all API endpoints.
 *
 * Export ports (Query/Stream/Sink/Job) are also re-exported for callers that
 * depend on `scada/client` only; destination adapters stay in plant packages.
 *
 * @example
 *   import { scadaClient, exportQuery, exportJob } from 'scada/client';
 *   const client = scadaClient('http://localhost:3000/api/v1', fetch, EventSource);
 *   const query = exportQuery(client);
 */

export { default as machineClient } from './machineClient.js';
export { default as scadaClient } from './scadaClient.js';
export { default as sseConnection } from './sseConnection.js';
export { default as exportQuery } from '../../application/export/exportQuery.js';
export { default as exportStream } from '../../application/export/exportStream.js';
export { default as exportSink } from '../../application/export/exportSink.js';
export { default as exportJob } from '../../application/export/exportJob.js';
