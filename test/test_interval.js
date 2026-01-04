import assert from 'assert';
import interval from '../src/interval.js';

describe('interval', function() {
    it('returns object with start method', function() {
        const timer = interval(10, function() {});
        assert(typeof timer.start === 'function');
    });

    it('calls action when interval fires', function(done) {
        this.timeout(100);
        let called = false;
        interval(10, function() {
            if (!called) {
                called = true;
                done();
            }
        }).start();
    });

    it('calls action multiple times', function(done) {
        this.timeout(100);
        let count = 0;
        let finished = false;
        interval(10, function() {
            if (!finished) {
                count += 1;
                if (count >= 2) {
                    finished = true;
                    done();
                }
            }
        }).start();
    });
});
