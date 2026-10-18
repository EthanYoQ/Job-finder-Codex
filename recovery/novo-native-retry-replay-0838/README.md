# Novo archived native-retry consumption

Frozen INACTIVE external candidate based on module0819. Only the two production paths in changes.json are changed. No active source, capture, DB operation, publication, original batch, receipt, deadline or artifact is changed.

## Change

- replay-original-json-archive.mts selects the Novo-only offline archive helper. The other-source HTTP200 assertion, exact archive/file hashes, original native quality replay, exact source-evidence/jobs digests and receipt verification remain in place. The old now-unreachable Novo finalUrl condition is removed from the generic branch; the new helper retains that exact successful application finalUrl.
- original-novo-archive-replay.mts consumes the saved failure, saved RETRY_START and saved successful response in one native slot. It calls the original gateway/timeout parser and artifact writers to rebuild and exactly compare the failure/start records. It supplies only the existing successful response to the original fetch, then restores the retained failure/start records in order. The complete original artifact sequence, metadata and bytes must match. No retries, clocks, request-timeout ownership or receipts are synthesized by production code. The original strict Novo reader remains the owner of sequence, same-request binding, deadlines and 10s/45s/20min limits.

Requires the separately frozen native helper change cb901e51049c64a5ddf8c2a8383508254d290390 before activation. The runtime helper used here is byte-identical to that frozen source candidate. This package grants no activation or publication authority.

## Verification

- focused-tests.log: 14 focused cases passed. Original native synthetic transport/fixtures cover happy path, same-requisition official job-invite HTTP502 then200, and owned settled no-response timeout then200, all with exact reconstructed evidence/jobs and original admission/atomic checks. Missing failure/start/success, wrong order, duplicates, changed failure bytes, headers, source deadline, late success, second502 and wrong invite ID are rejected.
- fullchain-tests.log: 2 full synthetic chains passed, one gateway retry and one timeout retry. Both use the original owned native transport, original source admission, atomic compiler, exact whole SQL packet recompilation with six negative mutations, both pinned readers, the new archived raw replay and both target API projections. Each has2 visible jobs and9 recorded requests. All original digest, freshness, git/build identity and runtime-profile checks remain active.
- The synthetic full-chain runtime has a real clean local test-only git commit and independently computed actual source/runtime build identity. Its TypeScript source is executed through the existing tsx loader under the verified Node22.23.3 binary. Existing dist is included only as the original runtime-hash input and is not executed. No dependency is installed and no build/network request is made. The fixed test clock belongs only to this clearly marked synthetic harness.
- historical-regression.log: a separate copy of the unchanged080715056Z real archive passes the new helper without retry. The full original packet/readers/raw/project chain passes with86 artifacts,4 retained historical closures,15 before jobs matching the real captured public response and37 after jobs. This is EXPIRED HISTORICAL REPLAY ONLY at its previously successful08:22:24.777 review clock. Its original dispatchBefore08:32:33.333 and expiry08:35:18.333 stay unchanged. It provides no current publication eligibility.

## Backup boundaries

Production whitelist: changes.json and its two after/support files. novo-native-retry-replay.patch is the exact frozen diff. README.md and verification-summary.json may accompany the code. The test source, test-checkers, real-checkers, runtime, synthetic-* and historical-0807-regression trees are local diagnostic/test material, not production changes. Do not upload real archive bytes, original contexts, reader snapshots or SQL packets to GitHub.

No live retry outcome has been claimed. The082755747Z failed run lacks a subsequent real success and remains incomplete and unpublished. No live HTTP, DB, activation, or publication was tested.
