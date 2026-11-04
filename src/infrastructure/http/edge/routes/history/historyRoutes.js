import { errorResponse, jsonResponse, readBody, route } from '@yarkivaev/simple-server';
import { hasAccess, sendForbidden } from '../../stateAccess.js';

function endpoint(method, suffix, token, action) {
    // eslint-disable-next-line max-statements
    return route(method, `/v1/history/${suffix}`, async (req, res, params, query) => {
        if (!hasAccess(req, token)) { sendForbidden(res); return; }
        let input;
        try {
            input = method === 'GET' ? query : JSON.parse(await readBody(req));
            if (typeof input.machine !== 'string' || !input.machine) { throw new TypeError('machine required'); }
        } catch (error) { errorResponse('BAD_REQUEST', error.message, 400).send(res); return; }
        try { jsonResponse(await action(input)).send(res); } catch (error) {
            if (error.statusCode === 409) { errorResponse('CONFLICT', error.message, 409).send(res); return; }
            if (error instanceof TypeError) { errorResponse('BAD_REQUEST', error.message, 400).send(res); return; }
            throw error;
        }
    });
}
/** Uses the existing checkpoint API authentication and persistence lifecycle. */
export default function historyRoutes(token, history) {
    if (!history) { return []; }
    return [
        endpoint('POST', 'purge', token, () => { return history.purge(); }),
        endpoint('POST', 'observations', token, (input) => { return history.accept(input.machine, input.observations); }),
        endpoint('GET', 'work', token, (input) => { return history.work(input.machine); }),
        endpoint('GET', 'context', token, (input) => {
            return history.context(input.machine, Number(input.from), Number(input.until), input.paddingMs === undefined ? 60000 : Number(input.paddingMs));
        }),
        endpoint('POST', 'commit', token, (input) => { return history.commit(input.machine, input.workId, input.segments, input.context); })
    ];
}
