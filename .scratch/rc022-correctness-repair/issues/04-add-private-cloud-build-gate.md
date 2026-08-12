# 04 — Add the private cloud build gate

**What to build:** Provide a secret-free cloud workflow that builds the committed candidate in a private repository using locked dependencies, generated database client code, typechecking, the full test suite, and the production build.

**Blocked by:** 01 — Enforce City-scoped Search end to end; 02 — Require mainland evidence for Pfizer China jobs; 03 — Align the 55-company gate and restore clean diff.

**Status:** accepted in private cloud

- [x] The workflow uses locked dependency installation
- [x] Database client generation runs before typechecking
- [x] Typechecking, the full test suite, and production build are required gates
- [x] The workflow contains no credentials, production data, or machine-specific paths
- [x] A successful cloud acceptance run is tied to the exact candidate commit

## Answer

- Added `.github/workflows/private-cloud-build-gate.yml`, triggered by private-repository pushes and `workflow_dispatch`, with only `contents: read` permission.
- It runs on the explicit `ubuntu-24.04` GitHub-hosted runner, pins checkout/setup-node actions to full commit SHAs, selects exact Node 22.23.1, disables checkout credential persistence, retains only read-only contents permission, and verifies Docker Compose plus PowerShell before the test suite.
- It checks out full history, uses exact Node 22.23.1 with the npm cache, then runs locked installation, Prisma Client generation, project Prisma validation, typechecking, the full test suite, the production build, and the baseline-to-`HEAD` whitespace check in that order.
- The workflow contains no credential, production-data, artifact-upload, or machine-path configuration. GitHub Actions records the triggering candidate commit for each run, so a later successful cloud acceptance run can be attributed to that exact commit.
- Cloud diagnostic run `30183305170` proved the digest-pinned Node-only job container was too narrow for the repository's full suite because it omitted the hosted runner's Docker Compose, PowerShell, and Git ownership setup. The workflow now uses the explicit hosted runner directly; the failed diagnostic is not acceptance evidence.
- The backup/restore shell-test harness resolves `sh` and `pwsh` from the hosted runner on non-Windows systems and uses POSIX argument forwarding without Git-for-Windows-only `cygpath`; Windows keeps its audited fixed executable paths.
- Cloud diagnostic run `30183824506` passed the hosted toolchain, locked install, Prisma, and typecheck gates, then exposed a Linux-only assumption in the synthetic Docker-provenance repository: `core.fileMode=true` treated the fixture's intentionally mismatched executable bit as dirty before the provenance verifier could test it. The fixture now disables Git's worktree mode comparison so the unchanged production verifier remains responsible for detecting that mismatch.
- Private cloud run `30184101771` succeeded for commit `739165ce62adc3a1e8a55d3b1745142d401cafe3`. It passed the hosted toolchain probe, locked install, Prisma Client generation and schema validation, typecheck, the complete Ubuntu test suite, production build, and baseline-to-candidate diff check.
