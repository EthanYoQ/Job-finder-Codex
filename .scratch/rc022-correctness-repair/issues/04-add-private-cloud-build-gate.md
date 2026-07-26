# 04 — Add the private cloud build gate

**What to build:** Provide a secret-free cloud workflow that builds the committed candidate in a private repository using locked dependencies, generated database client code, typechecking, the full test suite, and the production build.

**Blocked by:** 01 — Enforce City-scoped Search end to end; 02 — Require mainland evidence for Pfizer China jobs; 03 — Align the 55-company gate and restore clean diff.

**Status:** resolved

- [x] The workflow uses locked dependency installation
- [x] Database client generation runs before typechecking
- [x] Typechecking, the full test suite, and production build are required gates
- [x] The workflow contains no credentials, production data, or machine-specific paths
- [x] A later cloud acceptance run can be tied to the exact candidate commit

## Answer

- Added `.github/workflows/private-cloud-build-gate.yml`, triggered by private-repository pushes and `workflow_dispatch`, with only `contents: read` permission.
- It runs on the explicit `ubuntu-24.04` label inside the digest-pinned official Node `22.23.1-bookworm` container, pins checkout/setup-node actions to full commit SHAs, disables checkout credential persistence, and retains only read-only contents permission.
- It checks out full history, uses exact Node 22.23.1 with the npm cache, then runs locked installation, Prisma Client generation, project Prisma validation, typechecking, the full test suite, the production build, and the baseline-to-`HEAD` whitespace check in that order.
- The workflow contains no credential, production-data, artifact-upload, or machine-path configuration. GitHub Actions records the triggering candidate commit for each run, so a later successful cloud acceptance run can be attributed to that exact commit.
