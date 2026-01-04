import assert from 'assert';
import plant from '../src/plant.js';

function fakeShops() {
    return {
        initialized: false,
        items: [],
        list() {
            return this.items;
        },
        init() {
            this.initialized = true;
        }
    };
}

describe('plant', function() {
    it('returns shops property', function() {
        const shops = fakeShops();
        const factory = plant(shops);
        assert(factory.shops === shops);
    });

    it('returns shops list from shops property', function() {
        const shops = fakeShops();
        shops.items = [{ name: `s${Math.random()}` }];
        const factory = plant(shops);
        assert(factory.shops.list().length === 1);
    });

    it('calls init on shops when init is called', function() {
        const shops = fakeShops();
        const factory = plant(shops);
        factory.init();
        assert(shops.initialized === true);
    });
});
