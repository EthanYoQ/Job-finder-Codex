# Sanofi reader replay tools r2 source backup

This snapshot preserves the three unchanged reader source closures, selected synthetic test support, the enum-mapping comparison adapter, a bounded read-only query design, and the r2 replay tools.

See [replay instructions](validation/sanofi-node22-current-20261006/REPLAY_README.md) and [runtime dependencies](validation/sanofi-node22-current-20261006/RUNTIME_REQUIREMENTS.json). Preserve the relative directory layout.

The r2 tools check downloaded engine bytes against the fixed local pins, compare all three complete projections with 88 unique job IDs and original timestamps, and return failure when a child fails, times out or cannot start. Existing result files are preserved before a new invocation.

This is source preservation. It does not include real database snapshots, job projections, result files, credentials, runtime binaries or installed dependencies. Fixed non-secret hashes, IDs and count assertions remain part of the original source. The comparison requires its separately held private input. The unavailable historical fixture remains unavailable.

Restore Node 22.19.0, the locked dependencies and genuine Prisma 6.19.3 client/engines separately. The engine/client preparation scripts cover main and fallback; follow the included instructions to prepare a775. The Node API guard is not operating-system network isolation. Do not infer full application build, full CI, registered runtime identity or deployment readiness from this reader-only closure.

This backup was verified statically and against remote Git objects and bytes. No application, test, query, download-preparation script, CI or deployment was executed as part of creating it. Operational execution requires its own review and authorization.
