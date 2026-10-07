# Grifols Node 22 proxy runtime host

This directory's reusable source is listed explicitly in `verification/SAFE_SOURCE_FILE_MANIFEST.json`. Only those listed source files and synthetic test recipes are eligible for the safe source payload. Actual registration rows, control/activation/context files, execution reports and run artifacts are excluded and belong only in the separate private handoff.

The loader pins producer commit `28402a299bb04cbf5873da66c2fe8ca76827c0d1` and its full build identity. The host uses Node v22.23.3. Executing Node version/platform/architecture/binary SHA are checked against the producer's tracked `ops/node-runtime-profile.json`; merely resolving a matching path does not pass. The existing build identity algorithm is unchanged.

The session namespace is `proxyNode22:grifols:`. All Node CLIs use the pinned executable. The environment is inherited; only its PATH gets the Node bin directory prepended. Proxy, CA and NODE_OPTIONS values are not cleared or rewritten. Limits remain bootstrap 60 seconds, outer execution 30 minutes, HTTP 45 seconds and old-space heap 256 MB. No global dispatcher is installed by the host.

`host/machine-json.js` and `host/runtime/machine-json.py` filter only the exact Node UNDICI-EHPA warning line and its immediately adjacent fixed trace hint at machine-JSON boundaries. Raw output is retained. Other stderr/warnings still fail JSON parsing. These parsers are not used for Supabase MCP results, whose existing `rows` parser remains unchanged. Production runner/wrapper stderr and capture files remain unchanged.

The JavaScript helper records raw machine output in `proxyNode22:grifols:lastMachineJsonDiagnostic`. The loader reports its raw runtime proof diagnostic before storing any operational binding. The Python reviewer saves each decoder invocation's exact stdout/stderr in the selected run's `packet-machine-diagnostics.jsonl` before parsing it. Formal preflight retains child stdout/stderr in its report.

The decoder, delta checks, three named constraint gates, deadlines, exact rollback classifier and UNKNOWN boundaries remain. The old unsupported ARCHIVE_STORE branch remains unchanged and fails closed because its Novo-only audit module is absent. The reviewed `--db-started-control` path restores and re-admits local archives; it never invokes that branch.

For local control preparation, run the pinned Node with `--import <producer>/node_modules/tsx/dist/loader.mjs`, set only `JOBFINDER_CLOUD_SOURCE_ID=source-grifols-china-social`, and invoke `host/runtime/prepare-registered-control.mts <owner-registration-readback.json> <new-preparation-directory>` from the producer directory. This verifies the actual runtime, clean frozen build, registration fields and schema identity, then compiles fresh context SQL. It never executes SQL or activates the host. The owner must separately authorize installation of those prepared files.

After owner activation, `host/runtime/load-source-runtime.js` loads only the registered host. The owner chooses an actual fresh batch and supplies `proxyNode22:grifols:nextBatchId`. Only the owner may invoke the stored starter or dispatch a reviewed publication. Do not invent batches or reuse old run/request/freshness state.

The reusable tests are `verification/verify-host-offline.mts` (22 packet/reviewer gates), `verification/verify-runtime-host.mts` (runtime, loader and environment boundaries), and `verification/verify-machine-json.py` (Python stderr boundary). They use synthetic fixtures, no external HTTP and no database. Run them with the pinned Node and Grifols source environment. A synthetic test pass is not production qualification.
