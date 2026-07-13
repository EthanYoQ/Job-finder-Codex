# Sandoz China candidate implementation report

## Outcome

Sandoz China (`company-sandoz-china` / `source-sandoz-china-social`) is implemented as the next fully automated official-source candidate without changing its company, source, or surface identity. The implementation is code-complete and lossless in tests, but it is **not yet a stable-production claim**: two fresh scheduled observations and a separate read-only reviewer comparison are still required.

No database migration, seed, registry sync, live crawl, lifecycle write, deployment, or `outputs/` mutation was performed by this task.

## Root cause and RED baseline

The previous Sandoz implementation could not prove China completeness because it queried the global job collection and filtered locally, accepted a stale `node--job` resource type, did not bind the live China taxonomy, and did not probe the three alternate-country fields.

The replacement contract was written as failing tests first:

- the new 46-case Sandoz instrumentation suite initially had 34 expected failures and 12 pre-existing safe behaviors;
- registry and source-plan promotion tests initially had 6 expected failures;
- a pagination test exposed that positive official totals needed a narrowly scoped, post-fetch adapter-reconciliation path while every other source remained non-promoting.

The full crawler regression subsequently caught an over-broad first implementation: eight other adapter families would have become eligible. The implementation was corrected so the positive-count opt-in is confined to the canonical Sandoz adapter and source identity; a forged non-Sandoz source remains manual.

## Read-only official observations

The diagnostic probe used the public official entry and kept its bearer value process-only. No token was printed or written.

- official entry: `https://www.sandoz.com/careers/job-search/`, HTTP 200, one token, raw SHA-256 `bfb63968bd1878279d8d8d90a2fcd1bc33e73a4b0d5abfdf71dc60a9c65e3776`;
- China taxonomy: `LOC_CN`, numeric ID `806`, UUID `2f829192-01a9-4909-b729-baab0b0bad0c`, raw SHA-256 `15e8c31a8be282b3d4a6fff133c5aa96cbb6277a68ec8c7862bdcb6109aa8c22`;
- primary China partition: two current `node--jobs` resources (`REQ-10029354`, `REQ-10029352`);
- alternate-country probes 1, 2, and 3: each returned an exact official zero;
- page size was 10, `links.self` was an object link, and the current primary result terminated without a next page.

These observations supported implementation diagnosis only. They are not substituted for scheduled-run evidence or independent review.

## Implemented contract

- Discovers exactly one public entry token and archives only a redacted entry plus the raw-body hash.
- Validates the exact live China taxonomy before any job request.
- Requests the official China partition directly with the fixed `node--jobs` field allow-list; it never derives completeness from the drifting global total.
- Requires all three alternate-country probes to remain exact zeros. A positive alternate result stops certification.
- Enforces exact self/next scope, page-size and total stability, strict termination, and maximum-page failure.
- Uses `field_job_id` as the stable job key and the JSON:API UUID as a second collision guard.
- Rejects stale schemas, malformed country relationships, parse loss, duplicate/colliding IDs, unsafe detail paths, credential-shaped output, and explicit campus markers.
- Canonicalizes detail URLs to the official `www.sandoz.com` origin with a trailing slash.
- Allows a positive official total to become eligible only after lossless fetch accounting and downstream adapter reconciliation, only for the canonical Sandoz source. Other adapters retain their existing manual status.
- Preserves the fixed 30 + 30 roster and both user-authorized exclusions. No company or source identity was replaced and no current job total was hard-coded.
- Rejects weak/manual evidence even if a caller falsely labels it `VERIFIED`; a lossless positive-to-official-zero transition remains valid when both fresh observations are strong.

## Verification

- Final Sandoz and downstream focused run: 5 files, 155 tests passed.
- Cross-adapter regression around positive-count eligibility: 10 files, 568 tests passed.
- Full crawler suite: 65 files, 1,324 tests passed, 2 skipped.
- Full default suite: 135 files, 2,176 tests passed, 3 skipped.
- TypeScript typecheck: passed.
- Diff whitespace check for the exact Sandoz change set: passed.
- No lint command exists in `package.json`.
- Frontend build currently fails outside this task because `src/data/confirmedCompanyRosterV3.ts` imports Node's `createHash` into the Vite browser graph. That separate uncommitted/shared change is not part of the Sandoz implementation and was reported to the parent task.

## Remaining release gates

Sandoz must remain outside a stable-company release count until all of the following are fresh and bound to the released code/configuration:

1. two consecutive scheduled runs both pass the exact contract;
2. a read-only reviewer that did not implement this adapter independently retrieves the entry token and compares taxonomy, exact IDs/titles, official count, termination, and page hashes;
3. the separate frontend build blocker is resolved and the final shared candidate is rebuilt and retested.

The production adapter's own successful run is not independent QA and cannot by itself satisfy these remaining gates.
