import assert from 'node:assert';
import namespaceTree from '../../../src/domain/namespace/namespaceTree.js';

describe('namespaceTree', function() {
    it('resolves a node by its unique path', function() {
        const path = `участок-${Math.random().toString(16).slice(2)}/узел`;
        const tree = namespaceTree([
            { kind: 'площадка', path, silenceSeconds: 17, title: 'Узел α' }
        ]);
        assert.strictEqual(tree.resolve(path).kind, 'площадка', 'resolve missed a path that was inserted');
    });

    it('rejects a missing path', function() {
        const tree = namespaceTree([
            { kind: 'площадка', path: `зона-${Math.random().toString(16).slice(2)}`, silenceSeconds: 3 }
        ]);
        assert.throws(function() {
            tree.resolve(`нет-${Math.random().toString(16).slice(2)}`);
        }, Error, 'resolve accepted a path that is not in the tree');
    });

    it('rejects a duplicated path', function() {
        const path = `дубль-${Math.random().toString(16).slice(2)}`;
        assert.throws(function() {
            namespaceTree([
                { kind: 'площадка', path, silenceSeconds: 11 },
                { kind: 'площадка', path, silenceSeconds: 12 }
            ]);
        }, Error, 'a duplicated path was stored');
    });

    it('lists nodes below a path', function() {
        const root = `цех-${Math.random().toString(16).slice(2)}`;
        const child = `${root}/датчик`;
        const tree = namespaceTree([
            { kind: 'area', path: root, silenceSeconds: 60, title: 'Цех' },
            { kind: 'metric', path: child, silenceSeconds: 60, source: 'gw/α', unit: 'кВт' }
        ]);
        assert.deepStrictEqual(tree.below(root).map(function(node) {
            return node.path;
        }), [child], 'below missed a child path');
    });
});
