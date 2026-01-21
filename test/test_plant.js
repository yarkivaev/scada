import assert from 'assert';
import plant from '../src/plant.js';

function fakeShops() {
    return {
        initialized: false,
        collection: {},
        init() {
            this.initialized = true;
        },
        get() {
            return this.collection;
        }
    };
}

function fakeEvents() {
    return {
        items: [],
        all() {
            return this.items;
        },
        stream() {
            return { cancel() {} };
        }
    };
}

describe('plant', function() {
    it('returns shops property', function() {
        const shops = fakeShops();
        const factory = plant(shops, fakeEvents());
        assert(factory.shops === shops, 'shops property mismatch');
    });

    it('returns shops collection from get', function() {
        const shops = fakeShops();
        const key = `s${Math.random()}`;
        shops.collection = { [key]: { name: key } };
        const factory = plant(shops, fakeEvents());
        assert(factory.shops.get()[key] !== undefined, 'shop not found in collection');
    });

    it('calls init on shops when init is called', function() {
        const shops = fakeShops();
        const factory = plant(shops, fakeEvents());
        factory.init();
        assert(shops.initialized === true, 'shops were not initialized');
    });

    it('returns events property', function() {
        const evts = fakeEvents();
        const factory = plant(fakeShops(), evts);
        assert(factory.events === evts, 'events property mismatch');
    });

    it('returns events with stream method', function() {
        const evts = fakeEvents();
        const factory = plant(fakeShops(), evts);
        assert(typeof factory.events.stream === 'function', 'events has no stream method');
    });
});
