import assert from 'assert';

/**
 * Asserts actual value matches a Hamcrest-style matcher result.
 *
 * @param {*} actual - value under test
 * @param {function} matcher - matcher factory returning { pass, message }
 *
 * @example
 *   assertThat(sseText, hasSegmentCreatedOnOpenStream());
 */
export function assertThat(actual, matcher) {
    const result = matcher(actual);
    assert.ok(result.pass, result.message);
}

/**
 * Matcher for SSE text after supervisor persist on an open segment stream.
 *
 * @returns {function} matcher expecting heartbeat and segment_created events
 *
 * @example
 *   assertThat(text, hasSegmentCreatedOnOpenStream());
 */
export function hasSegmentCreatedOnOpenStream() {
    return (sseText) => {
        const open = sseText.includes('event: heartbeat\n');
        const created = sseText.includes('event: segment_created\n');
        if (open && created) {
            return { pass: true };
        }
        if (!open) {
            return {
                pass: false,
                message: 'segment stream did not emit heartbeat before supervisor persist'
            };
        }
        return {
            pass: false,
            message: 'open segment stream did not emit segment_created after supervisor persist'
        };
    };
}

/**
 * Matcher for SSE text after operations upsert on an open stream.
 *
 * @returns {function} matcher expecting heartbeat and operation_created events
 *
 * @example
 *   assertThat(text, hasOperationCreatedOnOpenStream());
 */
export function hasOperationCreatedOnOpenStream() {
    return (sseText) => {
        const open = sseText.includes('event: heartbeat\n');
        const created = sseText.includes('event: operation_created\n');
        if (open && created) {
            return { pass: true };
        }
        if (!open) {
            return {
                pass: false,
                message: 'operation stream did not emit heartbeat before upsert'
            };
        }
        return {
            pass: false,
            message: 'open operation stream did not emit operation_created after upsert'
        };
    };
}
