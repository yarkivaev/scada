import assert from 'node:assert';
import sqlGuard from '../../../src/domain/sql/sqlGuard.js';

describe('sqlGuard', function() {
    it('rejects a write statement', function() {
        assert.throws(function() {
            sqlGuard(`DeLeTe FROM "ряд-${Math.random().toString(16).slice(2)}"`, 'postgres');
        }, Error, 'a write statement passed the guard');
    });

    it('rejects a clickhouse query without a ts predicate', function() {
        assert.throws(function() {
            sqlGuard(`SELECT value FROM metrics WHERE topic = 'α-${Math.random().toString(16).slice(2)}'`, 'clickhouse');
        }, Error, 'a clickhouse query without ts was accepted');
    });

    it('accepts a clickhouse select that predicates ts', function() {
        const sql = "SELECT value FROM metrics WHERE ts >= '2024-11-02T03:04:05.137Z'";
        assert.strictEqual(sqlGuard(sql, 'clickhouse'), sql, 'a ts predicate was rejected');
    });

    it('rejects a query that reads card_uid', function() {
        assert.throws(function() {
            sqlGuard('SELECT card_uid FROM operators', 'postgres');
        }, Error, 'card_uid was readable');
    });
});
