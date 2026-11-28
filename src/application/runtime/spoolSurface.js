/**
 * Mounts SupervisorSinkCheckpoint and HistoryRun routes on the collector health port.
 *
 * {{{
 * spoolSurface(queue, token)
 * }}}
 */

import { routes } from '@yarkivaev/simple-server';
import checkpointRoutes from '../../infrastructure/http/edge/routes/checkpoint/checkpointRoutes.js';
import historyRoutes from '../../infrastructure/http/edge/routes/history/historyRoutes.js';
import spoolHistory from './spoolHistory.js';

/** True when the request was a spool history or checkpoint path. */
export default function spoolSurface(queue, token, locate) {
    if (!queue) { return null; }
    const history = spoolHistory(queue, locate);
    const api = routes([...checkpointRoutes(token ?? null, history), ...historyRoutes(token ?? null, history)]);
    return (request, result) => {
        if (!request.url?.startsWith('/v1/')) { return false; }
        void api.handle(request, result);
        return true;
    };
}
