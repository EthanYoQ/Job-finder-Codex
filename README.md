# Publication deadline candidate source delta

Nine changed/new source and synthetic-test files plus their exact patch, frozen 2026-10-06 09:22 UTC. Source base identity: `fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d`.

Restore the corresponding filtered source bytes from [safe base 0c4586b](https://github.com/EthanYoQ/Job-finder-Codex/tree/0c4586b82690203b93475551bd3409e2fbcb1574), then overlay the nine `scripts/`, `src/` and `tests/` files at their original paths. The patch represents the same delta; do not apply it again after overlaying. The filtered base's omissions still apply. This delta alone is not a complete application and does not restore the original Git graph or a registered runtime identity.

Dependencies: Node.js >=22, the base package.json/package-lock.json, TypeScript and Vitest. The two database test suites additionally need a separately installed PGlite module with pgcrypto through `PGLITE_MODULE`; without it their gated suites are skipped. Wrapper tests spawn local child processes and require writable temporary directories and POSIX signals. No dependencies or tests were executed for this backup.

The new wrapper SHA-256 is `f15522e6f209bfe99bfa258b5dffbce1f74d6af662c4c2ee682604e0798bbc88`. It differs from the previous supervisor pin `d8627edbdc118f8d747f77f22459768f76184171e715a8fd29c76a69a3c82930`; compatible supervisor pin updates and new identity validation are separate prerequisites. This candidate has not been registered, wired into the supervisor, or deployed. Early external termination can prevent in-process final reconciliation; later read-only reconciliation may still be required. This archive makes no full-CI or real-database acceptance claim.

SOURCE_BACKUP.json and SHA256SUMS identify the exact file bytes. Runtime inputs, database contents, original captures, credentials, environment values, logs, generated packages and review reports are excluded.
