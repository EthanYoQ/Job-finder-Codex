# Novo e56 settled-timeout producer source delta

This backup contains the exact eight-file reviewed source/test patch from `e815a79bc8478e5400e0b8b66ddf0aa3b285d50f` to `e56e5c52f418376025c657ce35e62c0935c5794e`, the separate offline PORTABLE-entry test and the network-denial helper. It preserves the original patch bytes and SHA-256. This is an increment that requires an existing exact base, not a complete source or operational runtime backup.

## Recover source into an isolated checkout

1. Independently retain the authorized existing e815 baseline, including its existing test fixtures. This backup does not provide that baseline or imply that another GitHub branch fully preserves it. `BASE_AND_PATCH.json` fixes the Git commit/tree, every changed path's before/after identities, unchanged contract files, and required fixture hashes.
2. Prepare a new checkout at that exact baseline with clean tracked files. Keep the old producer and all historical evidence unchanged. Run `python3 verify-snapshot.py` for the backup, then `python3 check-or-apply.py --repository /path/to/new/checkout` for a read-only applicability check.
3. After choosing to apply the source repair, run the same command with `--apply`. It verifies the baseline, performs `git apply --check`, applies the exact patch and verifies all eight resulting files. It does not create candidate commit metadata or a physical build identity.
4. If the baseline or required raw test fixture is missing or mismatched, stop. Do not fill the gap from a different source version or silently substitute a synthetic page for the original fixture.

## Offline tests and their limits

Use already installed matching locked dependencies. Do not download or install dependencies as part of this backup. The pinned Node runtime used for the original focused/PORTABLE checks is v22.23.3. Create `logs/` beside the included `no-network.cjs` before using it with NODE_OPTIONS, since attempted transport calls are recorded there. Keep generated logs out of source backup.

From the isolated producer checkout, with JOBFINDER_CLOUD_SOURCE_ID=source-novo-nordisk-china-social and NODE_OPTIONS set to `--require /absolute/path/to/this/backup/no-network.cjs`, the focused command is:

    /path/to/node-v22.23.3 node_modules/vitest/vitest.mjs run tests/crawler/novoTimeoutAdmission.test.ts tests/crawler/officialHttpSettledTimeout.test.ts tests/crawler/portableSourceCancellation.test.ts tests/scripts/cloudDbStartedDeadline.test.ts --pool=threads --maxWorkers=1

The reviewed focused result was 104/104. The two retained Novo fixtures required by admission tests are already in the exact base and explicitly excluded from this upload. In particular, the raw application-page archive contains CSRF-bearing HTML. Its path/hash is recorded without raw bytes or secret values. The backup must not be represented as a fully self-contained admission-fixture archive.

For the separate PORTABLE verification, copy `tests/scripts/cloudPortableNovoTimeoutEntryVerification.test.ts` into the same relative path of a separate disposable patched producer copy. Run it with the same environment, Node v22.23.3, `--pool=threads --maxWorkers=1`. Its reviewed result was 4/4 and zero SQL calls. It exercises real acquisition/archive/restore/admission code with offline retained inputs, synthetic build identity, synthetic context and a mocked final publication seam. Its COMMITTED_EXACT return is a simulation.

Source typecheck and Vite build passed in review. The full typecheck retained ten baseline-identical test errors. A broad crawler run was incomplete after an IPC error. Four legacy native-A entry tests failed on both baseline and candidate. Therefore this backup does not claim a full-suite pass. See `REVIEW_SCOPE.json` for the exact reported offline counts and boundaries.

## Operational boundary and excluded materials

This source delta is not installed, registered, activated, deployed or published by backing it up. Physical runtime preparation requires the actual dependency tree, source/runtime/build identity recalculation and separately reviewed matching owner/helper r4 integration. Do not reuse the old candidate's build identity, failed batch artifacts or original UNKNOWN state. Preserve the original PORTABLE source selection, 45-second HTTP limit, 20-minute source deadline, 30-minute wrapper deadline and existing proxy/memory contract.

The historical Novo 9f3 backup branch/object reconciliation is a separate stopped workflow. This backup neither resumes it nor uploads that earlier whole-source payload. Only the newly reviewed e56 patch and its necessary source-level verification/support files are included.

Excluded: baseline producer, raw page fixtures, private evidence/reports, test and runtime logs, query results, operational configuration/binding/activation/control/nonce/run data, secrets, binaries and installed dependencies. The patch contains three deliberately synthetic example.test URL token values for redaction tests. Those literals are test data, not credentials; no real credential-bearing URL is included.
