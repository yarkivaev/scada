import assert from 'node:assert/strict';
import checkpoints from '../../../../src/infrastructure/persistence/memory/checkpoints.js';
import rows from '../../../helpers/checkpointRows.js';

/** Builds an independent mixed-kind checkpoint for every recovery assertion. */
function scenario() {
    const machine=`line-${Math.random()}`;
    return {machine,port:checkpoints({segments:rows(machine),metrics:[]})};
}
describe('memory checkpoint phase isolation',function() {
    it('cannot restore metric intervals as pending phases',async function() {
        const {port}=scenario();
        assert.deepEqual((await port.pendingSegments()).map(row=>{return row.name}),['running'],'Metric intervals escaped into pending recovery');
    });
    it('cannot move a phase replay cursor using metric boundaries',async function() {
        const {machine,port}=scenario();
        assert.equal(await port.replayCursor(machine),2,'Metric boundaries moved the phase replay cursor');
    });
    it('cannot select a metric sharing the phase start',async function() {
        const {machine,port}=scenario();
        assert.equal((await port.segment(machine,3)).name,'running','A metric shadowed the phase at the same timestamp');
    });
    it('cannot let metric reset tags truncate phase history',async function() {
        const {machine,port}=scenario();
        assert.deepEqual((await port.cyclePrior(machine,9,['reset'])).map(row=>{return row.name}),['idle','running'],'Metric reset tags contaminated phase history');
    });
});
