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

    it('runs C0002 revoke migration only with postgres admin url', function() {
        const name = 'C0002__central_revoke_delete.sql';
        assert.strictEqual(migrationSinkRunnable(name), false, 'C0002 must not run as supervisor_sink');
    });
});
