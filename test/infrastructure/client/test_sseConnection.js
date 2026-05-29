import assert from 'assert';
import sseConnection from '../../../src/infrastructure/client/sseConnection.js';

describe('sseConnection', function() {
    it('returns object with on method', function() {
        const FakeEventSource = function(url) {
            this.url = url;
            this.addEventListener = () => {};
            this.close = () => {};
        };
        const conn = sseConnection('http://test.com/stream', FakeEventSource);
        assert(typeof conn.on === 'function');
    });

    it('returns object with close method', function() {
        const FakeEventSource = function(url) {
            this.url = url;
            this.addEventListener = () => {};
            this.close = () => {};
        };
        const conn = sseConnection('http://test.com/stream', FakeEventSource);
        assert(typeof conn.close === 'function');
    });

    it('creates EventSource with url', function() {
        let receivedUrl;
        const FakeEventSource = function(url) {
            receivedUrl = url;
            this.addEventListener = () => {};
            this.close = () => {};
        };
        sseConnection('http://test.com/stream', FakeEventSource);
        assert(receivedUrl === 'http://test.com/stream');
    });

    it('adds event listener on call to on', function() {
        let addedEvent;
        const FakeEventSource = function() {
            this.addEventListener = (event) => {
                addedEvent = event;
            };
            this.close = () => {};
        };
        const conn = sseConnection('http://test.com/stream', FakeEventSource);
        conn.on('measurement', () => {});
        assert(addedEvent === 'measurement');
    });

    it('returns self from on for chaining', function() {
        const FakeEventSource = function() {
            this.addEventListener = () => {};
            this.close = () => {};
        };
        const conn = sseConnection('http://test.com/stream', FakeEventSource);
        const result = conn.on('measurement', () => {});
        assert(result === conn);
    });

    it('calls notify with parsed JSON on event', function() {
        let listener;
        let received;
        const FakeEventSource = function() {
            this.addEventListener = (event, fn) => {
                listener = fn;
            };
            this.close = () => {};
        };
        const conn = sseConnection('http://test.com/stream', FakeEventSource);
        conn.on('measurement', (payload) => {
            received = payload;
        });
        listener({ data: '{"key":"voltage","value":380}' });
        assert(received.key === 'voltage' && received.value === 380);
    });

    it('closes EventSource on close', function() {
        let closed = false;
        const FakeEventSource = function() {
            this.addEventListener = () => {};
            this.close = () => {
                closed = true;
            };
        };
        const conn = sseConnection('http://test.com/stream', FakeEventSource);
        conn.close();
        assert(closed === true);
    });

    it('logs sse parse failures without calling notify', function() {
        let listener;
        let notified = false;
        const calls = [];
        const logger = {
            error(tag, detail) { calls.push({ tag, detail }); }
        };
        const FakeEventSource = function() {
            this.addEventListener = (event, fn) => {
                listener = fn;
            };
            this.close = () => {};
        };
        const conn = sseConnection('http://test.com/stream', FakeEventSource, logger);
        conn.on('measurement', () => { notified = true; });
        listener({ data: 'not-json' });
        assert(calls.length === 1 && calls[0].tag === 'sse.parse' && notified === false,
            'parse failure was not logged or notify was called');
    });

    it('logs sse connection errors through logger', function() {
        const calls = [];
        const logger = {
            error(tag, detail) { calls.push({ tag, detail }); }
        };
        const sources = [];
        const FakeEventSource = function(url) {
            this.url = url;
            this.addEventListener = () => {};
            this.close = () => {};
            sources.push(this);
        };
        sseConnection('http://test.com/stream', FakeEventSource, logger);
        sources[0].onerror();
        assert(calls.length === 1 && calls[0].tag === 'sse.connection',
            'connection error was not logged');
    });
});
