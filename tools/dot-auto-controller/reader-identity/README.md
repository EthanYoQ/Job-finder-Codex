# JobFinder reader identity: source-only optional web integration

This package implements a fresh, fail-closed identity endpoint for the actual Node HTTP web application. It has not been deployed. It does not change the application in the repository root, database, credentials, listeners, proxy configuration, or running services.

## Included

- `web-module/src/server/readerIdentity.mjs`: dependency-free Node implementation and pre-import bootstrap.
- `web-module/src/server/readerIdentity.d.mts`: TypeScript interface.
- `integration/main-httpServer.patch` and `integration/fallback-httpServer.patch`: minimal optional adapters for the two frozen web sources, identified by `integration/BASES.json`.
- `test/`: deterministic, synthetic-file tests. Transport is mocked; no live web or database requests.
- `integration/verify-client-contract.mjs`: exercises the actual controller client against real file-measuring test modules.
- `integration/verify-http-integration.mjs`: exercises the actual patched HTTP dispatch without starting a listener.

## Endpoint contract

GET `https://job.orz.md/.well-known/jobfinder-reader-identity.json?nonce=<UUIDv4>`

The main service returns:

```json
{
  "schemaVersion": 1,
  "projectId": "yiopvxysxrtrnvqxwgbx",
  "nonce": "<same request UUIDv4>",
  "checkedAt": "<canonical ISO timestamp>",
  "observedAt": {"main": "<main observation timestamp>", "fallback": "<fallback observation timestamp>"},
  "readers": {"main": "<reader object>", "fallback": "<reader object>"},
  "processes": {"main": "<process object>", "fallback": "<process object>"}
}
```

Each reader object has exactly:

- `role`: `main` or `fallback`
- `readerFileHashes`: observed SHA-256 values for the fixed 19 source/package paths exported by `READER_IDENTITY_FILES`. These must exactly match the controller's independently pinned native-reader plus public-API replay files.
- `build`: observed `manifestSha256` for `build-identity.json`, `entrypointSha256` for `src/server/httpServer.ts`, and `proofModuleSha256` for this module, which also contains the bootstrap and aggregator.
- `runtime`: observed `nodeVersion`, `platform`, and `arch`; each must exactly match the reviewed deployment expectation. No new Node version requirement is introduced for web deployments.

Each process object contains a random module/process-instance UUID and the Node process start time derived from its uptime. No PID, hostname, environment, database URL, credentials, filesystem root, file contents, or absolute paths are returned. The relative source-file keys are a fixed protocol allowlist, not request-selectable paths.

The fallback service returns the same envelope with singular `reader` and `process`, rather than an aggregate. The main service probes only the literal `http://127.0.0.1:3031/.well-known/jobfinder-reader-identity.json` with the same nonce. This is an optional integration for the original fallback topology; no claim is made that its endpoint is currently running. It never creates a fallback listener or follows redirects. Failure, timeout, stale time, missing `no-store`, bad JSON, oversized body, wrong role, or nonce mismatch produces 503 for the whole aggregate. A main-only success is insufficient.

All handled responses include `Cache-Control: no-store, max-age=0`. Non-GET requests return 405. Missing/duplicate/malformed nonce or additional query fields return 400. Missing, changed, unsealed or unverified identity returns 503 with a fixed error code. It never falls back to a static JSON file.

## Deployment boundary and loaded-code protection

1. Review and apply the matching optional HTTP adapter and add both module files to a new web release. These patches do not edit the public API or DB code.
2. Preserve the fixed 19 files in the runtime. In particular, the inspected Docker runtime does not currently copy `package-lock.json`; that packaging difference must be addressed by a separately reviewed deployment change. An absent lockfile is a blocker, not a reason to omit its check.
3. Complete the usual build, then obtain the reviewed build-manifest, patched-entrypoint and proof-module SHA-256 expectations. Keep source provenance commits separate from deployment identity. This endpoint does not invent a deployed Git commit or treat the build manifest's declared commit as independently observed Git HEAD.
4. Provision `reader-identity-expected.json` in each release root from reviewed expectations, with exactly `{schemaVersion:1,projectId,reader}`. The `reader` shape above must be complete. This package intentionally supplies no activating manifest or synthetic production pins. The runtime measures the allowlisted bytes; the manifest is only the expected value, never the measurement source.
5. Run from that release root using the separately reviewed start command `node --import tsx src/server/readerIdentity.mjs`, retaining the existing main/fallback service and port topology. The existing direct `httpServer.ts` entrypoint does not silently enable identity and returns 503 at this endpoint after applying the adapter.
6. The bootstrap captures all fixed observed hashes before dynamically importing the web application; it verifies them and their private file and release-directory identity/mtime/ctime stamps again immediately after the import before starting the service. The retained stamps reject modify-then-restore, same-byte file replacement, and directory-swap restoration inside the release during the import window. Every accepted request re-reads and compares those bytes and the expected manifest. Once drift is observed the process remains failed-closed until a fresh reviewed restart, even if bytes are restored. A later disk edit cannot silently replace the loaded-code baseline.
7. Keep deployment files and the outer release ancestry immutable while loading and running. Release directories are change-stamped; outer directory identities are checked, but their change times are not treated as release changes because unrelated sibling creation updates them. The containing deployment ancestry remains a trusted boundary. Start a fresh Node process with the reviewed bootstrap and trusted loader; do not preload the application or reuse a module cache populated before the baseline. The proof module itself is part of that trusted startup chain. This is authenticated service self-reporting over the original TLS origin, not hardware attestation against a compromised host, loader, Node process or filesystem. The file measurement covers the stated fixed allowlist; `build.manifestSha256` is the hash of the manifest bytes, not a claim that this module independently recomputed the manifest's entire runtime tree.
8. Validate both freshly deployed processes and the original public origin under separate deployment approval before setting the controller's deployment identity config. Config remains inactive until that evidence exists.

No operator-supplied paths or URLs are accepted by the production module. Its release root is derived from its own source location. The expected manifest cannot add a path or replace the allowlist. Symlinks, hardlinks, non-regular files, changed file stamps and oversized files are rejected. One file-observation request and one bounded fallback request can run at a time; overload fails closed rather than queuing unbounded work.

## Offline checks

Use the existing pinned Node 22.23.3 for these checks; no dependency installation is required.

```sh
node --test --test-concurrency=1 test/*.test.mjs
node integration/verify-client-contract.mjs /path/to/controller-source
node --import /path/to/existing/tsx/dist/loader.mjs integration/verify-http-integration.mjs /path/to/isolated-patched-web
```

These checks do not prove deployment or access to production. The HTTP integration verifier only emits an in-process request event; it never calls `listen` or `startServer`.
