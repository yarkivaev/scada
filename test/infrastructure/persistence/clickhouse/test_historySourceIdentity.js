import assert from 'node:assert/strict';
import {usableCutoff} from '../../../../src/infrastructure/persistence/clickhouse/historySourceIdentity.js';

describe('ClickHouse history retention cutoff', function() {
    it('omits an empty floor that ClickHouse cannot scan', function() {
        assert.equal(usableCutoff(-Number.MAX_SAFE_INTEGER), null, 'unsafe empty floor still bounded the query');
    });
    it('keeps a stored non-negative floor', function() {
        assert.equal(usableCutoff(1794887340000000), 1794887340000000, 'declared floor was dropped');
    });
});
