/** Exact inactive schema51 files; not a claim that the migration ran. */
export const NOVO_JOB_VERIFICATION_MIGRATION_NAME = "20261017205300_novo_job_verification" as const;
export const NOVO_JOB_VERIFICATION_MIGRATION_SHA256 = "046214d0bc4c8e7e14cec1f68d478365f36fa06f514403b957b20d725611aafd";
export const NOVO_JOB_VERIFICATION_SCHEMA_SHA256 = "07d48624f6992f68c7e30f14655aa6a118eb36edab462e24eeffac62acde4b92";
export const NOVO_JOB_VERIFICATION_STATE_PROSRC = "6c2d81e3140dd05d3e8f01babb5c4858a38c87b26f529c8ce1b68992084d5d0b";
export const NOVO_JOB_VERIFICATION_PARENT_PROSRC = "4cdedb865b09e28b62dcbc1deb25b961bb289315f2226df2c2617be07ed9cb0a";
/** Preserve exact function metadata as well as its source, without inventing a PG rendering hash. */
export function compileNovoJobVerificationProfileGuard():string {
 return [["public.enforce_source_result_state_machine()",NOVO_JOB_VERIFICATION_STATE_PROSRC,false],
   ["public.guard_crawl_batch_source_result_insert()",NOVO_JOB_VERIFICATION_PARENT_PROSRC,true]].map(([name,hash,secured])=>`IF NOT EXISTS (
 SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE p.oid=to_regprocedure('${name}') AND l.lanname='plpgsql' AND p.pronargs=0
 AND p.prorettype='pg_catalog.trigger'::regtype AND p.prosecdef=${secured?'true':'false'}
 AND NOT p.proisstrict AND NOT p.proleakproof AND p.provolatile='v' AND p.proparallel='u' AND p.prokind='f'
 AND ${secured?"p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]":"p.proconfig IS NULL"}
 AND encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='${hash}'
 ) THEN RAISE EXCEPTION 'PILOT_JOB_VERIFICATION_FUNCTION_DRIFT'; END IF;`).join("\n")+`
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_enum WHERE enumtypid='public."CrawlBatchKind"'::regtype AND enumlabel='JOB_VERIFICATION') THEN RAISE EXCEPTION 'PILOT_JOB_VERIFICATION_KIND_MISSING'; END IF;`;
}
