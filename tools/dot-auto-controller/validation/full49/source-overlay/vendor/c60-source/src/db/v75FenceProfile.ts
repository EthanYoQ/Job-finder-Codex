/** Schema50 source profile only. No claim that this migration ran on a database. */
export const V75_FENCE_MIGRATION_NAME = "20261014141000_v75_retired_candidate_fence" as const;
export const V75_FENCE_MIGRATION_SHA256 = "b7c868b224ce1f13789f6f2cdcebafe95f1b2d83da1ac037d9a298cff79e3284";
export const V75_FENCE_SCHEMA_SHA256 = "6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7";
export const V75_FENCE_PROSRC_SHA256 = "0a38255081cd1b047343a0e02d82bcb89e1263364a232c46f49a834067b907da";
export const V75_FENCE_FUNCTION = "public.guard_v75_retired_source_publication()";
export const V75_FENCE_TRIGGER = "CrawlBatchSourceResult_v75_retired_candidate_guard";
/** Catalog fields avoid inventing a pg_get_functiondef/triggerdef rendering receipt. */
export function compileV75FenceProfileGuard(): string {
 return `IF NOT EXISTS (
 SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
 WHERE p.oid=to_regprocedure('${V75_FENCE_FUNCTION}') AND l.lanname='plpgsql'
 AND p.pronargs=0 AND p.prorettype='pg_catalog.trigger'::regtype
 AND NOT p.prosecdef AND NOT p.proisstrict AND NOT p.proleakproof
 AND p.provolatile='v' AND p.proparallel='u' AND p.prokind='f'
 AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
 AND encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='${V75_FENCE_PROSRC_SHA256}'
 ) THEN RAISE EXCEPTION 'PILOT_V75_FENCE_FUNCTION_DRIFT'; END IF;
 IF NOT EXISTS (
 SELECT 1 FROM pg_catalog.pg_trigger t
 WHERE t.tgrelid='public."CrawlBatchSourceResult"'::regclass
 AND t.tgname='${V75_FENCE_TRIGGER}' AND t.tgfoid=to_regprocedure('${V75_FENCE_FUNCTION}')
 AND t.tgenabled='O' AND t.tgtype=23 AND NOT t.tgisinternal
 AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgconstraint=0
 AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgattr::text='' AND t.tgqual IS NULL
 AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
 ) THEN RAISE EXCEPTION 'PILOT_V75_FENCE_TRIGGER_DRIFT'; END IF;`;
}
