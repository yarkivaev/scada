import { errorResponse, jsonResponse, readBody, route } from '@yarkivaev/simple-server';
import { historyReplicaProtocol } from '../../../../persistence/pg/historyReplicaOutbox.js';
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
            if (error.statusCode === 409) { errorResponse(error.writeCode ?? 'CONFLICT', error.message, 409).send(res); return; }
            if (error instanceof TypeError) { errorResponse('BAD_REQUEST', error.message, 400).send(res); return; }
            throw error;
        }
    });
}
/** Uses the existing checkpoint API authentication and persistence lifecycle. */
export default function historyRoutes(token, history, liveSegments) {
    const live = liveSegments ? [
        endpoint('GET', 'live-revision', token, input => {return liveSegments.revision(input.machine)}),
        endpoint('POST', 'live-apply', token, input => {return liveSegments.apply(input)}),
        ...(liveSegments.applyOutbox ? [endpoint('POST', 'live-apply-outbox', token, input => {
            const {replication,...segment} = input;
            return liveSegments.applyOutbox(segment,replication);
        })] : [])
    ] : [];
    if (!history) { return live; }
    return [
        ...live,
        endpoint('POST', 'config', token, (input) => { return history.configure(input.machine, input.topics, input.bucketMs, input.classifierKey); }),
        endpoint('POST', 'purge', token, () => { return history.purge(); }),
        endpoint('POST', 'observations', token, (input) => { return history.accept(input.machine, input.observations); }),
        endpoint('GET', 'work', token, (input) => { return history.work(input.machine); }),
        endpoint('GET', 'context', token, (input) => {
            return history.context(input.machine, Number(input.from), Number(input.until), input.paddingMs === undefined ? 60000 : Number(input.paddingMs), {classifierKey:input.classifierKey,workId:input.workId,workToken:input.workToken,cursor:input.cursor === undefined ? null : Number(input.cursor),end:input.end === undefined ? null : Number(input.end)});
        }),
        endpoint('POST', 'commit', token, (input) => {
            if (input.context?.replication !== undefined) { throw new TypeError('Use the history outbox endpoint'); }
            return history.commit(input.machine, input.workId, input.segments, input.context);
        }),
        ...(history.commitOutbox ? [
            endpoint('POST', 'commit-outbox', token, input => {
                return history.commitOutbox(input.machine, input.workId, input.segments, input.context,
                    {...input.replication,protocol:undefined});
            }),
            endpoint('POST', 'commit-outbox-v2', token, input => {
                return history.commitOutbox(input.machine, input.workId, input.segments, input.context,
                    {...input.replication,protocol:historyReplicaProtocol});
            })
        ] : [])
    ];
}
