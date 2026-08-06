import assert from 'assert';
import {
    buildSiteOperatorCatalog,
    centralOperators,
    decisionRoute,
    edgeOperatorCatalog,
    edgeOperators,
    operator,
    operatorExtras,
    operatorJson,
    operatorRoute,
    operators,
    operatorsFromPg,
    operatorsSync,
    siteOperatorCatalog,
    userDecisionsFromPg
} from '../../index.js';

describe('operator catalog package exports', function() {
    it('exports building blocks for plant operatorCatalog override', function() {
        assert.deepStrictEqual(
            [
                typeof buildSiteOperatorCatalog,
                typeof siteOperatorCatalog,
                typeof edgeOperatorCatalog,
                typeof operatorsFromPg,
                typeof operatorRoute,
                typeof decisionRoute,
                typeof operatorJson,
                typeof operatorExtras,
                typeof operators,
                typeof centralOperators,
                typeof edgeOperators,
                typeof operatorsSync,
                typeof operator,
                typeof userDecisionsFromPg
            ],
            Array(14).fill('function'),
            'package did not export operator catalog building blocks for plant override'
        );
    });
});
