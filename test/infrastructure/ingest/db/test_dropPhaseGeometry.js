import assert from 'assert';
import { readFileSync } from 'node:fs';

describe('V0012 drop phase geometry triggers', function () {
    it('drops the three phase geometry triggers', function () {
        const body = readFileSync(new URL('../../../../db/migrations/V0012__drop_phase_geometry_triggers.sql', import.meta.url), 'utf8');
        assert.equal(['skip_covered_unsplit_phase', 'keep_unsplit_phase_span', 'keep_repaired_phase_row']
            .every((name) => { return body.includes(`DROP TRIGGER IF EXISTS ${name} ON segments`)
                && body.includes(`DROP FUNCTION IF EXISTS ${name}`); }),
        true, 'phase geometry triggers were still left on segments');
    });
});
