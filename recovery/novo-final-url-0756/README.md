# Novo original archive replay: recorded application final URL

Status: isolated and verified; awaiting the original backup owner and safe module switch. No active checker, source candidate, SQL or original batch was modified.

## Exact scope

- Base: external module 0739, canonical commit `2a498b214b99ada897270d9d5cac48c4c9cc90f5`.
- One production path: `support/offline-checkers/replay-original-json-archive.mts`, line 82.
- One expression now returns the archive's exact `finalUrl` for `source-novo-nordisk-china-social` artifacts whose logical key begins `novo-application-`.
- The existing requested URL binding, HTTP 200 requirement, response ordering, timestamp, body hash, source evidence digest, job digest and strict quality replay remain unchanged. `novoApplicationStatus` is unchanged.
- Novo list/entry URL projection and all other source branches retain existing behavior. Persisted sanitized list query values must not be rehashed by passing their archived URL as a live response destination.

## Proven incident and validation

Original batch: `dot-auto-novo-nordisk-20261018T074422261Z`, source candidate 107 / `d6ec709797bb0f2ac68cecb42398238fa631da26`.

The archive contains 86 unique requested URLs, all HTTP 200, and zero retries. The first application response is job `346809.en_GB`, captured `2026-10-18T07:44:56.563Z`. Its recorded official careers destination and body yield ACTIVE. The old external checker discarded this redirect and supplied the original SuccessFactors request URL, producing UNKNOWN. This was not a first-502/later-200 selection error.

The isolated one-expression change fully replayed all 86 originals without network use: 43 list members, 37 valid jobs, 6 validation losses (4 explicit CLOSED and 2 insufficient JD). The source-evidence digest, which includes the exact loss records and their original timestamps, and the jobs digest match the producer. The original strict quality replay passes.

The focused test uses small artificial HTML fixtures, the actual changed expression and the unchanged source parser. It reproduces the old UNKNOWN and validates ACTIVE when the recorded destination is preserved. Missing/wrong final destination, wrong posting ID, wrong city and wrong native requisition remain UNKNOWN/unbound. Other response-selection branches are unchanged. Local logs and evidence paths are in `manifest.json`; raw originals and packet contents are not part of this code delivery.

## Restore and safe handoff

`before/` and `after/` contain exact file images; `novo-final-url.patch` applies to the external module path. Restore only against the exact before hash in the manifest. Do not use the older source repository `review-changes` copy: it is not the current external module owner.

The new small test is an offline regression artifact, not a runtime gate. Place it beside the restored checker and run it with Node's existing tsx loader and the existing vendor source path as its only argument. This small test needs no captured archive or original page. The complete checker also requires its unchanged sibling modules from 0739. It writes a new `review/NATIVE_RAW_REPLAY.json`, so replay only a copy without an existing PASS report.

The backup owner retains the original private GitHub/Drive route and performs remote readback plus restore verification. The controller owner switches only after its existing process has exited and relays are drained. This fixes future fresh captures' verification. The historical batch remains NOT_DISPATCHED and must not be resubmitted, retimed or counted as a success.
