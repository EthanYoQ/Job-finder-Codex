# Launch integration handoff

Use this handoff when resuming the launch-readiness goal on branch `codex/launch-integration` in `.worktrees/launch-integration`.

## Frozen pause point

- Reviewed implementation fixed point: `3f90a624f2b64fed7b1c05c935f84b862c7bc914`.
- At that fixed point the remote tracking branch was 38 commits behind this local branch. This handoff is the next local-only commit. No push was performed in the pause task.
- Issues #2 through #15 remain open in the GitHub tracker. Their open state is not evidence that the code is absent; close or annotate them only after the final reviewed SHA and qualification evidence are published.
- The local Docker daemon was unavailable. GitHub-hosted production-image qualification for the final SHA is still required.
- No project-external scratch path was created by the pause task.

## Completed implementation and review state

- #2 through #9: implementation reviewed with both Spec and Standards axes passing.
- #10: single-server ingress is non-root and read-only, binds one validated hostname, redirects to the correct public TLS authority including a non-default port, rejects unknown Host values, gates ordinary traffic on live `/readyz`, and preserves diagnostic health endpoints. The workflow grants only UID 101 access to private-key fixtures.
- #11: all long-running Compose services have bounded local logs. Required website, database, crawl freshness, mandatory-company, completeness, backup, and restore failures are critical. Backup execution now publishes an atomic `RUNNING`/`FAILED`/`SUCCEEDED` attempt receipt; a new attempt immediately supersedes an older success, and the monitor and backup healthcheck consume that receipt. The real monitoring entrypoint has an identity-bound crawl failure-to-recovery test.
- #12: production security gate was adversarially reviewed and passed.
- #13: backup/restore qualification was adversarially reviewed and passed. The #11 attempt receipt is operational monitoring evidence; it does not replace the stricter restore qualification receipt.
- #14: authoritative launch receipt mechanism was reviewed and passed at the code level. A real `READY` receipt does not yet exist.
- #15: fixed-cohort audit mechanism has no remaining P0/P1 code finding. A real terminal `SCHEDULED` 50-company audit has not been run with the final implementation.

## Evidence at the pause point

- `npm run typecheck`: passed at the implementation fixed point.
- Final #10/#11 reviewer suite: 68 focused tests passed. The last local regression invocation covered 5 files and 66 tests, including strict backup receipt timestamp validation and the production monitoring failure-to-recovery path.
- `tests/ops/backupRestore.test.ts`: 8/8 passes when run alone. On this Windows sandbox it can fail only when run concurrently with other Git-Bash process-heavy files because Git for Windows maps another worker's temporary path through a restricted `/c/Users/EthanQ` mount. Keep this file in a separate Vitest invocation locally; the Linux CI path does not use that mount.
- `docker compose --env-file .env.example -f ops/docker-compose.yml config --quiet`: passed; Docker only emitted an unreadable user config warning.
- `git diff --check`: passed.
- Final adversarial review at `3f90a62`: #10 Spec PASS and Standards PASS; #11 Spec PASS and Standards PASS. Each axis reported P0=0, P1=0, P2=0.
- The final #11 implementation fixes one canonical backup authority at `/backups/latest-backup-attempt.json` for backup, healthcheck, and monitoring. Receipt publishing and reading both require canonical ISO timestamps, `attemptedAt <= completedAt`, and at most five minutes of future clock skew.

## Current reality: not launch-ready

Do not claim “only a server remains” yet. The following qualification evidence is missing:

1. Push the reviewed branch and obtain a green `production-image` workflow for the exact final SHA. Preserve exact image digest, security receipt, restore receipt, and ingress harness artifacts.
2. Run a real terminal `SCHEDULED` batch for the frozen 30 foreign plus 20 domestic manifest, then run `npm run p0:fixed-cohort-audit` against that batch.
3. Treat `.runtime/audit/fixed-cohort-completeness.json` as invalid historical residue: it says `AUDIT_COMPLETE` but has `releaseCandidateId` and `batchId` equal to `UNAVAILABLE`. Never use it as a qualification artifact.
4. Use the new audit report's `repairFrontier` to create same-root-cause tickets of at most five companies. Keep all 30 foreign companies fixed and make each succeed; do not replace a foreign company. Apply the existing adversarial review cycle to every repair ticket.
5. After all 50 have valid A/B completeness evidence, run two formal scheduled rounds with the same manifest/config/adapter/image identity, at least 12 hours apart and with the older round no more than 72 hours old.
6. Generate `npm run p0:authoritative-launch-receipt` using the exact image security receipt, fresh restore receipt, live database snapshot, and the two formal rounds. Only a validated `READY` decision establishes launch readiness.
7. Publish the final reviewed SHA and evidence to GitHub, then update/close tracker issues with links to the authoritative artifacts.

## Resume sequence

1. Verify `git status --short`, current branch, HEAD, remote tracking count, and the recorded final #10/#11 review conclusions.
2. If clean and reviewed, push `codex/launch-integration` and watch the exact-SHA production workflow. Fix failures on a new reviewed commit.
3. Provision only the environment needed for formal qualification; server/domain/TLS/production secrets remain deployment inputs, not substitutes for audit evidence.
4. Execute the real fixed-cohort audit and work only from its current report. Never infer company completeness from repeated counts alone.
5. Finish the repair frontier, two-round qualification, authoritative receipt, and GitHub publication in that order.

Completion criterion: the repository is clean at the pushed reviewed SHA, the exact image workflow is green, the real fixed-50 audit is valid with all 30 foreign companies successful and no substitution, two same-identity formal rounds meet the 12–72 hour window, and the authoritative receipt validates as `READY`.
