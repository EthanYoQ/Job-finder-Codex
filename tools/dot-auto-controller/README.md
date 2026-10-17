# Automatic Job Finder controller: review candidate

This package adds an inactive, source-only controller within the existing dot-hosted architecture. It does not install a scheduler, create credentials, apply a migration, deploy the website, or activate collection. Merge requires code review; live use requires a separately reviewed new runtime/candidate and secure provisioning.

## Implemented path

The Takeda PORTABLE adapter invokes the preserved Takeda acquisition, archive restoration, quality admission, DB-started compiler, transaction mutex and outcome inspector. The worker keeps native ownership objects in one process. An owning supervisor observes the source-derived diagnostics wrapper and its actual child terminal. The new wrapper adds only a bounded live IPC bridge to the original diagnostics behavior; the frozen original remains unchanged. All publication review is programmatic: original SQL reconstruction, exact raw evidence replay, complete main/fallback reader and API projection, and fresh current service identity are required before the one permitted dispatch.

The controller checks the latest accepted real CrawlObservation timestamp for the 12-hour collection interval. Every new run has a fresh batch and bounded control requests. Expiration never extends the original dispatch deadline. Ambiguous transport response, database result and process exit are recorded separately. UNKNOWN is never replayed; a separate recovery entry reads the original tuple. No generic SQL or connector-plugin invocation is embedded in the program.

Completion requires exact native database readback, CURRENT website responses within the 45-second verification budget, all projected fields and coverage, immutable recovery records, and a successful original wrapper/child chain. The private ledger independently verifies the committed native database state before resolution. The still-owning supervisor must retain its in-memory actual ChildProcess terminal capability. Saved JSON, even with a matching checksum and exit-zero fields, cannot recreate that capability. Restart recovery never resolves a ledger or releases the source. A live failed worker can release its local source claim only if its sealed IPC proof says no ledger or publication mutation was ever attempted, the owning supervisor actually reaps both processes within the original deadline, and no stop/signal/duplicate proof occurred. Sealing irrevocably disables later mutation continuations. The program writes a local failure tombstone, preserves prior successful data, and permits a fresh batch on a later cycle. Missing proof, a lost parent, killed process, any mutation attempt, incomplete recovery material or ambiguous result keeps the source held.

Lifecycle remains the original reducer: failed observations preserve last-good GRACE and original times; verified missing observations follow the native ACTIVE/SUSPECTED_OFFLINE/OFFLINE rules. Age alone, including 30 hours, does not hide jobs.

## Scope and limits

- One real adapter is wired: Takeda PORTABLE, inactive and not live-qualified.
- The 36-source routing catalog is explicit. The other 35 adapters are blocked, including GSK's distinct C72 path. This is not a completed 36-source scheduler.
- Native domain, controller, transport, proof and failure-injection tests run offline. A complete Takeda capture-to-live-publication cycle has not been executed for this package.
- The server identity proof and private ledger source are included for review only. They need their own deployment/migration and restricted-role review. No database execution or website deployment is part of this change.
- Unknown runs whose actual original terminal was lost cannot automatically release their source claim. This is a deliberate hold, so the package is not yet fully unattended-ready.
- The native and reader capsules are privacy-sanitized derivatives, quarantined under this tool, and must not be imported into the main app. Six changed files are explicitly identified in SANITIZATION.json and the capsule manifests. Origin commits describe provenance only, not current whole-tree identity or authorization to reuse a historical live candidate. Installing dependencies and creating a new combined build requires new qualification and registration.

## Commands

Use Node 22.23.3. From this directory:

    node run-takeda.mjs --check
    node scripts/offline-tests.mjs
    node --max-old-space-size=1024 node_modules/typescript/bin/tsc --project tsconfig.json

The TypeScript command is an offline validation profile only. Source capture remains at 384 MiB; wrapper/source/HTTP limits remain 30 minutes / 20 minutes / 45 seconds. Tests do not require network or credentials. For offline tests, install from the frozen lock with `npm ci --prefix vendor/c60-source`, then create the local, untracked dependency link `ln -s vendor/c60-source/node_modules node_modules`. The export excludes dependencies and links. Do not preload an unverified loader for a production run.

Production commands are `--run` and `--reconcile <original-batch>`. Both fail closed with the shipped configuration. `VERIFIED_COMPLETE`, `NOT_DUE`, and the inactive status check exit 0. `FAILED_BEFORE_MUTATION` exits 75 with `releaseEligible:true` and `newBatchAllowed:true`: its local claim was released, but the failed cycle is not a successful publication. Other pending/held results also exit 75 and retain their claim; callers must inspect the structured status rather than treating every 75 alike. Exceptions exit 1. Recovery cannot start a new capture or compile/dispatch a new PUBLISH.

## Deployment prerequisites

Keep activation false until all of these are reviewed: a new exact native build/candidate and source identity; pinned Node/dependencies; an approved restricted connection and secret provider; fixed durable private authority with cleanup/restart recovery; source-specific original control files; the private ledger and restricted database privileges; both independently measured service reader identities; and a complete staged end-to-end test. The absence of any prerequisite is a blocker, not a reason to regenerate authority or fall back to a broader transport.

The journal is an extra orchestration fence. The original native SQL transaction remains the publication mutex. Persistent ledger state survives local filesystem cleanup; losing local authority is a hard stop, never permission to retry an unresolved publication.

## Privacy sanitization

The unsupported 51job signed collector is disabled before any HTTP call. BI semantic evidence cannot obtain admission. The signing seed and its request reconstruction were removed, with no replacement, encoding, retrieval path or credential setup. Other source routing remains unchanged: only the inactive Takeda adapter is connected.

Reader identity pins cover the stated 19 files only; they do not attest the entire reader tree. Two additional derivative hashes per reader are checked for local replay. A new full build, deployment identity and candidate are required. Existing endpoint source/security-review status is unchanged and remains incomplete.

The offline suite now also exercises synthetic Takeda HTML acquisition, original runSourceCrawl and B-grade certification, rejects BI across all three capsules with zero HTTP calls, and checks the active source-import closure. The import check distinguishes fixed package source roots from Node builtins and dependencies declared by the locked package tree; quarantined historical helper scripts are not executable entrypoints.

## External deployment binding

The tracked deployment and native catalog stay disabled. A reviewed runtime binding is JSON data outside the repository; it is never imported as code. Set both `JOBFINDER_DEPLOYMENT_PATH` and `JOBFINDER_DEPLOYMENT_SHA256`, or neither. A partial pair is rejected. The allowed path is the fixed sibling `<repository-parent>/deployment-bindings/<sha256>.json`. The directory must be owned by the current non-root Linux UID with exact mode 0700; the single-link regular JSON file must have exact mode 0400. All ancestors must be known-owner real directories without group/world write access. The loader never creates files, changes permissions, scans other paths, or fetches configuration.

The envelope has exact keys `schemaVersion:1`, `kind:"JOBFINDER_TAKEDA_DEPLOYMENT_V1"`, `deployment`, and `takeda`. Deployment has the same keys as the shipped deployment JSON. Takeda allows only `enabled`, `configured`, `candidate`, `build`, `databaseIdentity`, `registration`, and `pins`. Pins use package-relative ordinary-file paths; symlink traversal is rejected. Source/project/route/budgets/producer/Node and every other source remain fixed by reviewed source. Candidate/build/database fields must agree with all 16 registration fields. The native compiler separately derives and compares the original 16-field projection, and fresh database checks remain mandatory.

The process captures the selector pair once, hashes the bytes read from one checked file descriptor, deep-freezes parsed data, and revalidates file identity/content at every scope gate. Children receive the same captured pair. Changing bytes, paths, metadata, or selectors during a run holds the run. Missing external configuration keeps all shipped disabled values; changes to the tracked deployment during a default-mode process are also rejected. A checksum is not authorization, database registration, durable authority, a credential, or production qualification.

There is no new deployment TTL. Existing request, batch, observation, proof, and original-process deadlines remain unchanged. Read-only reconciliation keeps its original expiry behavior and must use the original run's binding digest. Never rotate or rewrite an old binding to renew a request. Control-plane claims/resolution check scope immediately before the actual query after connection setup; the supervisor checks scope again before local closure. File permissions and hashes detect owner changes; they are not an OS-enforced immutable store against same-UID malicious code.

This patch does not activate collection, provision permissions or credentials, or qualify production. New source requires a new remotely verified commit, runtime build and candidate; prior v73/9a0b83a evidence does not qualify this patch. Real socket/driver protocol and multi-connection concurrency qualification remain unverified activation blockers, alongside the existing live prerequisites.

## Retired fixed-host installer

The optional fixed-host installer, generated launchers, and installation acceptance suites are retired. Their recoverable source remains in Git history at 9b86ef37. The retained bootstrap SQL and three UI fixtures still have callers. Normal collection uses the existing vendor/c60-source p0 scripts and relay; this removal does not establish unattended scheduling or a successful production run.
