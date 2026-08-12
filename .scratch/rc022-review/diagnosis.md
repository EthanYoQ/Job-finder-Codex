# RC022 Review Diagnosis

## Confirmed symptoms

1. A legacy all-locations request is accepted, suppresses the city predicate, and returns an India/APAC-only job.
2. The strict Pfizer China replay accepts an India-primary job whose only alternate location is `APAC - Any Pfizer Site`.

## Tight feedback loops

```powershell
npm exec -- vitest run tests/server/jobSearchService.test.ts -t "rejects the all-locations sentinel"
npm exec -- vitest run tests/crawler/pfizerStrictCompletenessReplay.test.ts -t "without an explicit mainland China location"
```

Both commands were run three consecutive times after installing locked dependencies and generating Prisma Client. Each run failed deterministically on the exact reviewed symptom; each file completes in roughly two seconds.

## Ranked hypotheses

1. **Confirmed:** the search schema treats every non-empty string as a city, while the query builder gives the legacy sentinel special no-predicate behavior.
2. **Confirmed:** the Pfizer source-bound policy explicitly treats one exact APAC descriptor as a substitute for a mainland descriptor.
3. **Contributing:** the demo filter and discovery interface repeat the all-locations behavior, so fixing only the database query would leave interface drift.
4. **Contributing:** APAC-only normalized output becomes publicly observable specifically because the all-locations route bypasses city filtering.

No runtime instrumentation was required: the deterministic public-seam tests and direct branch conditions distinguish the hypotheses without timing or hidden state.
