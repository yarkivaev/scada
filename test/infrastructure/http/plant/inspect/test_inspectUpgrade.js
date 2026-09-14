import assert from 'assert';
import inspectUpgrade from '../../../../../src/infrastructure/http/plant/inspect/inspectUpgrade.js';
import plant from '../../../../../src/domain/plant/plant.js';
import initialized from '../../../../../src/domain/shared/initialized.js';

describe('inspectUpgrade', function() {
    it('drops upgrades that are not inspect paths', function() {
        let destroyed = false;
        inspectUpgrade(plant(initialized({}, Object.values)), { url: '/other', headers: {} }, {
            destroy() {
                destroyed = true;
            }
        }, Buffer.alloc(0));
        assert.strictEqual(destroyed, true, 'unknown upgrade was not dropped');
    });
});
