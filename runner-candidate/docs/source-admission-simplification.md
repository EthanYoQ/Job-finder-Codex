# Source admission review — 2026-11-03

Reviewed all 36 active plans from capture through normalization and evidence replay against base `c6aea77`. The change keeps the existing per-source atomic last-good policy. An independently established China location can be admitted without a known city mapping; `locationRaw` is retained and unresolved or conflicting domestic cities become `CITY_PENDING`. Explicit foreign conflicts, unknown country, missing identity and incomplete capture remain failures, never empty successful snapshots.

## Confirmed scope

The following are code-path findings and synthetic reproductions, not claims that every source encountered these failures in production.

| Sources | Confirmed rule and resolution |
| --- | --- |
| AbbVie | Optional work type, expiry placeholder and CSS suffix no longer decide scope; official declared pagination can exceed ten pages. Country and foreign-location evidence remain checked. |
| Amgen, CSL | China-qualified unknown Workday locality can be pending; optional employment and display-date metadata no longer reject a row. Country, requisition and facet reconciliation remain. |
| Biogen, BMS, UCB | Remove finite-city admission; discover Biogen location facets from official evidence. BMS work-style/null/extra-field rules and optional dates no longer control admission. |
| Merck, Lilly, Organon | Remove exact coordinate, address and unused-field requirements. Country and native identity/activity remain authoritative; domestic location disagreements reduce city confidence. |
| AstraZeneca, Novo Nordisk | Province recognition no longer depends on cities present in historical samples. Explicit China and foreign-conflict checks remain; Novo tolerates unused extra metadata. |
| Bayer, Hengrui, Servier, GSK | Shared Moka display projection preserves raw locations and marks unrecognized China localities pending. Bayer/Hengrui/Servier scope no longer requires known city IDs or fixed address exceptions; capture and replay agree. |
| Fosun, Hansoh, Qilu, CTTQ, Shanghai Pharma | China country or established mainland parent can admit a new child locality. Remove fixed county aliases and unrelated full-time gates. Optional dates are omitted rather than fabricated. |
| Kelun | Remove job-ID/title exceptions for nationwide locations and fixed district vocabulary; keep actual country/province evidence and original location. |
| J&J, Sanofi, MSD, Grifols | Known China scope does not require finite city vocabulary or a fixed city suffix. Existing native identity, detail and source-specific anomaly checks remain. |
| Astellas | Read the explicit Location field on any PDF page. Unknown locality needs explicit China evidence; conflicting fields remain unresolved. |
| Boehringer Ingelheim | Remove fixed bilingual city pairs from admission. Known domestic disagreements become pending; country evidence and UI exclusions remain. |
| Novartis | Read functional categories from the captured official form instead of twenty frozen values. Native capture and replay share city projection and reject explicit foreign locations despite a China country column. |
| Gilead | Unknown/missing relative age stays UNKNOWN. Exact age-element structure no longer determines Hong Kong exclusion; actual location still does. |
| Pfizer | Missing optional posted dates no longer fail native or rendered traversal. |
| CR Pharma, CSPC, Daiichi Sankyo, Roche, Takeda, Viatris | No confirmed finite-city gate after positive country evidence on the current route requiring a change. Unknown-country boundaries remain; no blanket accept-unknown rule added. |

## Evidence and limits

- Existing AbbVie six-page archive: all 60 rows validate and normalize; this is replay of saved real bytes, not a new capture.
- Focused synthetic checks exercise new China localities, explicit foreign contradictions, optional metadata, an eleven-page AbbVie capture, Novartis category discovery and full capture/replay, and Lilly's native certificate plus atomic commit. Existing failure-retention and interrupted-commit recovery checks remain passing.
- Changed-source TypeScript diagnostics are empty. This is not a full-project typecheck.
- No new real crawl, database publication or server deployment is established by these tests. Natural scheduled capture remains the production acceptance step.

BI's whole-program AST identity, resource/page/detail bounds, unrelated PDF-document completeness and description-length proxies were investigated but not removed without evidence showing a safe replacement. BI's archived exact native-script fixture is still unavailable locally. These remaining constraints are known limits, not silently declared harmless.

No scheduler, credentials, network policy, queue, database schema or publication architecture changes are included. Novartis capture format advances to version 4; historical evidence is retained, not rewritten or replayed as a new batch.
