# SQL negative selftests off the publication hot path

This is an inactive four-file code delta based on module e0bc3ab81045abf283bb8462640199251c091865 and native111 c44ff2790fa9e5e9edd51d04be116b2da356eca2. It does not activate a task, issue SQL, change a registered producer, or alter a source capture.

## Change

The generic, Biogen, and Hengrui SQL reviewers still run their unchanged verifyFullBody(sql) on the real packet. Their six synthetic malformed-SQL selftests run only when the explicit reviewer option sqlNegativeTests is true. Normal results omit negativeTests entirely. The six original cases and their rejection assertions are unchanged. Source-specific scopeNegativeTests, raw verification, bound identity, context binding, deadlines, and unknown-outcome reconciliation are unchanged.

The existing review-original-publication.mjs has one explicit local phase, packet-only-sql-selftest. It selects the same original reviewer with sqlNegativeTests true and writes SQL_NEGATIVE_SELFTEST.json plus its decoded file. It does not run reader replay, raw replay, target API projection, or publication. The production invocation supplies no selftest phase and continues using packet-only internally.

## Explicit offline entry

With the matching source identity and an unexpired original packet, invoke the existing Node/tsx wrapper with the same RUN, PUBLISH_REQUEST_ID, RELAY, and CONTEXT_REQUEST_ID arguments, followed by packet-only-sql-selftest:

JOBFINDER_CLOUD_SOURCE_ID=<source-id> <original-node> --import <vendor-c60-source>/node_modules/tsx/dist/loader.mjs <module>/review-original-publication.mjs <run> <publish-request-id> <relay> <publication-context-request-id> packet-only-sql-selftest

The ordinary identity and deadline checks remain active. This entry does not retime an expired historical packet. Use a fresh isolated output/run copy when an existing selftest report would conflict with the original exclusive-write behavior.

For expired historical SQL evidence, verification/sql-local-equivalence.mts is the retained bounded comparison harness adapted from the existing 1145 verification. It executes the original compiler/parser closure against saved real packet bytes, then compares the old path, new default path, and explicit offline path. This proves local SQL behavior only, not current release identity or authority to publish. Invocation uses the same original Node/tsx loader, with reviewer filename, workspace-relative historical run path, and an optional original immutable binding JSON path. The helper reads existing evidence and writes only this inactive verification directory.

## Verification scope

- Novartis actual current packet: complete new generic local review passed with current identity and unchanged original deadlines; real decoded rows and report fields matched saved review, apart from reviewedAt and the intentionally absent negativeTests field.
- The same full Novartis review with explicit selftests preserved all six original rejected cases.
- Generic SQL comparison on Novartis and both specialized SQL-parser closures on the saved Hengrui packet: original 7 verifyFullBody calls, normal 1, explicit offline 7; all six negative cases rejected and positive decoded rows unchanged.
- Biogen had no available real Biogen packet. Its common SQL-parser closure was checked using the real Hengrui packet; no full Biogen source/raw review is claimed.
- Nine controlled wrapper branches passed: all three routes in normal, packet-only, and explicit selftest phases. Explicit selftest creates its separate report and launches no reader/raw/target process.
- All three real verifier bodies and all six negative-case bodies were byte-compared unchanged. TypeScript syntax/transpile checks and wrapper syntax passed. Automatic relay, explicit rejection, and Novo hook existing tests passed.
- Existing host-session.test.mjs passes its first five groups but fails its final callbackCommand assertion on both the unchanged 1249 baseline and this delta. The callback's existing capture-time diagnostic command overwrites that test's single captured command. This inherited test was not changed.

No live publish, cloud task activation, external communication, database write, fresh capture, or full scheduled end-to-end run was performed. The active four files were confirmed unchanged after the isolated work.
