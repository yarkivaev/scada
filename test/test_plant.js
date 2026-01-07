import assert from 'assert';
import plant from '../src/plant.js';

function fakeShops() {
    return {
        initialized: false,
        collection: {},
        init() {
            this.initialized = true;
            return this.collection;
        }
    };
}

describe('plant', function() {
    it('returns shops property', function() {
        const shops = fakeShops();
        const factory = plant(shops);
        assert(factory.shops === shops, 'shops property mismatch');
    });

    it('returns shops collection from init', function() {
        const shops = fakeShops();
        const key = `s${Math.random()}`;
        shops.collection = { [key]: { name: key } };
        const factory = plant(shops);
        assert(factory.shops.init()[key] !== undefined, 'shop not found in collection');
    });

    it('calls init on shops when init is called', function() {
        const shops = fakeShops();
        const factory = plant(shops);
        factory.init();
        assert(shops.initialized === true, 'shops were not initialized');
    });
});
