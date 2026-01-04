import assert from 'assert';
import initializedList from '../src/initializedList.js';

function fakeItem() {
    return {
        initialized: false,
        init() {
            this.initialized = true;
        }
    };
}

describe('initializedList', function() {
    it('returns empty array from list when no items provided', function() {
        const container = initializedList();
        assert(container.list().length === 0);
    });

    it('returns single item from list when one item provided', function() {
        const item = fakeItem();
        const container = initializedList(item);
        assert(container.list()[0] === item);
    });

    it('returns all items from list when multiple items provided', function() {
        const first = fakeItem();
        const second = fakeItem();
        const third = fakeItem();
        const container = initializedList(first, second, third);
        assert(container.list().length === 3);
    });

    it('preserves item order in list', function() {
        const first = fakeItem();
        const second = fakeItem();
        const container = initializedList(first, second);
        assert(container.list()[0] === first);
    });

    it('calls init on single item when init is called', function() {
        const item = fakeItem();
        const container = initializedList(item);
        container.init();
        assert(item.initialized === true);
    });

    it('calls init on all items when init is called', function() {
        const first = fakeItem();
        const second = fakeItem();
        const third = fakeItem();
        const container = initializedList(first, second, third);
        container.init();
        assert(third.initialized === true);
    });

    it('calls init on items in order', function() {
        const order = [];
        const first = { init() { order.push(1); } };
        const second = { init() { order.push(2); } };
        const container = initializedList(first, second);
        container.init();
        assert(order[0] === 1);
    });
});
