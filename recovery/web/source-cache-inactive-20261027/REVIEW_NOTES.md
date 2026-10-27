# INACTIVE per-source reuse of the existing website snapshot

## Verified problem / billing limits
The historically deployed light reader d6832ee9 (domain8d31a720) detects any mutation in nine whole tables, then reloads all configured display plans. The original serial collector reads the website after each source commit. A source commit invalidates that global version; the next public request therefore reloads unaffected sources too. There is no idle polling: unchanged-data public reads only check the small version response, as preserved 10/18 deployment logs show.

The 10/18 actual query-filtered 41-plan verification fixture contains 18,781,592 compact UTF-8 JSON bytes returned across result/job/member/artifact/closure arrays. This is independently captured per-source historical input, NOT one transaction, current traffic, protocol bytes or provider billing. 36 full rebuilds × twice daily ×30 days at that size model 40.57GB. This explains a plausible amplification mechanism, not a proved attribution of the actual invoice. Provider project/service usage and current authenticated refresh logs are still unavailable.

## Scope: exactly two production files
- `src/db/portableSnapshotCache.ts`
- `src/db/portablePublicSnapshotRepository.ts`

No new service, table, framework, scheduler, polling, credentials, architecture or source scope. No native collector changes. HTTP single-flight/background/post-build logic and the pure source selection/projector remain unchanged. Original reader queries, B gates, GRACE checks, Job projection consistency, Novo closure proof and read-only RepeatableRead transaction remain the authority.

The sole existing cache continues owning one verified snapshot (no duplicate raw-history cache). It additionally records a small source→version map. Within the same read transaction, the version query returns all source fingerprints and the original nine-table global fingerprint. Only changed sources reload their original data. Unchanged sources reuse the prior verified `snapshot.sources`; companies and global totals are rebuilt from the complete union. Nothing partial is stored or exposed before the full assembly succeeds.

## Correctness details
- All nine tables remain fingerprinted. Child tuples belong to both declared source and owning source-result source; mismatched child source IDs cannot hide changes. Batch tuples affect every linked source. Direct+owner duplicates collapse.
- Zero-row requested sources have explicit empty digests. Deleted/moved rows change both affected sides. All statuses/configs are fingerprinted, not just accepted results: B RUNNING/FAILED remains visible to the original HOLD selector.
- Novo conservatively uses the original global nine-table fingerprint, so every global change rechecks its existing historical closure references, including malformed cross-source IDs. This costs one small extra source read rather than a new dependency graph.
- Reuse only when source scope/config/options match and `from <= now < until`. Expiry, clock reversal or changed scope rebuild all. After partial rebuild, validity is capped by `min(previousUntil, changedDataUntil)`; no freshness extension for reused rows.
- The post-build version check remains global. Query/verification failure leaves the old cache intact. No stale projection is relabelled current before the original verification boundary.

## Evidence
- `TEST_RESULT.json`: actual frozen 41-source fixture cold projections identical; 13 mutation/time/state scenarios identical to the original full reader; warm unchanged has no data query; post-build change returns UPDATING then rebuilds affected sources; failed partial leaves old cache.
- `OWNERSHIP_MODEL_RESULT.json`: independent seven-case ownership model (shared batch, wrong-source observation/artifact, null declared source, Job migration, final deletion, off-roster Novo dependency).
- `CHANGE_MANIFEST.json`: baseline/candidate hashes and clean TypeScript `tsc --noEmit` on original Node22.23.3.
- Existing 36-source before reduction is a different external candidate, not silently included here.

Representative single-AbbVie-change read payload: old18,781,616 bytes vs new415,298 bytes for AbbVie+conservativeNovo (97.79% smaller DATA arrays). New source-version response bytes and SQL execution CPU are not included. Cold start remains18.78MB; no claims of actual network savings.

## Not yet validated / activation constraints
NO PostgreSQL statement executed: independent official SQL approval remains blocked. SQL was generated/reviewed; mocks and the ownership model do not prove PostgreSQL syntax, execution plan, transaction timing or billed byte counts. Grouped source version aggregation adds database-side work; its latency under the existing30s transaction budget must be measured when the official channel is legally available. Current Aliyun authentication is unavailable, so neither current live source hashes nor deployment were claimed.

Before any activation: independent review, original private GitHub backup/readback, original private Drive immutable delta/download restore, original reader pins/binding update and explicit appropriate deployment authorization. Preserve existing primary/backup heap, routing, address and rollback. No denied operation was retried or bypassed.
