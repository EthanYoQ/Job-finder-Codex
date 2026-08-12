# Initial Code Review

**Fixed point:** `aef05422bc2cba9282eb21ab2cf182a320fc5aea`

**Reviewed target:** `3d26a3ab89abb15503614ba4873dfe5cfb7e51ab`

## Standards

Four findings: one hard preflight failure and three judgement calls.

1. **P3 Hard — clean-diff failure.** One newly introduced trailing space caused `git diff --check` to fail.
2. **P2 Judgement — Repeated Switches / Shotgun Surgery.** Profile-bound source kinds are dispatched independently across fetching, replay, and policy selection, so a new kind requires synchronized edits at several seams.
3. **P2 Judgement — Divergent Change.** One large official-JSON module changes for unrelated providers and company-specific proof policies.
4. **P3 Judgement — Duplicated Code.** Several source fetchers repeat official HTTP request, response, client, and timeout shapes.

No documented repository coding-standard breach was found. The three structure-only findings were retained as separate ready-for-agent enhancement briefs and excluded from the correctness repair.

## Spec

Three findings; initial decision `HOLD`.

1. **P1 — all-locations scope bypass.** The discovery interface offered `全部地点`; the server interpreted it by omitting the city predicate and could return an India/APAC-only job.
2. **P1 — Pfizer China scope error.** Exact `APAC - Any Pfizer Site` evidence could substitute for explicit mainland evidence, allowing an India-primary role to pass completeness.
3. **P2 — partial 55-company PRD update.** The product goal and runtime policy used 55 while four active user-story, implementation, and testing statements still used 45.

The two P1 findings were reproduced through fast public-seam tests three consecutive times each before implementation.

## Summary

Standards: 4 findings; worst P2 judgement call. Spec: 3 findings; worst P1 correctness failure. Correctness repair proceeded only for the two P1 findings, the threshold contradiction, and the clean-diff failure.
