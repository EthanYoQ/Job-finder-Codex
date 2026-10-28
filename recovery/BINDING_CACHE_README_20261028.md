# Inactive binding cache candidate

Restore the exact external parent b1d9f581153b43796aa918c934ff1268ecc2521d, then overlay this package. The 64-file mapping in BINDING_CACHE_CANDIDATE_20261028.json preserves every unchanged parent byte. This is a two-file code delta, not a standalone project. Existing restore-module.py maps support/ into the original recovery module, other files into original-relay-automation. Native120 and its dependency/Prisma recovery remain unchanged.

Only successful helper-local binding metadata is cached. Each source constructs a fresh helper. Failures are retried normally; compilation and every dispatch still validate live bindings. Existing atomic locks, source checks, UNKNOWN no-replay and platform permission gates remain.

Fixed Node22.23.3 host-session and automatic-relay fixtures passed. No activation, SQL, collection, task-prompt update, LATEST change or production claim is included. This package contains code and recovery metadata only, no session state, cookies, credentials or raw tool payload.
