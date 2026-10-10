# Explicit Takeda official-connector host mode

This opt-in repairs the existing dot AsyncFunction host and FilePilotRelay path. It does not use the inactive direct controller, a private ledger, a new database profile, credentials or a new transport. The legacy branch remains unchanged. Missing new-mode configuration fails closed. No configuration, task directory, runtime executable or owner state is provisioned by host code.

## Fixed scope

The only new mode is `TAKEDA_PORTABLE_CONNECTOR_V1`, fixed to project `yiopvxysxrtrnvqxwgbx`, `source-takeda-china-social`, `PORTABLE` and `DB_STARTED_JOB_PROJECTION_DELTA_V1`. The original source plan must derive `048f616f00b5ed016f075f4204a2ad749457d68a3f078a9e7bde0fae2186b61f`. The owner ID is the original producer's `CLOUD_PILOT_SOURCE.ownerId`, not evidence that an old process or publication was reconciled.

`JOBFINDER_CONNECTOR_HOST_SHA256` selects only `<repository-parent>/connector-host-bindings/<sha256>.json`. The sole task directory is `<repository-parent>/connector-host-task/relay`. The fixed reviewed Node binary is `<repository-parent>/connector-host-runtime/node`. These are outside the runtime source tree. Configuration cannot select paths, code, loaders, providers or SQL. It has exact keys:

- schemaVersion: 1, kind, enabled: true
- fixed projectId, sourceId, sourceConfigSha256, route, publicationMode and ownerId
- control: the original `{projectId, build, candidate, databaseIdentity}` input
- lockSha256
- entrypointHashes: exact hashes for producer, wrapper, controlCompiler, publicationCompiler and dbStarted; all paths are constants

The configuration directory, task/relay directories and fixed runtime directory require the current non-root UID and mode 0700. Configuration is a single-link regular file with mode 0400. Relay files require mode 0600. All ancestors must be real, known-owner directories without group/other writes; ordinary 0755 system/workspace ancestors remain valid. No code changes permissions. Configuration is checked through an O_NOFOLLOW descriptor, rejects duplicate/prototype keys and is content-addressed. A hash proves byte identity, not user approval or database registration.

## Tool-host startup

The parent loads the reviewed helper/stage source into its existing tool orchestration environment, as before. Its trusted in-memory `cloudPilotHostConfig` supplies mode, bindingSha256, root (this host directory), repo (the original producer directory), and the fixed project. Those existing root/repo paths are checked against the bound host's own location. The JSON cannot override them.

In this mode every helper subprocess goes through the reviewed `connector-host-launch.py` using `/usr/bin/python3 -I`. The launcher does not use PATH to select Node. It verifies the fixed Node 22.23.3 executable's owner, type and SHA-256 before execution, strips inherited Node preload/loader variables, and uses the fixed original tsx API only after full runtime verification. Its fixed network-denial preload prevents file/compiler subprocesses from using sockets, DNS or fetch. Supabase MCP calls remain in the original tool host.

Before context compilation and actual dispatch marking, the host verifies the exact Node profile, clean real Git commit, source/runtime/dependency hashes, control build and fixed entrypoint hashes. The original compiler still derives the full 41-plan identity. Changing these ops files changes the producer build; a local test commit is not remote provenance. Production candidate registration must wait for the final remote commit and freshly qualified runtime.

## Request semantics

READ_CONTEXT compiles the original PORTABLE delta-aware context query. READ_PUBLICATION_CONTEXT must equal that same original compiler output for the bound control. READ_OUTCOME retains the original request/SQL semantics. PUBLISH only produces `AWAITING_PARENT_REVIEW`; it does not mark or dispatch. The existing parent review is still required before calling sqlDispatch. ARCHIVE_STORE and independent lease/pending operations are rejected in the new single-source DB-started mode. Their historical implementations remain in the legacy branch.

Request SHA, original request bytes, expiresAt, dispatchBefore, exclusive `wx` marker, UNKNOWN no-replay, database locks and original wrapper/child deadlines are unchanged. Expired uncertain markers remain readable with next-meta and never become a new dispatch. No deadline is added or restarted. Synthetic fixtures and new empty directories establish no historical clearance. Lost historical request/owner information remains unknown and requires its original read-only reconciliation; no new global authority gate is invented.

The offline tests stub only the connector result. Their positive path executes the real helper command, launcher, fixed Node, file relay and current original compiler. No live SQL, acquisition, reader safety review, production registration or production activation is included.

## Bounded response transfer

The tool helper hashes its actual JSON result with its own pure-JavaScript UTF-8 SHA-256 before any file call. Response parts contain at most 16,000 string characters and use only request-derived fixed names. Every part binds the original request hash, index/count, full digest and total size. Total size is capped at 16 MiB, and all parts/ready/final writes are exclusive mode-0600 writes. Duplicate, out-of-order, missing, mismatched or corrupt parts fail closed. Assembly validates complete JSON and its full byte digest before creating a ready file. Finalization checks the helper's original digest again before creating host-result; only the original relay respond step makes a response visible. No partial file, ready file or interrupted transfer establishes completion or permits a SQL resend.
