import assert from 'assert';
import requests from '../src/requests.js';

describe('requests', function() {
    it('returns empty array when no requests added', function() {
        const collection = requests();
        assert(collection.query().length === 0, 'query did not return empty array');
    });

    it('returns added request from query', function() {
        const collection = requests();
        collection.add({ id: `r-${Math.random()}`, name: `n-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60, options: ['on'] });
        assert(collection.query().length === 1, 'query did not return one request');
    });

    it('returns multiple unresolved requests from query', function() {
        const collection = requests();
        collection.add({ id: `r1-${Math.random()}`, name: `n-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60, options: ['a'] });
        collection.add({ id: `r2-${Math.random()}`, name: `n-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 120, options: ['b'] });
        assert(collection.query().length === 2, 'query did not return two requests');
    });

    it('excludes resolved request from query', function() {
        const collection = requests();
        const id = `r-${Math.random()}`;
        collection.add({ id, name: `n-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60, options: ['x'] });
        collection.respond(id, { label: 'on' });
        assert(collection.query().length === 0, 'resolved request still in query');
    });

    it('returns response object on respond', function() {
        const collection = requests();
        const id = `r-${Math.random()}`;
        collection.add({ id, name: `n-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60, options: ['y'] });
        const result = collection.respond(id, { label: `lbl-${Math.random()}` });
        assert(result.id === id, 'respond did not return correct id');
    });

    it('returns response body fields on respond', function() {
        const collection = requests();
        const id = `r-${Math.random()}`;
        const label = `làbel-${Math.random()}`;
        collection.add({ id, name: `n-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60, options: ['z'] });
        const result = collection.respond(id, { label });
        assert(result.label === label, 'respond did not include body fields');
    });

    it('returns undefined when responding to unknown request', function() {
        const collection = requests();
        assert(collection.respond(`unknown-${Math.random()}`, { label: 'x' }) === undefined, 'respond did not return undefined for unknown');
    });

    it('returns undefined when responding to already resolved request', function() {
        const collection = requests();
        const id = `r-${Math.random()}`;
        collection.add({ id, name: `n-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60, options: ['a'] });
        collection.respond(id, { label: 'first' });
        assert(collection.respond(id, { label: 'second' }) === undefined, 'respond did not return undefined for resolved');
    });

    it('emits created event on add', function() {
        const collection = requests();
        let received = null;
        collection.stream((e) => { received = e; });
        collection.add({ id: `r-${Math.random()}`, name: `ñ-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60, options: ['a'] });
        assert(received !== null && received.type === 'created', 'created event not emitted');
    });

    it('emits created event with added request', function() {
        const collection = requests();
        let received = null;
        collection.stream((e) => { received = e; });
        const id = `r-${Math.random()}`;
        collection.add({ id, name: `n-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60, options: ['b'] });
        assert(received.request.id === id, 'created event has wrong request');
    });

    it('emits resolved event on respond', function() {
        const collection = requests();
        const id = `r-${Math.random()}`;
        collection.add({ id, name: `n-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60, options: ['c'] });
        let received = null;
        collection.stream((e) => { received = e; });
        collection.respond(id, { label: 'on' });
        assert(received !== null && received.type === 'resolved', 'resolved event not emitted');
    });

    it('emits resolved event with resolved request', function() {
        const collection = requests();
        const id = `r-${Math.random()}`;
        collection.add({ id, name: `n-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60, options: ['d'] });
        let received = null;
        collection.stream((e) => { received = e; });
        collection.respond(id, { label: 'on' });
        assert(received.request.id === id, 'resolved event has wrong request');
    });

    it('stops notifying after subscription cancelled', function() {
        const collection = requests();
        let count = 0;
        const sub = collection.stream(() => { count += 1; });
        collection.add({ id: `r1-${Math.random()}`, name: `n-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60, options: ['e'] });
        sub.cancel();
        collection.add({ id: `r2-${Math.random()}`, name: `n-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 120, options: ['f'] });
        assert(count === 1, 'subscriber was notified after cancellation');
    });

    it('preserves request options after add', function() {
        const collection = requests();
        const options = [`opt-${Math.random()}`, `opt-${Math.random()}`];
        collection.add({ id: `r-${Math.random()}`, name: `n-${Math.random()}`, startTime: new Date(), endTime: new Date(), duration: 60, options });
        assert(collection.query()[0].options === options, 'request options not preserved');
    });
});
