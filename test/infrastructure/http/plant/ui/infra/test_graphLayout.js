import assert from 'assert';
import positions from '../../../../../../src/infrastructure/http/plant/ui/infra/graphLayout.js';

describe('graphLayout', function() {
    it('places a shop collector in the shop column', function() {
        const id = `load-\u041d${Math.floor(Math.random() * 90 + 10)}`;
        const layout = positions({
            nodes: [
                { id: 'area-1', kind: 'shop', title: 'Area 1' },
                { id, kind: 'collector', title: id, parent: 'area-1' }
            ]
        });
        assert.strictEqual(
            layout[id].x,
            layout['area-1'].x,
            'shop collector was not placed in the shop column'
        );
    });

    it('keeps the first machine at the legacy y when the shop has no collectors', function() {
        const id = `m-\u041d${Math.floor(Math.random() * 90 + 10)}`;
        const layout = positions({
            nodes: [
                { id: 'area-1', kind: 'shop', title: 'Area 1' },
                { id, kind: 'machine', title: id, parent: 'area-1' }
            ]
        });
        assert.strictEqual(
            layout[id].y,
            150,
            'machine column y moved without shop collectors'
        );
    });

    it('keeps a shop collector below the previous collector label', function() {
        const first = `load-\u041d${Math.floor(Math.random() * 90 + 10)}`;
        const second = `bay-\u041d${Math.floor(Math.random() * 90 + 10)}`;
        const layout = positions({
            nodes: [
                { id: 'area-1', kind: 'shop', title: 'Area 1' },
                { id: first, kind: 'collector', title: first, parent: 'area-1' },
                { id: second, kind: 'collector', title: second, parent: 'area-1' }
            ]
        });
        assert.ok(
            layout[second].y - layout[first].y > 46,
            'shop collector sat on the previous collector label'
        );
    });
});
