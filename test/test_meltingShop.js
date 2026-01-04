import assert from 'assert';
import meltingShop from '../src/meltingShop.js';

function fakeMachines() {
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

describe('meltingShop', function() {
    it('returns machines property', function() {
        const machines = fakeMachines();
        const shop = meltingShop(machines);
        assert(shop.machines === machines);
    });

    it('returns machines list from machines property', function() {
        const machines = fakeMachines();
        machines.items = [{ name: `m${Math.random()}` }];
        const shop = meltingShop(machines);
        assert(shop.machines.list().length === 1);
    });

    it('calls init on machines when init is called', function() {
        const machines = fakeMachines();
        const shop = meltingShop(machines);
        shop.init();
        assert(machines.initialized === true);
    });
});
