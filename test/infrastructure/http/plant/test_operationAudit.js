import assert from 'node:assert/strict';
import { decisionRow, stampPayload } from '../../../../src/infrastructure/http/plant/operationAudit.js';

describe('operationAudit decisionRow', function() {
    it('uses operation_op for any operation kind', function() {
        const kind = `kind-${Math.random().toString(36).slice(2)}`;
        const row = decisionRow(
            `m-${Math.random().toString(36).slice(2)}`,
            {
                key: `k-${Math.random().toString(36).slice(2)}`,
                kind,
                occurred_at: new Date('2024-06-01T10:00:00.000Z'),
                payload: {}
            },
            { id: 7, displayName: 'Ada Lovelace', decidedAt: new Date('2024-06-01T10:01:00.000Z') },
            'create'
        );
        assert.equal(row.payload.kind, 'operation_op', 'decision kind was not generic operation_op');
    });

    it('keeps original operation kind under operation_kind', function() {
        const kind = `proc-${Math.floor(Math.random() * 9000 + 1000)}`;
        const row = decisionRow(
            'm1',
            {
                key: 'k1',
                kind,
                occurred_at: new Date('2024-06-01T10:00:00.000Z'),
                payload: {}
            },
            { id: 1, displayName: 'Ada', decidedAt: new Date('2024-06-01T10:01:00.000Z') },
            'create'
        );
        assert.equal(row.payload.operation_kind, kind, 'operation_kind did not preserve item kind');
    });
});

describe('operationAudit stampPayload', function() {
    it('copies operator display name into payload', function() {
        const name = `Op-${Math.random().toString(36).slice(2)}`;
        const next = stampPayload({ action: 'load' }, {
            id: 3,
            displayName: name,
            decidedAt: new Date('2024-06-01T12:00:00.000Z')
        });
        assert.equal(next.operator, name, 'stampPayload did not set operator display name');
    });
});
