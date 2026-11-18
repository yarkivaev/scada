import assert from 'assert';
import { timelineSegmentDestination } from '../../src/application/plantServer.js';

describe('plantServer timeline', function() {
    it('binds the live HMI bus to every routing key on the segment exchange', function() {
        assert.equal(
            timelineSegmentDestination,
            '/exchange/scada.segments/#',
            'HMI STOMP missed HistoryBus segments that shovel already received'
        );
    });
});
