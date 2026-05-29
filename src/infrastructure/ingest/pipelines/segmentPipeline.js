import {
    postgresSink,
    stompSource
} from '@yarkivaev/source-to-sink';
import segmentDispatch from '../../../domain/segment/dispatch.js';
import segmentCodec from '../codecs/segmentCodec.js';
import retagSink from '../sinks/retagSink.js';

export const segmentColumns = ['machine', 'name', 'start_time', 'end_time', 'duration',
                               'options', 'tags', 'properties', 'resolved'];
export const segmentConflict = ['machine', 'start_time'];
export const segmentUpdateColumns = ['name', 'end_time', 'duration', 'options', 'resolved'];
export const splitUpdateColumns = ['name', 'end_time', 'duration', 'tags', 'options', 'resolved'];

export { default as segmentDispatch } from '../../../domain/segment/dispatch.js';

/**
 * Pipeline for streaming STOMP segment data to PostgreSQL segments table.
 *
 * @param {string} stomp - STOMP broker URL
 * @param {string} postgres - PostgreSQL connection URL
 * @param {object} pool - pg pool
 * @param {object} config - Pipeline configuration
 * @returns {object} Pipeline with start() and stop() methods
 */
export default function segmentPipeline(stomp, postgres, pool, config) {
    const segmentSink = postgresSink(postgres, 'segments', segmentColumns,
        { conflict: segmentConflict, update: segmentUpdateColumns });
    const splitSink = postgresSink(postgres, 'segments', segmentColumns,
        { conflict: segmentConflict, update: splitUpdateColumns });
    const retag = retagSink(pool);
    const dispatch = segmentDispatch(segmentSink, retag, splitSink);
    const codec = segmentCodec(dispatch);
    const source = stompSource(stomp, '/exchange/scada.segments', codec,
        { login: config.login, passcode: config.passcode, host: config.host });
    return {
        start() {
            source.start();
        },
        stop() {
            source.stop();
            pool.end();
        }
    };
}
