-- Bind new Organon terminal receipts to the reviewed Phenom-only source plan.
DO $migration$
DECLARE
    target regprocedure := 'public.enforce_source_result_state_machine()'::regprocedure;
    definition text := pg_get_functiondef(target);
    before_digest constant text := '589a90a07db728d486c0458e15e76b7d';
    after_digest constant text := '3f1421bade18ef4096998ce7926019f7';
    old_binding constant text := $row$('source-organon-china-social','company-organon-china','d56e212c03224c44b0be11afc07709ae9b2fbfd2a69c24ce773c0f192fa603d2')$row$;
    new_binding constant text := $row$('source-organon-china-social','company-organon-china','7530360f37f40c1df05d41622813666e217f42fb04751d410d42253f543ac8c8')$row$;
BEGIN
    IF md5(definition) = after_digest THEN
        RETURN;
    END IF;
    IF md5(definition) <> before_digest THEN
        RAISE EXCEPTION 'Unexpected source terminal function before Organon migration';
    END IF;
    EXECUTE replace(definition, old_binding, new_binding);
    IF md5(pg_get_functiondef(target)) <> after_digest THEN
        RAISE EXCEPTION 'Organon terminal function readback mismatch';
    END IF;
END
$migration$;
