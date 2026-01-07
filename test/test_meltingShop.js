import assert from 'assert';
import meltingShop from '../src/meltingShop.js';

function fakeMachines() {
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

function fakeMeltings() {
    return {
        items: [],
        all() {
            return this.items;
        }
    };
}

function fakeAlerts() {
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

describe('meltingShop', function() {
    it('returns name from name method', function() {
        const name = `shop${Math.random()}`;
        const shop = meltingShop(name, fakeMachines(), fakeMeltings());
        assert(shop.name() === name, 'name does not match');
    });

    it('returns machines property', function() {
        const machines = fakeMachines();
        const shop = meltingShop(`shop${Math.random()}`, machines, fakeMeltings());
        assert(shop.machines === machines, 'machines property mismatch');
    });

    it('returns machines collection from get', function() {
        const machines = fakeMachines();
        const key = `m${Math.random()}`;
        machines.collection = { [key]: { name: key } };
        const shop = meltingShop(`shop${Math.random()}`, machines, fakeMeltings());
        assert(shop.machines.get()[key] !== undefined, 'machine not found in collection');
    });

    it('calls init on machines when init is called', function() {
        const machines = fakeMachines();
        const shop = meltingShop(`shop${Math.random()}`, machines, fakeMeltings());
        shop.init();
        assert(machines.initialized === true, 'machines were not initialized');
    });

    it('returns meltings property', function() {
        const meltings = fakeMeltings();
        const shop = meltingShop(`shop${Math.random()}`, fakeMachines(), meltings);
        assert(shop.meltings === meltings, 'meltings property mismatch');
    });

    it('returns meltings list from meltings property', function() {
        const meltings = fakeMeltings();
        meltings.items = [{ id: `melting${Math.random()}` }];
        const shop = meltingShop(`shop${Math.random()}`, fakeMachines(), meltings);
        assert(shop.meltings.all().length === 1, 'expected one melting');
    });

    it('returns alerts property', function() {
        const alerts = fakeAlerts();
        const shop = meltingShop(`shop${Math.random()}`, fakeMachines(), fakeMeltings(), alerts);
        assert(shop.alerts === alerts, 'alerts property mismatch');
    });

    it('returns alerts with stream method', function() {
        const alerts = fakeAlerts();
        const shop = meltingShop(`shop${Math.random()}`, fakeMachines(), fakeMeltings(), alerts);
        assert(typeof shop.alerts.stream === 'function', 'alerts has no stream method');
    });
});
