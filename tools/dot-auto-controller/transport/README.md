# Restricted automatic publication transport

Local, disabled-by-default implementation for the existing job-finder DB-started publication path. Read `DESIGN.md` for security scope, privilege proposal, deployment blockers and tests. Read `LEDGER_PROPOSAL.md` for the selected same-project durable-fence design.

Files suitable for a reviewed source patch:

- restricted-transport.mjs
- file-journal.mjs
- pg-connection.mjs
- existing-compiler.mjs
- runtime-integrity.mjs
- reader-template.mjs, reader-template.test.mjs
- ledger-contract.mjs, ledger-contract-fields.json, ledger-contract.test.mjs
- proposal/jobfinder-control-ledger.sql
- queries/takeda-c60-reader-before.sql
- restricted-transport.test.mjs
- independent-review.test.mjs
- independent-runtime-integrity.test.mjs
- independent-ledger-review.test.mjs
- independent-portable-compiler-review.mjs
- independent-owned-admission-review.mjs
- privilege-proposal.json
- DESIGN.md, LEDGER_PROPOSAL.md, README.md

Do not package the old absolute-path `existing-compiler.mts`, tsconfig/typecheck scratch logs, network-probe results, independent reviewer scratch files, raw source evidence, node_modules or any credential.

Run the network-free tests with Node 22:

    node --test restricted-transport.test.mjs independent-review.test.mjs independent-runtime-integrity.test.mjs ledger-contract.test.mjs reader-template.test.mjs independent-ledger-review.test.mjs

For the compiler factory, start with the project's pinned Node binary and this package's pure .mjs bootstrap. Do not preload the target checkout's TypeScript loader. The independent builtin-only verifier checks Node, source, runtime and dependencies before registering the now-verified installed TypeScript loader. Provide the trusted checkout root and independently reviewed build/source/dependency pins through deployment configuration. Request data cannot choose this root or the imported modules. Load the complete original producer after this bootstrap using the same default TypeScript loader and canonical module URLs; a separate loader namespace would break live admission WeakMap ownership.

No CLI or server endpoint is provided. There is no generic SQL input. The calling controller must supply the fixed reader/scope implementation, native expected-outcome validation and an approved durable journal. `activated` must be the literal boolean true; text environment values are not accepted as activation.

No live activation is included. The same-project execution ledger is implemented as reviewed proposal SQL only, without live PostgreSQL validation. Its authorized migration/qualification, secure credential provider, actual restricted privileges and permitted network route are still required and must be reviewed and approved before deployment.

Optional native compiler integration test (synthetic HTTP only): set REVIEW_RUNTIME_ROOT to the independently approved producer checkout, JOBFINDER_CLOUD_SOURCE_ID=source-hansoh-social, TSX_DISABLE_CACHE=1 and NODE_DISABLE_COMPILE_CACHE=1, then run independent-owned-admission-review.mjs with the pinned Node binary. It uses mock HTTP plus real acquisition/archive/live-admission/compiler code. It emits no database calls and removes its synthetic temporary evidence.

For a new reviewed build/candidate, pass `expectedReaderCandidateId` through trusted deployment configuration. The entire historical Takeda reader template is still hash-verified; only its single strict candidate-identifier literal is replaced. This preserves a single read-only multi-statement simple query (PostgreSQL extended-query parameters cannot contain multiple commands). Source/config constants and every other byte remain unchanged. The full independent runtime/source/dependency pin is still mandatory. New candidate/profile registration must be reviewed separately; this code does not authorize it.

## Privacy-sanitized capsule

The packaged native and reader trees are privacy-sanitized derivatives: the 51job collector and BI semantic replay fail closed. Historical C60 build constants and the two optional real-runtime fixture scripts describe protected pre-sanitization history only; do not run those scripts against this derivative or treat their earlier pass as its qualification. The compiler factory requires an explicit independently reviewed build, and will not default to the historical build. A new build/candidate and reader deployment identity are mandatory.
