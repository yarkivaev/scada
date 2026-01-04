import assert from 'assert';
import meltings from '../src/meltings.js';

function fakeMelting(id, _machine, _startTime, onStop) {
    return {
        id() {
            return id;
        },
        end: undefined,
        stop() {
            const completed = {
                id() {
                    return id;
                },
                end() {
                    return new Date();
                }
            };
            onStop(completed);
            return completed;
        }
    };
}

function fakeMachine() {
    return {
        name() {
            return `machine${  Math.random()}`;
        }
    };
}

describe('meltings', function() {
    it('returns active melting when start is called', function() {
        const list = meltings(fakeMelting);
        const machine = fakeMachine();
        assert(list.start(machine).id() !== undefined);
    });

    it('generates unique id for first started melting', function() {
        const list = meltings(fakeMelting);
        const machine = fakeMachine();
        assert(list.start(machine).id() === 'm1');
    });

    it('generates unique id for second started melting', function() {
        const list = meltings(fakeMelting);
        const machine = fakeMachine();
        list.start(machine);
        assert(list.start(machine).id() === 'm2');
    });

    it('returns empty array from all when no meltings exist', function() {
        const list = meltings(fakeMelting);
        assert(list.all().length === 0);
    });

    it('returns empty array from all when only active meltings exist', function() {
        const list = meltings(fakeMelting);
        const machine = fakeMachine();
        list.start(machine);
        assert(list.all().length === 0);
    });

    it('returns completed melting from all after stop is called', function() {
        const list = meltings(fakeMelting);
        const machine = fakeMachine();
        list.start(machine).stop();
        assert(list.all().length === 1);
    });

    it('returns completed melting with correct id from all', function() {
        const list = meltings(fakeMelting);
        const machine = fakeMachine();
        list.start(machine).stop();
        assert(list.all()[0].melting.id() === 'm1');
    });

    it('returns empty array from find when no meltings for machine', function() {
        const list = meltings(fakeMelting);
        const machine = fakeMachine();
        assert(list.find(machine).length === 0);
    });

    it('returns empty array from find when only active melting for machine', function() {
        const list = meltings(fakeMelting);
        const machine = fakeMachine();
        list.start(machine);
        assert(list.find(machine).length === 0);
    });

    it('returns completed melting from find for correct machine', function() {
        const list = meltings(fakeMelting);
        const machine = fakeMachine();
        list.start(machine).stop();
        assert(list.find(machine).length === 1);
    });

    it('returns empty array from find for different machine', function() {
        const list = meltings(fakeMelting);
        const machine1 = fakeMachine();
        const machine2 = fakeMachine();
        list.start(machine1).stop();
        assert(list.find(machine2).length === 0);
    });

    it('updates collection automatically when stop is called', function() {
        const list = meltings(fakeMelting);
        const machine = fakeMachine();
        const active = list.start(machine);
        active.stop();
        assert(list.all()[0].melting.end !== undefined);
    });
});
