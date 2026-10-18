# JNJ list-first traversal — inactive external-module handoff

Latest original evidence proves actual boundary overlap: page 1 ends r-105313, page 2 begins r-105313; 40 rows contain only 39 IDs. Both original DOM snapshots agree with their captured result fragments. The prior batch's page 2 instead begins r-105314, and the following 19 rows are identical. No official stable-sort control or parameter was observed. Full local diagnosis: `../readonly-jnj-boundary-overlap-20261018T0636Z/EVIDENCE.json`.

Approved minimal change: collect each complete list page consecutively using the original next-page clicks, then collect the accumulated jobs' details sequentially. This removes the 20-detail (~47 second) interval between list pages. It does not add a request, page, click, retry, sort parameter, concurrent worker, deduplication rule, or alternate source.

Only two external files change:
- jnj-browser-runtime.js keeps the already-validated cards in the existing current array across list pages. rowCount continues to mean the current page's count.
- jnj-functions.js moves the existing detail loop after the final list page. Sample-only retains one list and one detail, with no manifest.

All original heading, page order, exact URL, scope filters, row count, unique ID, declared total, next-link, deadline, detail identity and application-observation behavior remains. A true duplicate still saves its failed page and immediately HOLDs. Native importer jnjCareersDomEvidence.ts already derives capture bounds by min/max artifact times and does not require per-page detail interleaving; no native source/reader/schema change is needed.

## Verification

Run: `../connector-host-runtime/node self-check.mjs`

The artificial check executes both real before/after runtime and Functions code against fake DOM/tools. It proves:
- success: same 2 list URLs and 40 detail URLs, same 42 evidence filenames, only order changes;
- every list precedes every detail, and details remain serial;
- duplicate page is saved and still HOLDs before any detail;
- sample-only requests, files and result are unchanged.

`self-check.log`: PASS. No real browser/HTTP/DB calls. Current active files have not been changed.

## Activation and limits

Back up the exact two files in changes.json using the existing private GitHub/Drive external-module workflow, verify restore, then let the owner atomically update them at its safe source boundary. No native candidate identity changes.

This reduces the pagination time window. It does not prove or repair the site's unexplained single-card replacement; if the official boundary overlap persists, the source must remain HOLD. No new source capture or broad test suite was run.
