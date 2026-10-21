import assert from 'assert';
import pubsub from '../../../../src/domain/shared/pubsub.js';
import stompTimelineSegments from '../../../../src/infrastructure/messaging/stomp/stompTimelineSegments.js';

function fakeStomp(ref) {
    return {
        ref,
        factory(collector) {
            ref.collector = collector;
            return {
                start() {},
                stop() {
                    ref.stopped = true;
                }
            };
        }
    };
}

describe('stompTimelineSegments', function() {
    it('emits created segment event on matching machine bus', function() {
        const stomp = fakeStomp({ collector: null, events: [] });
        const machine = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const start = Date.now() + Math.floor(Math.random() * 1e6);
        const bus = pubsub();
        bus.stream((event) => {
            stomp.ref.events.push(event);
        });
        stompTimelineSegments(stomp.factory, { [machine]: bus });
        stomp.ref.collector.accept({
            payload: JSON.stringify({
                name: 'on',
                machine,
                status: 'pending',
                start,
                end: start,
                duration: 0
            })
        });
        assert.strictEqual(stomp.ref.events.length, 1, 'segment message was not emitted on timeline bus');
    });
    it('omits tags field when supervisor payload tags are null', function() {
        const stomp = fakeStomp({ collector: null, events: [] });
        const machine = `m${Math.floor(Math.random() * 9000 + 1000)}`;
        const start = Date.now() + Math.floor(Math.random() * 1e6);
        const bus = pubsub();
        bus.stream((event) => {
            stomp.ref.events.push(event);
        });
        stompTimelineSegments(stomp.factory, { [machine]: bus });
        stomp.ref.collector.accept({
            payload: JSON.stringify({
                name: 'on',
                machine,
                status: 'pending',
                start,
                end: start,
                duration: 0,
                tags: null
            })
        });
        assert.strictEqual(stomp.ref.events[0].segment.tags, undefined, 'null supervisor tags were serialized as string null');
    });
    it('emits one created event per piece of a split family', function() {
        const stomp = fakeStomp({ collector: null, events: [] });
        const machine = `печь-${Math.floor(Math.random() * 9000 + 1000)}`;
        const start = Date.now() + Math.floor(Math.random() * 1e6);
        const bus = pubsub();
        bus.stream((event) => {
            stomp.ref.events.push(event);
        });
        stompTimelineSegments(stomp.factory, { [machine]: bus });
        stomp.ref.collector.accept({
            payload: JSON.stringify({
                type: 'split-family',
                machine,
                origin: start,
                pieces: [
                    { name: 'off', start, end: start + 60000, duration: 60, tags: ['additive_loading'] },
                    { name: 'off', start: start + 60000, end: start + 120000, duration: 60, tags: null }
                ]
            })
        });
        assert.strictEqual(stomp.ref.events.length, 2, 'split-family crashed the timeline instead of emitting both pieces');
    });
});
