# UCB fixed profile: source-only and disabled

This profile binds the native UCB bridge present at parent `36bd3c5a6052159cac47609bbc58750012b74eb0`. It is a compile-time profile, with no runtime source selector. It is not an installed or qualified deployment.

- Source: `source-ucb-china-social`; company: `company-ucb-china`, 优时比中国.
- Config: `0423b01f438925ad3e34e29aeda58fe6353fbd264d4472a09bcb1fba281bd146`.
- Owner: `dot-cloud-ucb-china-social-pilot`.
- The preimport CLI launches `ucb-run-with-owned-publication-pipe.mjs`. Recovery calls the original `evaluateUcbSourceDue`, with the existing 12-hour cadence, five-success flags, unique observation, receipt tuple and exact `crawledAt`/`observedAt` agreement.
- The outcome compiler extracts `readAndVerifyOwnedUcbOutcome` from the original relay. The compiler output is identical to the reviewed original SQL and retains the exact hash check.
- The original safety body, lifecycle, bootstrap 16-field/41-company binding, original Promise retention, one-shot publish, sidecar/receipt checks and seal are retained. The only body change beyond identity substitution passes receipt-verified expected public data to the UCB UI port.

## Phenom and public UI

The original native Phenom pipeline retains `jobSeqNo`, then `reqId`, then `jobId` priority. Persistent IDs are `official-json:sha256:` plus SHA256 of the JSON-encoded raw ID. URL fallback uses `reqId`; a same-origin `applyUrl` can use another path. No URL-to-raw-ID inference is valid.

The original reader exposes href and title, not native sourceJobId. The new pure port copies and freezes the receipt-bound URL-to-ID table once. It reads visible links and original `p` titles inside the fixed UCB company container, joins the observed exact href to the table, and preserves the observed URL/title for comparison. Unknown URLs, duplicate anchors, duplicate expected URLs and inconsistent title membership HOLD. This verifies a public URL/title set with receipt-bound identity labels, not an independently rendered native ID.

Verified native zero remains legitimate: a ready empty list can omit UCB, but the same UCB directory source card must still have the exact visible UTC minute. Loading, wrong count, extra jobs, missing source time and changed consent HOLD. Unknown stale URLs HOLD immediately because the original public reader does not expose their native IDs. No IDs are invented to obtain a reload or PASS.

## Verification boundary

Tests use synthetic external UI ports and the existing sanitized AX grammar. The fixed UI contract is derived from both original 41-company readers (`E6 优时比中国`). Real UCB website, real `job.orz.md` UCB rows, job details and application status have not been checked here. No SQL, network, build, measurement, installation or activation is performed by the profile's small tests. The actual native parsers, source plan/config, reader, catalog and application rules are unchanged.
