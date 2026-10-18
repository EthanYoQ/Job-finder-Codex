# JNJ failed-page identity evidence

Current real run: dot-auto-jnj-20261018T051742251Z. It archived page 1 with 20 distinct legal requisition IDs and all 20 detail originals. The page declares 159 jobs and a next URL for page 2. There is no page-2 original or manifest. The reported JNJ_DOM_DUPLICATE_OR_INVALID_ID joins several conditions: invalid path/ID, wrong origin, credentials, query/hash, or a previously seen ID. The error does not prove which condition occurred. The later page passed earlier heading/range/count/filter assertions, but its missing original prevents attributing it to real duplicates or asynchronous pagination.

This two-file external-only patch fixes that evidence loss at the observed identity branch. It returns the existing unmodified value JSON as raw plus a separate failure string with page, index, id, url and alreadySeen. Functions saves raw first, then throws that failure. No failure fields enter the strict native observation JSON. The original condition, exact ID, scope, total/count and final complete-set checks remain unchanged. There is no deduplication, pagination retry or extra network/browser work.

The next fresh JNJ run is needed to identify the actual failure. This patch does not claim to fix a duplicate or navigation cause. The existing partially mutated seen set is harmless on this terminal HOLD path; no same-page retry is added.

Validation: self-check.mjs uses only artificial DOM values and mocked Functions tools. It proves original duplicate rejection, retained failed raw and exact duplicate diagnostic, rejection of wrong-origin URL, normal valid-page result, and save-before-HOLD with no detail/retry call. self-check.log is PASS. No real browser, HTTP or database calls. Command: /workspace/scratch/5e9614251709/connector-host-runtime/node self-check.mjs.

Only changes.json's two after/ files belong in the external module. before/ preserves current originals. Native source104 identity and active D are unchanged. The sole writer must complete the original private GitHub backup/readback and select the next safe external-module window before activating. No raw production evidence is included in this package or its fixture.
