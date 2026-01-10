import assert from 'assert';
import meltings from '../src/meltings.js';
import meltingMachine from '../src/meltingMachine.js';

function fakeSensor(value) {
    return { measurements() { return value; } };
}

function fakeAlerts() {
    return { all() { return []; } };
}

function fakeSensors() {
    return { voltage: fakeSensor(0), cosphi: fakeSensor(0) };
}

function createMachine() {
    return meltingMachine(`machine${Math.random()}`, fakeSensors(), fakeAlerts());
}

describe('meltings', function() {
    it('returns active melting when add is called without end', function() {
        const list = meltings();
        const machine = createMachine();
        assert(list.add(machine, {}).id() !== undefined, 'active melting not returned');
    });

    it('generates unique id for first added melting', function() {
        const list = meltings();
        const machine = createMachine();
        assert(list.add(machine, {}).id() === 'm1', 'first id mismatch');
    });

    it('generates unique id for second added melting on different machine', function() {
        const list = meltings();
        const first = createMachine();
        const second = createMachine();
        list.add(first, {});
        assert(list.add(second, {}).id() === 'm2', 'second id mismatch');
    });

    it('returns existing active melting when adding on same machine', function() {
        const list = meltings();
        const machine = createMachine();
        const first = list.add(machine, {});
        const second = list.add(machine, {});
        assert(first === second, 'should return same active melting');
    });

    it('returns empty array from query when no meltings exist', function() {
        const list = meltings();
        assert(list.query().length === 0, 'query should return empty');
    });

    it('returns empty array from query when only active meltings exist', function() {
        const list = meltings();
        const machine = createMachine();
        list.add(machine, {});
        assert(list.query().length === 0, 'query should return empty for active only');
    });

    it('returns completed melting from query after stop is called', function() {
        const list = meltings();
        const machine = createMachine();
        list.add(machine, {}).stop();
        assert(list.query().length === 1, 'query should return completed');
    });

    it('returns completed melting with correct id from query', function() {
        const list = meltings();
        const machine = createMachine();
        list.add(machine, {}).stop();
        assert(list.query()[0].id() === 'm1', 'completed id mismatch');
    });

    it('returns empty array from query with machine when no meltings for machine', function() {
        const list = meltings();
        const machine = createMachine();
        assert(list.query({ machine }).length === 0, 'query by machine should be empty');
    });

    it('returns active melting from query with machine', function() {
        const list = meltings();
        const machine = createMachine();
        list.add(machine, {});
        assert(list.query({ machine }).length === 1, 'active melting not found');
    });

    it('returns completed melting from query with correct machine', function() {
        const list = meltings();
        const machine = createMachine();
        list.add(machine, {}).stop();
        assert(list.query({ machine }).length === 1, 'completed by machine mismatch');
    });

    it('returns empty array from query with different machine', function() {
        const list = meltings();
        const first = createMachine();
        const second = createMachine();
        list.add(first, {}).stop();
        assert(list.query({ machine: second }).length === 0, 'wrong machine returned results');
    });

    it('returns melting from query by id', function() {
        const list = meltings();
        const machine = createMachine();
        list.add(machine, {});
        assert(list.query({ id: 'm1' }).id() === 'm1', 'query by id mismatch');
    });

    it('returns undefined from query with unknown id', function() {
        const list = meltings();
        assert(list.query({ id: 'unknown' }) === undefined, 'unknown id should return undefined');
    });

    it('updates collection automatically when stop is called', function() {
        const list = meltings();
        const machine = createMachine();
        const active = list.add(machine, {});
        active.stop();
        assert(list.query()[0].chronology().get().end !== undefined, 'end not set after stop');
    });

    it('notifies subscriber when melting starts', function() {
        const list = meltings();
        const machine = createMachine();
        let received = null;
        list.query({ stream: (event) => { received = event; } });
        list.add(machine, {});
        assert(received.type === 'started', 'started event not received');
    });

    it('notifies subscriber with started melting', function() {
        const list = meltings();
        const machine = createMachine();
        let received = null;
        list.query({ stream: (event) => { received = event; } });
        list.add(machine, {});
        assert(received.melting.id() === 'm1', 'started melting id mismatch');
    });

    it('notifies subscriber when melting completes', function() {
        const list = meltings();
        const machine = createMachine();
        let received = null;
        list.query({ stream: (event) => { if (event.type === 'completed') { received = event; } } });
        list.add(machine, {}).stop();
        assert(received.type === 'completed', 'completed event not received');
    });

    it('notifies subscriber with completed melting', function() {
        const list = meltings();
        const machine = createMachine();
        let received = null;
        list.query({ stream: (event) => { if (event.type === 'completed') { received = event; } } });
        list.add(machine, {}).stop();
        assert(received.melting.id() === 'm1', 'completed melting id mismatch');
    });

    it('stops notifying after cancel is called', function() {
        const list = meltings();
        const machine = createMachine();
        let count = 0;
        const subscription = list.query({ stream: () => { count += 1; } });
        list.add(machine, {});
        subscription.cancel();
        list.add(createMachine(), {});
        assert(count === 1, 'subscriber was notified after cancel');
    });

    it('provides chronology on active melting', function() {
        const list = meltings();
        const machine = createMachine();
        const active = list.add(machine, {});
        assert(active.chronology() !== undefined, 'chronology not provided');
    });

    it('tracks machine load through chronology', function() {
        const list = meltings();
        const machine = createMachine();
        const amount = Math.random() * 500;
        machine.load(amount);
        const active = list.add(machine, {});
        assert(active.chronology().get().weight === amount, 'weight mismatch');
    });

    it('creates completed melting when add is called with end', function() {
        const list = meltings();
        const machine = createMachine();
        const start = new Date(Date.now() - 60000);
        const end = new Date();
        const completed = list.add(machine, { start: start.toISOString(), end: end.toISOString() });
        assert(completed.chronology().get().end !== undefined, 'completed melting lacks end');
    });

    it('notifies subscriber with completed event when adding completed melting', function() {
        const list = meltings();
        const machine = createMachine();
        let received = null;
        list.query({ stream: (event) => { received = event; } });
        list.add(machine, { start: new Date().toISOString(), end: new Date().toISOString() });
        assert(received.type === 'completed', 'completed event not received');
    });

    it('allows adding completed melting on same machine as active', function() {
        const list = meltings();
        const machine = createMachine();
        list.add(machine, {});
        const completed = list.add(machine, { start: new Date().toISOString(), end: new Date().toISOString() });
        assert(completed.id() === 'm2', 'completed melting should have unique id');
    });

    it('notifies subscriber when active melting is updated', function() {
        const list = meltings();
        const machine = createMachine();
        let received = null;
        list.query({ stream: (e) => { received = e; } });
        const active = list.add(machine, {});
        active.update({ start: new Date().toISOString() });
        assert(received.type === 'updated', 'updated event not received');
    });

    it('notifies subscriber when completed melting is updated', function() {
        const list = meltings();
        const machine = createMachine();
        let received = null;
        list.query({ stream: (e) => { received = e; } });
        const completed = list.add(machine, { start: new Date().toISOString(), end: new Date().toISOString() });
        completed.update({ start: new Date(Date.now() - 60000).toISOString() });
        assert(received.type === 'updated', 'updated event not received');
    });

    it('updates collection when melting is updated', function() {
        const list = meltings();
        const machine = createMachine();
        const start = new Date(Date.now() - 120000);
        const end = new Date(Date.now() - 60000);
        list.add(machine, { start: start.toISOString(), end: end.toISOString() });
        const newStart = new Date(Date.now() - 180000);
        list.query({ id: 'm1' }).update({ start: newStart.toISOString() });
        assert(list.query({ id: 'm1' }).chronology().get().start.getTime() === newStart.getTime(), 'collection not updated');
    });

    it('returns active melting when add is called without data argument', function() {
        const list = meltings();
        const machine = createMachine();
        assert(list.add(machine).id() !== undefined, 'active melting not returned');
    });

    it('uses current time as start when add is called without start', function() {
        const list = meltings();
        const machine = createMachine();
        const before = new Date();
        const active = list.add(machine);
        const after = new Date();
        const { start } = active.chronology().get();
        assert(start >= before && start <= after, 'start time not set to current time');
    });

    it('uses provided start time when add is called with start only', function() {
        const list = meltings();
        const machine = createMachine();
        const start = new Date(Date.now() - 60000);
        const active = list.add(machine, { start: start.toISOString() });
        assert(active.chronology().get().start.getTime() === start.getTime(), 'start time mismatch');
    });
});
