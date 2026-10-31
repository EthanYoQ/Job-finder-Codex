# Inactive candidate: reuse a current fallback readback

Prepared 2026-10-30 23:32 UTC. Not activated, deployed, pushed, or remotely backed up.

The only production-code delta is one line in `readback-original-web.py`. If the first search response has no snapshot check token and is already CURRENT, use that response rather than immediately issuing the same search again. All other paths remain unchanged.

This preserves the correlation check for token-bearing responses, the existing UPDATING polling, one failure recovery, and exact search/coverage field comparisons. It neither writes jobs nor changes database queries, schemas, reader versions, routes, or publication rules.

Benefit: one fewer search request per already-CURRENT tokenless readback. It does not remove the costly nine-table version SQL from other webpage requests, and no disk-budget reduction has been measured.

## Offline verification

- `python3 readback-recovery.test.py`: passed all four token/no-token recovery and persistent-failure cases.
- `python3 readback-current-reuse.test.py`: passed five cases: CURRENT/tokenless requires one search; token-bearing CURRENT still requires two; UPDATING still requires its follow-up; job mismatch and coverage mismatch still reject without a success receipt.
- HTTP was fully mocked. No production API or database was called by these tests.

Apply only through the original approved backup and activation process. The active script under `original-relay-automation-20261017T0609Z` is unchanged. This local candidate is not evidence of a production fix.
