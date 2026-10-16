-- The source-result trigger originally used `artifact` both as a PL/pgSQL
-- record variable and as the alias of the Grifols detail-artifact query.
-- PostgreSQL correctly rejects that query as ambiguous. Rename only the
-- record variable while preserving every existing trigger predicate.
DO $repair$
DECLARE
    definition TEXT;
    repaired TEXT;
BEGIN
    SELECT pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure)
    INTO definition;

    repaired := replace(definition, '    artifact RECORD;', '    official_artifact RECORD;');
    repaired := replace(repaired, 'SELECT * INTO artifact', 'SELECT * INTO official_artifact');
    repaired := replace(repaired,
        'IF artifact."kind" NOT IN',
        'IF official_artifact."kind" NOT IN');
    repaired := replace(repaired,
        'artifact."extractorLocator" IS NULL OR btrim(artifact."extractorLocator")',
        'official_artifact."extractorLocator" IS NULL OR btrim(official_artifact."extractorLocator")');

    IF repaired = definition OR
       repaired LIKE '%    artifact RECORD;%' OR
       repaired LIKE '%SELECT * INTO artifact%' OR
       repaired LIKE '%IF artifact."kind" NOT IN%' THEN
        RAISE EXCEPTION 'enforce_source_result_state_machine artifact binding repair did not apply exactly';
    END IF;

    EXECUTE repaired;
END;
$repair$;
