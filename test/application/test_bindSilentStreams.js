import assert from 'assert';
import bindSilentStreams from '../../src/application/bindSilentStreams.js';

describe('bindSilentStreams', function() {
    it('returns undefined when streams are omitted', function() {
        const sink = { write() {} };
        assert.strictEqual(
            bindSilentStreams(undefined, sink),
            undefined,
            'bindSilentStreams invented an onSeen without streams'
        );
    });

    it('forwards onSeen names into streams.seen', function() {
        const name = `icht-${Math.random().toString(36).slice(2)}`;
        const seen = [];
        const streams = {
            bind() {},
            seen(label) {
                seen.push(label);
            }
        };
        const onSeen = bindSilentStreams(streams, { write() {} });
        onSeen(name);
        assert.deepStrictEqual(seen, [name], 'onSeen did not forward the stream name');
    });

    it('binds the metrics sink before returning onSeen', function() {
        const sink = { id: Math.random().toString(36).slice(2), write() {} };
        let bound;
        const streams = {
            bind(target) {
                bound = target;
            },
            seen() {}
        };
        bindSilentStreams(streams, sink);
        assert.strictEqual(bound, sink, 'silent streams were not bound to the metrics sink');
    });
});
