# Refresh error classification source candidate

This is an uncommitted source delta on web-main 964be0f8385e1b5bf2028ab445c1cf0bf7e850a5 and compatible-fallback 3c29c0798de063d141b866c05e5f78f99b922e35. Each role contains four changed or added source/test files and an exact patch. The GitHub backup commit identifies this source snapshot; it is not a newly derived application Git/runtime identity or a deployment.

Restore the matching role baseline from [the incremental application source backup](https://github.com/EthanYoQ/Job-finder-Codex/tree/a47ed7feeb93e99d45633795cb5fecebc8c0818f) and its documented earlier full-source dependencies. Apply the matching patch to that complete role; do not mix the two baselines. All before/after hashes are in SOURCE_BACKUP.json. Exact forward/reverse reconstruction was checked against the already backed-up source bytes without executing application code.

Use the role's existing lockfile, generated Prisma client, Node/TypeScript setup, pg and Vitest dependencies. The new classifier directly imports Prisma error constructors from @prisma/client and DatabaseError from pg; matching installed/generated runtime exports and typings are required. This snapshot contains no dependencies, build output or full baseline.

The classifier retains only closed error type labels, Pdddd codes from matching Prisma classes, explicitly allowed PostgreSQL states and a bounded cause chain. It does not serialize message, stack, metadata or arbitrary thrown objects. Test secret-sentinel strings are deliberately synthetic. The patches add diagnostic fields to the existing failure log; they do not recover original exceptions omitted by older logs. No read, retry or quality-policy change is intended.

The source is an offline candidate. No CI, runtime derivation, registration or deployment was performed for this backup. Original test/typecheck reports, operational README, private runtime inputs, logs, credentials and receipts are excluded. Preserving the tests is not a claim of complete CI acceptance.
