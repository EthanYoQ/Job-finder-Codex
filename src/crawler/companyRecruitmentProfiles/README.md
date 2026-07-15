# Company recruitment profiles

This directory is the maintenance boundary between reusable crawl behavior and company-specific official recruitment facts.

- `profiles/` contains one static profile for every company in the fixed 60-company directory.
- A profile owns its executable official source configuration: allowed entry URL, ATS family, Mainland-China social scope, completeness method, failure display policy, and verification note.
- `catalog.ts` is the complete 60-company inventory. `index.ts` validates and freezes it before `sourcePlan.ts` assembles executable plans.
- Live health, last-success times, and publication state stay in the database-backed publication model; they must not be copied into static profiles.

When an official site behaves differently, add a generic capability to the shared adapter and enable it from that company's profile. Do not add new company or source identifiers to shared fetch, parsing, or completeness code. A failed company remains visible with its official entry and does not stop successful companies from publishing.

Changes follow this sequence: reproduce with a failing test, add the smallest profile or generic adapter change, run focused and regression tests, perform a read-only official-site preview, then require two scheduled qualification runs before counting the company as stable.
