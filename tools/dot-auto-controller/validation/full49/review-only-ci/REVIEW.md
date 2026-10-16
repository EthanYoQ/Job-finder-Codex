# Review-only GitHub CI proposal

This file is not an active workflow. No GitHub write, environment startup, container execution or database execution has occurred. Explicit environment approval remains required.

Integration assumptions to review before activation:
- Use the existing JobFinder repository and reviewed schema50 source tree, preserving tools/dot-auto-controller and all 50 canonical migration files. Do not guess a repository, fetch another source snapshot, or omit controller dependencies.
- Copy this delivery's inputs and overlay into tools/dot-auto-controller/validation/full49. That repository integration is not performed here.
- Pin the official actions and official PostgreSQL17 image to verified immutable revisions. Tags here are review placeholders, not independently verified versions.
- Install the committed vendor lockfile; generate the Prisma client locally without contacting a database. The synthetic DATABASE_URL is generation metadata only.
- This proposal creates a new temporary PG17 inside GitHub, with native pgcrypto and synthetic data only. It is a distinct execution environment even though its Unix socket path matches the restricted runner. Matching the path does not imply authorization.
- No production secrets, real user records, TCP listeners, networked PG service or permissions beyond contents:read. Artifact upload contains only synthetic SQL/data and needs to remain in the approved repository's CI audience.

The full49 entry replays all49 unchanged migrations on each fresh database. Each of seven cases commits a real synthetic baseline publisher and creates the next packet from new live admission/context in the same process. The matrix requires seven separate database identities, actual blocking edges, DB clocks, native full-history receipts and post-COMMIT reconciliation. Reduced-fixture results cannot satisfy it.

This draft does not establish runtime compatibility. Failure must stop and retain UNKNOWN evidence. Do not suppress failing migrations, relax canonical guards, substitute WASM digest, reclassify reduced PASS, or rerun an unknown database operation. An independently authorized corrected test run needs a fresh database and new evidence directory.

Even PASS_FULL49_NATIVE_MATRIX is test evidence only: it does not terminate the unknown original v75 request, prove production state, qualify first-install ownership, or authorize deployment.
