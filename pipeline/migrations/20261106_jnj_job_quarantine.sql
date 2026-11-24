-- Apply after 20261106_job_quarantine.sql. Keep native DOM provenance separate from HTTP.
DO $patch$
DECLARE
 definition text := pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure);
 begin_at integer;
 end_at integer;
 original text;
 amended text;
 change record;
BEGIN
 IF position('-- JNJ JOB QUARANTINE ADMISSION' IN definition)>0 THEN RAISE EXCEPTION 'JNJ quarantine patch already installed'; END IF;
 IF position('-- BEGIN JOB QUARANTINE TOTAL' IN definition)=0 THEN RAISE EXCEPTION 'Install the shared quarantine ledger migration first'; END IF;
 begin_at:=position('-- BEGIN EXACT JNJ DOM ADMISSION' IN definition);
 end_at:=position('-- END EXACT JNJ DOM ADMISSION' IN definition);
 IF begin_at=0 OR end_at<=begin_at THEN RAISE EXCEPTION 'Current JNJ DOM admission block not found'; END IF;
 original:=substring(definition FROM begin_at FOR end_at-begin_at);
 amended:=replace(original,E'\r\n',E'\n');
 FOR change IN SELECT * FROM (VALUES
    ($old$NEW."validCount" = NEW."rawCount"$old$,$new$NEW."validCount" = NEW."dedupeOutputCount"$new$),
    ($old$NEW."normalizedCount" = NEW."rawCount" AND NEW."dedupeInputCount" = NEW."rawCount"$old$,$new$NEW."normalizedCount" = NEW."validCount" AND NEW."dedupeInputCount" = NEW."validCount"$new$),
    ($old$NEW."dedupeOutputCount" = NEW."rawCount"$old$,$new$NEW."dedupeOutputCount" = NEW."rawCount" - NEW."validationDiscardCount"$new$),
    ($old$NEW."validationDiscardCount" = 0 AND $old$,$new$$new$),
    ($old$NEW."discardCount" = 0$old$,$new$NEW."discardCount" = NEW."validationDiscardCount"$new$),
    ($old$NEW."adapterInputCount" = NEW."rawCount" AND NEW."adapterOutputCount" = NEW."rawCount"$old$,$new$NEW."adapterInputCount" = NEW."validCount" AND NEW."adapterOutputCount" = NEW."validCount"$new$),
    ($old$NOT EXISTS (SELECT 1 FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id")$old$,$new$(SELECT count(*) FROM "LossLedgerEntry" loss WHERE loss."sourceResultId" = NEW."id") = NEW."validationDiscardCount"$new$),
    ($old$'legalDedupeLedger', 'legalScopeExclusionLedger', 'pagination'$old$,$new$'legalDedupeLedger', 'legalScopeExclusionLedger', 'jobQuarantineLedger', 'pagination'$new$),
    ($old$'validationDiscardCount', 0, 'normalizationDiscardCount', 0)$old$,$new$'validationDiscardCount', NEW."validationDiscardCount", 'normalizationDiscardCount', 0)$new$),
    ($old$p."rawJobIdSetSha256" = p."validJobIdSetSha256"$old$,$new$(NEW."validationDiscardCount" > 0 OR p."rawJobIdSetSha256" = p."validJobIdSetSha256")$new$),
    ($old$--jnj-dom-detail-r-[0-9]+[.]bin$'$old$,$new$--jnj-dom-detail-(r-[0-9]+|unidentified-[0-9]+-[0-9]+)[.]bin$'$new$),
    ($old$(SELECT count(DISTINCT substring(a."path" FROM '--(jnj-dom-detail-r-[0-9]+)[.]bin$'))
                    FROM "EvidenceArtifact" a WHERE a."sourceResultId" = NEW."id" AND
                    a."extractorLocator" = 'jnj-ui-dom-detail-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP') = NEW."expectedJobCount"$old$,$new$(SELECT count(DISTINCT substring(a."path" FROM '--(jnj-dom-detail-r-[0-9]+)[.]bin$'))
                    FROM "EvidenceArtifact" a WHERE a."sourceResultId" = NEW."id" AND
                    a."extractorLocator" = 'jnj-ui-dom-detail-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP') = (SELECT count(*) FROM "EvidenceArtifact" a WHERE a."sourceResultId" = NEW."id" AND
                    a."extractorLocator" = 'jnj-ui-dom-detail-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP')$new$),
    ($old$a."extractorLocator" = 'jnj-ui-dom-detail-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP') = NEW."expectedJobCount"$old$,$new$a."extractorLocator" = 'jnj-ui-dom-detail-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP') BETWEEN NEW."dedupeOutputCount" AND NEW."expectedJobCount"$new$),
    ($old$--(jnj-dom-detail-r-[0-9]+)[.]bin$'$old$,$new$--(jnj-dom-detail-(?:r-[0-9]+|unidentified-[0-9]+-[0-9]+))[.]bin$'$new$)
 ) edits(old_text,new_text) LOOP
  IF position(change.old_text IN amended)=0 THEN RAISE EXCEPTION 'JNJ admission anchor changed: %',change.old_text; END IF;
  amended:=replace(amended,change.old_text,change.new_text);
 END LOOP;
 EXECUTE replace(definition,original,'-- JNJ JOB QUARANTINE ADMISSION' || chr(10) || amended);
END $patch$;
