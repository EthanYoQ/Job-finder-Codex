# Viatris and CSPC C51 host source snapshots

This snapshot preserves 29 original source, test, provenance, static-template and dependency/reference files each for Viatris and CSPC. It records the frozen preparation sources, not a current runtime or deployment result. Original operational README files are omitted; their hashes remain in SOURCE_BACKUP.json.

## Dependencies and layout

Keep hosts/<source>/host, supervision and verification together. These fragments require the orchestration tools/load/store environment, Linux shell utilities, Python 3, and the exact producer project plus its installed locked dependencies. The producer source identity is 28402a299bb04cbf5873da66c2fe8ca76827c0d1, with parent dfd22f642469888eb781f5e7b93964a60e082ca0. Its seven proxy-runtime source changes and Node v22.23.3 linux-x64 profile are preserved in [the C51 source backup](https://github.com/EthanYoQ/Job-finder-Codex/tree/5820ceb6f1d9b329e11f3619f7bb3156b19f7079); that increment itself depends on the earlier producer source backups. No installed Node binary, dependency directory or complete producer Git history is included here.

Source literals intentionally retain non-secret source/project IDs, absolute paths, namespaces, source/config/build hashes and the C51-compatible binding checks. They must be reconciled with an independently restored, verified environment. Copying source bytes does not establish the original Git or runtime identity.

The static host-config.template.json is included. The actual host-config.json, activation.json, control-base.json and context-read.sql are excluded. Any operational binding/context must be reconstructed through the producer's matching preparation/compiler path using genuine authorized recovery inputs and reverified; the template alone is insufficient. No registration readback, environment/proxy/CA values, credentials, run payload, request, capture, database row or diagnostic output is included.

## Source checks and recovery limits

The sampler, supervisor, HTTP wrapper and launch inspector are bound by the starter's four literal digests. The first, second and fourth sources are retained here; the HTTP wrapper belongs to the exact producer baseline. The supervisor source hash is 083435a5344a47b86f84184bbe1d2711b0d35def4670afb2ab3c8391ed442e7e.

The verification programs are preserved as source. verify-source-host.mjs and verify-runtime-host.mts require the excluded binding files, the complete producer and genuine local compiler/binary identity; they execute local tools and write synthetic files/results. Their presence is not a standalone or read-only test guarantee. Neither these programs nor the hosts were executed for this backup. No full CI, live capture or publication result is asserted.

SAFE_SOURCE_ALLOWLIST.json retains prior-source provenance paths and hashes, including references to excluded files. Those records do not include the referenced private file contents, and are not the current snapshot checksum inventory. SOURCE_BACKUP.json and SHA256SUMS enumerate the included originals. The source manifest archived alongside each original tar was used for verification but is not copied into this source subset.

The inherited ARCHIVE_STORE branch still lacks its separately required helper and is unsupported. This backup does not supply that dependency.

## Static source references

Each host also retains RESTORE_DEPENDENCIES.json and host/source-config-reference.json. These are non-secret static source-plan/provenance and reconstruction inputs, not job rows or runtime activation data. References to source authority, capture eligibility and historical timestamps preserve their original frozen configuration context; they do not establish current readiness. Both static configuration references identify adaptation from matching historical static host configurations, with original provenance hashes retained. This does not restore previous runtime bindings or execution state. Original source names, public official URLs, project IDs, source configuration hashes and provenance paths are retained. Referenced private binding and run files are not included.
