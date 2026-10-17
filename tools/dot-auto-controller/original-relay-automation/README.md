# Original relay serial entry

Run `run-original-functions.js` as one Functions async body, on the existing scheduled wake. It loads the original helper/stage and the 60-line serial loop. Its concrete adapters are UCB, Viatris, Biogen and Hengrui; only the first two dedup paths and the Viatris web readback have live execution evidence. It does not claim 36-source coverage.

The entry uses the official Supabase tool for fresh observation deduplication, existing-writer checks, candidate bootstrap and all relay SQL. The existing original P0 producer still owns transactional coordination locks and atomic commit. Existing source bindings must validate against the current registered build; stale bindings hold rather than silently switching versions. Unknown publication results hold for read-only reconciliation, never retry publication.

It reuses original SQL/raw/reader checks and performs exact public API readback. No standalone Node connector, new credentials, background service or deployment is created. The original two-times-daily task remains the real trigger. Actual successful unattended publication and the next scheduled trigger are still required acceptance evidence.

`node automatic-relay.test.mjs` runs the focused serial/single-dispatch/unknown/expiry/isolation/dedup test. `EXECUTION.json` records the live official-connector dedup run; skipped sources are not new successes.
