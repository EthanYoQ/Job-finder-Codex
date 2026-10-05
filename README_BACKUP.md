# Prepared Novartis heap512 observation host

This source-only snapshot preserves a separate observation copy of the original Novartis portable42 heap512 starter. At the 2026-10-05 12:30 UTC handoff it was prepared and synthetically validated, not launched. Its intended next naturally due window was around 13:02 UTC; that plan is not an automatic launch or a claim that collection occurred.

Observed starter SHA256: `dcb970321afb867e2a65b0ed6749a9fcc37c4ad949a54ba072a77774c40e13f1`. Original starter SHA256: `603bbf116f557d67b828eb118d9ccc9c6a1362f5dad60d928978763cfcb280db`. Sampler SHA256: `18bc3c99319b3af0941b6499bf71b5bfcd7d5808003a6b2c8e8a1a20eae88a85`. These external helper files have no original Git commit and do not replace a registered producer identity.

## Preserved behavior

The only starter changes insert the previously reviewed observation block and pass its wrapped command to exec. Removing that block and restoring the one command argument exactly reconstructs the original starter bytes. The patch was checked against the exact baseline and target. The original source, capture command, heap512, quality and freshness gates are unchanged.

The observer verifies the fixed external sampler path and hash without widening host-file scope, runs alongside the target in the same exec/PID namespace, repeats the bootstrap freshness gate before launch, and preserves the original target's exit code. The old starter, producer files, dependencies and runtime identity remain unchanged.

The inherited early batch guard still applies a character regex directly, allowing JavaScript string coercion. This backup preserves the requested original statements and does not claim to repair that guard. An explicit valid new batch must be set and independently verified before use.

## Reported validation

The author reports nine passing synthetic cases: five actual prelaunch-block cases and four shell cases with bash errexit enabled. They cover good/wrong/failed/still-running sampler hash checks, stale bootstrap, unchanged capture statements and heap512, target exits 0 and 7, and sampler failure preserving both target completion and its original exit. Syntax checks passed, and the author reports the original ten baseline file hashes unchanged.

These are bounded synthetic checks, not full CI or actual Novartis peak-memory measurements. The backup inspected source, hashes, exact reversibility and patch correspondence; it did not run tests, launch a capture, read real metrics or access the database.

## Measurement and recovery limits

The reused sampler verifies an exact root argv token, then follows the root and observed descendants, including known live orphans. It sends no target signals or network requests. Root arguments are checked but not saved. The wrapper requests one-second RSS and five-second PSS sampling. Peaks remain lower bounds; short spikes/processes can be missed, reads are not atomic, and RSS may double-count shared pages. Per-process lifetime VmHWM values are not summed. Independent browser/services are outside attribution, and shared-environment meminfo is not Jb usage.

Seven source/test/patch files are included with this README, SOURCE_BACKUP.json and a fresh restricted SHA256SUMS. The command builder and sampler reuse existing safe GitHub objects. The sampler is stored under memory-observation, while source/tests retain its original fixed absolute path and hash; restore the reviewed placement or obtain reviewed adaptation. The prelaunch test additionally requires the excluded BASELINE.json and its original referenced files, so this archive alone cannot reproduce that test.

Actual run data, metrics, SQL/control/DB/public JSON, raw evidence, credentials, environment, runtime identities, generated dependencies, BASELINE/PREPARED/SELFTEST outputs and internal reports are excluded. SHA256SUMS covers only the other uploaded files, not the original directory inventory. Separate producer/host configuration and authorized inputs are still required for restoration.

This independent branch contains no active workflows and performs no CI, merge, deployment or default-branch update.
