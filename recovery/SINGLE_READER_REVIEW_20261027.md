# Single-query reader-before transfer reduction (INACTIVE)

Parent: external tail candidate d7c03f89a6e31f6684da779841356939320349e7, after external 2024. No active code, native candidate, website or database changed. No SQL executed.

## Change
- Keep the four existing split readers unchanged (generated header/final/publication SQL byte-identical).
- Other 32 sources still issue exactly one original read-only repeatable-read SQL transaction. The server removes only `results[].completenessCertificate.members` duplicated by the same snapshot's full first/latest accepted record.
- Return exact compacted result IDs alongside the snapshot; reconstruct those members from that full publication record. Original null/missing members are NOT marked and remain malformed, rather than being silently repaired.
- Keep all original publicationContext, independent READ_CONTEXT / READ_PUBLICATION_CONTEXT, atomic write/fence and READ_OUTCOME operations untouched.
- `ENTRY_AFTER_TAIL.patch` applies after the completed-tail candidate, touching only the former direct `sql(query)` reader branch. Full proposed entry provided for review.

## Offline checks
`node inactive-reader-before-single-20261027T0849Z/reader-before-single.test.mjs`
- 36 actual retained READER_BEFORE snapshots reconstruct exactly (all fields), each one SQL callback.
- Existing split-reader query strings exactly unchanged.
- Bad row counts, duplicate results, missing original manifest, wrong source/config refused.
- Original malformed null manifest retained as-is (downstream original admission remains owner).
- Real SQL execution remains untested due the independently denied official channel. Mock SQL reproduces exact JSON projection; it is not a production receipt.

## Measured / estimated
- All 36 latest saved before snapshots: 49,226,681 compact UTF-8 JSON bytes, NOT one complete round and NOT billed network bytes.
- Exact repeated manifest content removed for 32 direct-reader snapshots: 5,362,250 bytes.
- New compacted-ID column JSON overhead: 2,915 bytes. Representative net reduction 5,359,335 bytes, 10.887% of the 36-snapshot total.
- At unchanged payload sizes, 2 complete rounds/day × 30 days: theoretical 321,560,100 bytes/month (~0.322 decimal GB). Not measured savings; does not explain or eliminate all reported tens of GB.
- Audit of 474 unique persisted relay responses (10/18–10/20 request-expiry window) excludes local copies and parts: READ_CONTEXT 86,470,573 bytes / 150; READ_PUBLICATION_CONTEXT 75,031,385 / 108; READ_OUTCOME 33,457,916 / 108; PUBLISH 3,846 / 108. These are compact JSON result bytes, not transport/billing measurements.

## Website finding, not changed
The verified historical deployed light reader's repository SHA is d6832ee9ac34aec2463e19451f501407007779df33328df26e7ceb11cf0a7565. Its `src/db/portableSnapshotCache.ts` versions nine entire tables by physical xmin/ctid; any source commit invalidates the whole snapshot. `portablePublicSnapshotRepository.ts:218–240` then reloads all plans' compact historical results, selected members, current jobs and closure references. `httpServer.ts:145–161` uncorrelated public reads request a background version check. This proves a global invalidation/full-reload amplification path, not the number of actual billed rebuilds. No current authenticated website log or provider per-service byte breakdown is available.

Do not simply remove CrawlBatch versioning: status/kind/identity remain relevant to B FAILED/RUNNING HOLD and Novo close handling. Current formal-crawl heartbeat updates CrawlCoordinatorLock (not in these nine tables), so attributing today's traffic to that heartbeat would be wrong. A narrow future batch fingerprint could keep exactly the selected batch fields and skip unused owner/heartbeat fields, but expected saving is unmeasured. A per-source cache reuse can prevent unrelated-source reloads, but needs full CURRENT/GRACE/latest-failed/running/Job-update/closure/rollback equivalence and separate deployment review; not included here.

Official billing definition: https://supabase.com/docs/guides/platform/manage-your-usage/egress ; database-returned data counts as egress; shared-pooler egress is a distinct dashboard service and is not double-counted as database egress. Need organization usage filtered to project yiopvxysxrtrnvqxwgbx and service/date breakdown to attribute the bill. No guessed billing attribution from local disk size.
