# HTML row document reuse source delta

This snapshot preserves two exact files from application Git commit 0edb12df2ea9b466b25eb388eff1f230636bbd7e, whose direct parent is 28402a299bb04cbf5873da66c2fe8ca76827c0d1, plus the original source-only patch. It records the supplied offline source cutoff, not a later registration, capture or deployment result.

The HTML table adapter passes its existing parsed document into row normalization instead of reparsing the full input once per row. Field, validation and reconciliation logic remains unchanged in this narrow diff. Other helper paths may still parse the document separately. The synthetic tests cover row fields/counts, separate extraction calls and validation losses. This source change is not evidence that repeated parsing was the only cause of a previous out-of-memory failure, or that a live capture has succeeded.

Apply the patch to the exact matching parent source. The prior adapter blob is preserved in [the earlier producer source backup](https://github.com/EthanYoQ/Job-finder-Codex/tree/0c4586b82690203b93475551bd3409e2fbcb1574); restoring the full parent also requires its later source overlays and [C51 proxy/runtime source increment](https://github.com/EthanYoQ/Job-finder-Codex/tree/5820ceb6f1d9b329e11f3619f7bb3156b19f7079). Use the parent's lockfile, Node/TypeScript environment, Cheerio, domhandler, Vitest and shared normalization modules.

This is a source delta, not a complete project, original Git graph or runtime archive. Actual HTML/capture originals, diagnostics, private inputs, dependencies, build/runtime identities, hosts and registration records are excluded. The backup commit must not substitute for the original application commit or registered identity.

Backup checks verified the fixed Git parent and two-path diff, exact before/after hashes, source/secret inspection and forward/reverse/forward patch reconstruction. No source, tests, CI, acquisition, registration or deployment was executed for this backup.
