# JNJ list-wait failure evidence, inactive

Only `after/jnj-browser-runtime.js` changes. The before/after `jnj-functions.js` copies are unchanged context for the isolated check. The base matches external1616 (`c4a10931c5f8a24d83cc49aba5f09badda7d4a32`) and its frozen module map. Native118, the active external module, and the running loop were not edited.

The observed failure occurred in the existing page-3 heading wait, before the page observation was constructed. This patch catches rejection from the two existing list waits, then reads the current list URL and DOM snapshot independently using the neighboring CSPC failure-state pattern. It retains the actual `String(error)`, expected page URL, page number and observation time. A failed diagnostic read is recorded as its own read error without replacing the original error.

The existing Functions bridge saves the returned page raw, then throws its failure and closes the tabs. No retry, navigation, timeout, deadline, source gate, publication path or success-page schema changes. The original selectors and 30000ms wait arguments are unchanged. A failed page still has no complete manifest and cannot advance into the original producer. The prior missing real page cannot be reconstructed by this change.

`self-check.mjs` uses one artificial page-3 heading failure against both versions and the unchanged Functions bridge. It verifies that page1/2 save normally; the old version loses page3; the new version saves the actual URL (deliberately still page2), DOM and complete error before HOLD; and no retry, detail or manifest follows. It also checks both wait options, two original page advances and tab closure. All browser/tools are artificial. No production raw is included.

Validation: `connector-host-runtime/node self-check.mjs` passes, both after files pass `node --check`, and `git diff --no-index --check before after` has no whitespace errors. `changes.json` names the sole production delta; `MANIFEST.json` hashes this local delivery. The first check exposed and corrected only an artificial patch-decoder off-by-one, then the final check passed.

The parent owns private GitHub backup/readback and activation after the current loop. This package is inactive and does not claim fresh-site or end-to-end acceptance. Diagnostic DOM availability still depends on the existing browser transport; a host-level interruption before the catch returns is outside this small fix.
