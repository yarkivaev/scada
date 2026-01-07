import assert from 'assert';
import initialized from '../src/initialized.js';

function fakeItem() {
    return {
        initialized: false,
        init() {
            this.initialized = true;
        }
    };
}

describe('initialized', function() {
    it('returns empty object from init when empty object provided', function() {
        const container = initialized({}, Object.values);
        assert(Object.keys(container.init()).length === 0, 'expected empty object');
    });

    it('returns single item from init when one item provided', function() {
        const item = fakeItem();
        const container = initialized({ item }, Object.values);
        assert(container.init().item === item, 'expected item in collection');
    });

    it('returns all items from init when multiple items provided', function() {
        const first = fakeItem();
        const second = fakeItem();
        const third = fakeItem();
        const container = initialized({ first, second, third }, Object.values);
        assert(Object.keys(container.init()).length === 3, 'expected three items');
    });

    it('calls init on single item when init is called', function() {
        const item = fakeItem();
        const container = initialized({ item }, Object.values);
        container.init();
        assert(item.initialized === true, 'item was not initialized');
    });

    it('calls init on all items when init is called', function() {
        const first = fakeItem();
        const second = fakeItem();
        const third = fakeItem();
        const container = initialized({ first, second, third }, Object.values);
        container.init();
        assert(third.initialized === true, 'third item was not initialized');
    });

    it('calls init on items only once when init called multiple times', function() {
        let count = 0;
        const item = { init() { count += 1; } };
        const container = initialized({ item }, Object.values);
        container.init();
        container.init();
        container.init();
        assert(count === 1, 'init was called more than once');
    });

    it('returns same collection on subsequent init calls', function() {
        const item = fakeItem();
        const container = initialized({ item }, Object.values);
        const first = container.init();
        const second = container.init();
        assert(first === second, 'collections are not the same reference');
    });

    it('allows access by key after init', function() {
        const item = fakeItem();
        const key = `key${Math.random()}`;
        const container = initialized({ [key]: item }, Object.values);
        assert(container.init()[key] === item, 'could not access item by key');
    });
});
