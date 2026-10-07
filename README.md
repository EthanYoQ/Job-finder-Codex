# Astellas and Takeda C51 source-only package

This package preserves selected host and continuous-owner source, unbound templates, synthetic test fixtures, and four static source/source-plan snapshots. Selection is the fixed 130-entry source-allowlist.json. Its exact SHA-256 is embedded in safe_source.py. Neither script discovers source from a live host, a producer checkout or a prior report.

The two control templates retain the original C51 build and database identity pins; candidate is null. Host configuration is supplied only as a non-secret template. Context SQL contains OWNER_REGISTERED_C51_CANDIDATE_ID. Actual activation, control, context, nonce, run directories, bytecode, source-config-reference, historical holds, authority-result reports, private input inventories and operational summaries are excluded. This package makes no claim about source execution or publication.

## Verify the checked-out source

Use Python 3 from this package directory:

    PYTHONDONTWRITEBYTECODE=1 python3 safe_source.py verify-tree sources
    PYTHONDONTWRITEBYTECODE=1 python3 test_safe_source.py

Verification reads only the explicit source tree and the fixed allowlist. It checks exact bytes, required unbound templates, original C51 database/build pins, canonical hashes of the complete source plans, and all 65 owner mappings, including the unchanged prior 55. It never executes the packaged host/producer code, accesses a database or resolves the absolute runtime paths recorded inside that source.

The tests use temporary synthetic copies. They cover a safe round trip, extra reports/bytecode/run directories/bindings/nonces, missing templates, modified files or allowlist, path traversal, file/directory symlinks, output-parent symlinks, existing destinations, tar links, duplicate members and template/source/mapping inconsistency. Temporary test products are not publication inputs.

## Pack and restore only this source set

    PYTHONDONTWRITEBYTECODE=1 python3 safe_source.py pack sources source-only.tar.gz
    PYTHONDONTWRITEBYTECODE=1 python3 safe_source.py restore source-only.tar.gz new-source-tree

Both output paths must be new. The verifier rejects every unlisted tar member and every unlisted file or directory in a staged source tree. Symlinks, hardlinks, traversal, duplicate tar members and missing required members are rejected before restoration. Enumeration checks for extras; only explicit allowlist entries can be selected for output.

For the one-time migration from the separately held frozen input archive, extract-frozen accepts only the exact inputArchiveSha256 recorded in the allowlist. It selects the 130 listed members from that sealed archive, verifies every selected byte, and writes a new source tree. It does not rescan or read current runtime paths. The original input archive is not part of this source-only publication.

## Runtime and authority limits

DEPENDENCIES.json records the non-secret C51 pins and separately required runtime dependencies. The older host and owner synthetic test sources are preserved for a future clean reconstruction at their encoded absolute runtime root. They require the exact producer, locked Node dependencies and pinned Node binary, which are not included here. They are not run by the source-only verifier, and this export makes no new claim that those runtime tests have run.

Current official registration, fresh due/lock/bootstrap state and actual bindings remain separate owner responsibilities. Re-verifying historical official authority would also require private provenance inputs deliberately omitted here. This package's source-plan consistency check is independent of those inputs and is not a substitute for that authority verification. Never reconstruct actual state from a source-only package or treat an absent report as a successful check.

## Publication inputs

make_publish_plan.py admits only these six recipe files and the 130 allowlisted source members. It writes a source-plan.json for a publisher to review, hash-check and use. Local archives, extraction/audit/test output and delivery receipts are excluded. Adding any member or changing the allowlist requires a new reviewed source selection and new hashes; there is no recursive inclusion rule.
