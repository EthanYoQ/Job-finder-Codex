# Astra C46 and Amgen C47 external host source increment

This independent source archive contains 43 reviewed files: 22 Astra C46 host/preparation/check sources and 21 Amgen source-specific C47 host/check/finalizer sources. It adds no application source beyond the existing [Amgen e5a2a018 candidate archive](https://github.com/EthanYoQ/Job-finder-Codex/tree/2fab322695f71d2e69a6d3c6a8f067725d9c4fb0). It does not change the default branch, deploy services, run CI or restore a registered runtime identity.

## Frozen scope and later status

Astra's frozen preparation manifest SHA256 is `4dc1aaded00630e9baf4eb23d7be11c0e2af82295d1c977d608e230cdd79d9b0`, recorded at 2026-10-05 22:48:33 UTC. Its original preparation state was offline/not launched. The 22 selected source files retain those original bytes; generated report status strings in source are not a claim about later operation.

Amgen's preparation file index SHA256 is `294280a45b897506480955f2e9d17551a727a339efa3c1af146fdfbf1ae83def`. It records preparation and compiled registration before execution. The separate finalizer source is bound by SHA256 `8365fdcfc66fc45b1059f980ad5090554ff36ffa9302013209397ec8a2c1fb0d`.

The publisher's subsequent handoff distinguishes these phases: C47 had been registered by 23:00 UTC, its first capture started at 23:12, and the 23:14 frozen status still had zero accepted successes. Later it reported an exact 50-job commit at 23:18 and public CURRENT 50 at 23:30. Those are later publisher-reported outcomes, not preparation-test results or database reads performed for this backup. The same handoff reports regular C46 at 11 successful sources/1330 current jobs and source-specific Amgen C47 at 1/50. The original earlier offline-candidate backup keeps its own historical cutoff.

## Source and identity boundaries

Astra remains bound to the regular restored producer `fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d` and C46 namespace. Amgen uses candidate source `e5a2a01836fa16669a88fa2604a6ca1a007939fe`, its matching issuer/capture implementation, and an isolated C47 namespace. C47 is source-specific; it does not replace the regular C46 identity or counters.

The original source scope, source-config hashes, official acquisition routes, freshness/12-hour observation gates, bootstrap timing, uncertainty guards and dedicated starters remain pinned. New Amgen host code was compared to the already reviewed C46 Amgen host; differences are its source root, candidate/source Git and namespace bindings. Nonsecret project references, exact candidate IDs, source pins and absolute restoration paths are preserved as code.

The finalizer issues SELECT-only database readback, requires actual zero process exit and exact committed source/batch/receipt hashes, then records local summaries and source-specific C47 state. It is executable operational source, not a saved database response or an automatic execution instruction. External exclusive-publisher ownership remains necessary.

## Review and recovery limitations

All 43 selected file lengths and SHA256 hashes matched their fixed audit inputs. Static review found no embedded credentials, real response payloads or copied private authorization text. Synthetic checks use explicit NONQUAL data. No source or test was executed, no live capture/run data was read for this backup, and no functional/CI pass is implied by source preservation.

`verification/amgen-e5-runtime-20261005T2248Z/derive-identity.mjs` is excluded unchanged because it embeds actual historical database-observation values. Its SHA256 is `432dbacb7e08afe858d95d88ecc9359b609df79148e6643d1a2936f61ceedb6d` and size is 5093 bytes. The archive preserves this exclusion and its recovery gap instead of altering the frozen script. Its build/expectation/history/source-plan and candidate-template outputs must be supplied through a separately authorized identity derivation/recovery process.

Host/control configuration, runtime and registration identity objects, original templates, dependencies and fresh authorized evidence are not included. Preparation/check tools depend on those excluded inputs and cannot be run from this source increment alone. A backup Git commit is not a reusable production runtime identity. The inherited ARCHIVE_STORE audit helper remains absent and that branch unsupported; use the established separate archive flow. Generic preflight launch remains a diagnostic path: use the matching dedicated source starter. Network-block hooks in tests are not a complete process/network security sandbox.

`SOURCE_BACKUP.json` maps every retained source to path, mode, Git blob SHA, SHA256 and byte length; `SHA256SUMS` covers these sources and the new recovery documents. Original broad manifests, reports, configs, registration SQL, actual or generated request/control/DB packets, raw jobs, headers/responses, originals/diffs and internal operation notes are excluded. No active GitHub workflow is included.
