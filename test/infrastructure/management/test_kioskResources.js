import assert from 'node:assert/strict';
import renderKioskResources from '../../../src/infrastructure/management/kiosk/renderKioskResources.js';

describe('kiosk resources', function () {
    it('loads packaged assets and quotes browser arguments from data', function () {
        const [resource] = renderKioskResources([{
            args: [{ kioskLaunch: { executable: '/usr/bin/chromium', args: ['--kiosk', "don't run; sleep 10"], urlEnvironment: 'START_PAGE' } }],
            data: { 'listen.mjs': { kioskAsset: 'listen.mjs' } }
        }]);
        assert.deepEqual(resource.args, [`exec /usr/bin/chromium --kiosk 'don'"'"'t run; sleep 10' "$START_PAGE"\n`]);
        assert.match(resource.data['listen.mjs'], /net\.createServer/u);
    });

    it('limits script references to packaged runtime assets', function () {
        assert.throws(() => { renderKioskResources({ kioskAsset: '../not-packaged' }); }, /Unknown kiosk asset/u);
    });
});
