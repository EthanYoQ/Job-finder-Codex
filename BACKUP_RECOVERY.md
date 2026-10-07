# Controller template recovery index

This branch preserves the 18 exact source-publication files and their original manifest, plus this recovery index and per-file hashes. Nine Python templates, the facet helper, schema, renderer, recipe and synthetic tests are source-only materials. No workflow or deployment is installed.

Use Python 3.8+ for the offline renderer/tests. Generated controllers retain Python 3.6 syntax; the facet helper expects Node 22. The renderer checks required bindings, source/template hashes, dependency order and Python syntax without executing generated controllers. Its template refusal is removed during generation, so generated controllers and their inputs belong in a private recovery directory.

A trusted private bindings file and the nine expected filename/hash pairs are required to reproduce original Python bytes. Without --expected, reconstruction only matches the supplied configuration. recipe.json originalSourceSha256 is provenance, not an automatic exact-output check. Parameter shape validation does not establish authorized target identity or permission to execute.

Application source/build/runtime, baked identity, trusted original route, terminal receipts, acceptance projections, asset manifest and environment contents remain external private prerequisites. This source backup cannot by itself recover a deployment or authorize a historical attempt. UNKNOWN cannot be retried just by changing bindings.

VALIDATION.json is the author's offline validation summary, not a check performed by this backup process. Here all retained bytes and source dependency links were inspected statically; no renderer, template, test or operational command was run. No private bindings, reconstructed instances, receipts, logs, process snapshots, credentials or environment files are included.
