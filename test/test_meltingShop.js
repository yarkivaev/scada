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

function fakeMeltings() {
    return {
        items: [],
        all() {
            return this.items;
        }
    };
}

describe('meltingShop', function() {
    it('returns machines property', function() {
        const machines = fakeMachines();
        const shop = meltingShop(machines, fakeMeltings());
        assert(shop.machines === machines);
    });

    it('returns machines list from machines property', function() {
        const machines = fakeMachines();
        machines.items = [{ name: `m${Math.random()}` }];
        const shop = meltingShop(machines, fakeMeltings());
        assert(shop.machines.list().length === 1);
    });

    it('calls init on machines when init is called', function() {
        const machines = fakeMachines();
        const shop = meltingShop(machines, fakeMeltings());
        shop.init();
        assert(machines.initialized === true);
    });

    it('returns meltings property', function() {
        const meltings = fakeMeltings();
        const shop = meltingShop(fakeMachines(), meltings);
        assert(shop.meltings === meltings);
    });

    it('returns meltings list from meltings property', function() {
        const meltings = fakeMeltings();
        meltings.items = [{ id: `melting${Math.random()}` }];
        const shop = meltingShop(fakeMachines(), meltings);
        assert(shop.meltings.all().length === 1);
    });
});
