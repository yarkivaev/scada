import assert from 'assert';
import plant from '../../../src/domain/plant/plant.js';

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

describe('plant', function() {
    it('initializes shops on init', function() {
        const shops = fakeShops();
        const p = plant(shops);
        p.init();
        assert.strictEqual(shops.initialized, true);
    });
});
