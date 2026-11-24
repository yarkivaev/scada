DROP TRIGGER IF EXISTS skip_covered_unsplit_phase ON segments;
DROP TRIGGER IF EXISTS keep_unsplit_phase_span ON segments;
DROP TRIGGER IF EXISTS keep_repaired_phase_row ON segments;
DROP FUNCTION IF EXISTS skip_covered_unsplit_phase();
DROP FUNCTION IF EXISTS keep_unsplit_phase_span();
DROP FUNCTION IF EXISTS keep_repaired_phase_row();
