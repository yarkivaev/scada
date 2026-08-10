import assert from 'assert';
import { migrationApplies, migrationSinkRunnable } from '../../../../src/infrastructure/ingest/db/migrationProfile.js';

describe('migrationApplies', function() {
    it('runs shared migrations on central and edge profiles', function() {
        const name = `V0099__shared_${Math.random()}.sql`;
        assert.strictEqual(migrationApplies(name, 'central'), true, 'central should apply V migrations');
        assert.strictEqual(migrationApplies(name, 'edge'), true, 'edge should apply V migrations');
    });

    it('runs E migrations only on edge profile', function() {
        const name = 'E0001__edge_metrics.sql';
        assert.strictEqual(migrationApplies(name, 'edge'), true, 'edge should apply E migrations');
        assert.strictEqual(migrationApplies(name, 'central'), false, 'central must skip E migrations');
    });

    it('runs C migrations only on central profile', function() {
        const name = 'C0001__central_drop_metrics.sql';
        assert.strictEqual(migrationApplies(name, 'central'), true, 'central should apply C migrations');
        assert.strictEqual(migrationApplies(name, 'edge'), false, 'edge must skip C migrations');
    });

    it('runs C0004 grants migration only with postgres admin url', function() {
        const name = 'C0004__central_operations_grants.sql';
        assert.strictEqual(migrationSinkRunnable(name), false, 'C0004 must not run as supervisor_sink');
    });

    it('runs C0005 operators grants migration only with postgres admin url', function() {
        const name = 'C0005__central_operators_grants.sql';
        assert.strictEqual(migrationSinkRunnable(name), false, 'C0005 must not run as supervisor_sink');
    });

    it('runs C0006 operators registration migration only with postgres admin url', function() {
        const name = 'C0006__central_operators_registration.sql';
        assert.strictEqual(migrationSinkRunnable(name), false, 'C0006 must not run as supervisor_sink');
    });

    it('runs E0004 operations delete grant only with postgres admin url', function() {
        const name = 'E0004__edge_operations_delete.sql';
        assert.strictEqual(migrationApplies(name, 'edge'), true, 'edge should apply E0004');
        assert.strictEqual(migrationApplies(name, 'central'), false, 'central must skip E0004');
        assert.strictEqual(migrationSinkRunnable(name), false, 'E0004 must not run as supervisor_sink');
    });
});
