import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  extractProductionImageStage,
  PRODUCTION_BROWSER_DEB_SHA256,
  PRODUCTION_BROWSER_DEB_NAME,
  PRODUCTION_BROWSER_DEB_URL,
  PRODUCTION_BROWSER_KEYRING_DEB_NAME,
  PRODUCTION_BROWSER_KEYRING_DEB_SHA256,
  PRODUCTION_BROWSER_KEYRING_DEB_URL,
  PRODUCTION_BROWSER_KEYRING_VERSION,
  PRODUCTION_BROWSER_RELEASE,
  PRODUCTION_NODE_IMAGE_REF,
  PRODUCTION_RUNTIME_IMAGE_REF
} from "../../src/readiness/productionImageContract";

const read = (path: string) => readFileSync(path, "utf8");

describe("production container contract", () => {
  it("builds generated artifacts explicitly and installs only runtime dependencies", () => {
    const dockerfile = read("Dockerfile");
    const workflow = read(".github/workflows/production-image.yml");
    const packageJson = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(dockerfile).toContain("npx prisma generate");
    expect(dockerfile).toMatch(
      new RegExp(`FROM ${PRODUCTION_NODE_IMAGE_REF} AS deps[\\s\\S]*install-apt-packages\\.sh openssl[\\s\\S]*npx prisma generate`, "u")
    );
    expect(dockerfile).toMatch(/npm ci --omit=dev/u);
    expect(dockerfile).toMatch(
      /FROM build AS identity[\s\S]*RUN rm -rf \/app\/node_modules\s*COPY --from=production-deps \/app\/node_modules \.\/node_modules[\s\S]*generate-build-identity/u
    );
    expect(dockerfile).not.toContain("FROM production-deps AS identity");
    expect(dockerfile).toContain("COPY --chown=node:node --from=identity /app/node_modules ./node_modules");
    const runtimeStage = extractProductionImageStage(dockerfile, "runtime");
    expect(runtimeStage).not.toContain("package-lock.json");
    expect(runtimeStage).not.toMatch(/npm install --global/u);
    expect(runtimeStage).toContain("COPY --from=production-deps /usr/local/bin/node /usr/local/bin/node");
    expect(runtimeStage).toContain("COPY --from=production-deps /usr/local/LICENSE /usr/local/LICENSE");
    expect(runtimeStage).not.toMatch(/COPY --from=production-deps \/usr\/local\s+\/usr\/local/u);
    expect(runtimeStage).toContain('existing_group="$(getent group 1000 | cut -d: -f1 || true)"');
    expect(runtimeStage).toContain('test "$existing_group" = "ubuntu" || test "$existing_group" = "node"');
    expect(runtimeStage).toContain('groupmod --new-name node "$existing_group"');
    expect(runtimeStage).toContain('existing_user="$(getent passwd 1000 | cut -d: -f1 || true)"');
    expect(runtimeStage).toContain('test "$existing_user" = "ubuntu" || test "$existing_user" = "node"');
    expect(runtimeStage).toContain('test "$existing_home" = "/home/ubuntu" || test "$existing_home" = "/home/node"');
    expect(runtimeStage).toContain(
      'usermod --login node --home /home/node --move-home --shell /usr/sbin/nologin --gid 1000 "$existing_user"'
    );
    expect(runtimeStage).toContain("usermod --groups '' node");
    expect(runtimeStage).toContain('test "$(id -u node)" = "1000"');
    expect(runtimeStage).toContain('test "$(id -g node)" = "1000"');
    expect(runtimeStage).toContain('test "$(id -G node)" = "1000"');
    expect(runtimeStage).toContain('test "$(getent passwd node | cut -d: -f6)" = "/home/node"');
    expect(runtimeStage).toContain('test "$(stat -c \'%u:%g:%a\' /home/node)" = "1000:1000:755"');
    expect(runtimeStage).toContain('test "$existing_home" = "/home/node" || test ! -e "$existing_home"');
    expect(runtimeStage).not.toMatch(/&& groupadd --gid 1000 node\s+\\\s+&& useradd/u);
    expect(runtimeStage).toContain('CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/server/httpServer.ts"]');
    expect(runtimeStage).not.toContain("chown -R node:node /app");
    expect(runtimeStage).toContain("COPY --chown=node:node --from=identity /app/node_modules ./node_modules");
    expect(runtimeStage).toContain("install -d -m 0700 -o node -g node /app/outputs");
    const identityCopies = runtimeStage.match(/^COPY --chown=node:node --from=identity .+$/gmu) ?? [];
    expect(identityCopies).toHaveLength(13);
    expect(runtimeStage.match(/^COPY (?!--chown=node:node )[^\n]*--from=identity .+$/gmu)).toBeNull();
    expect(workflow).toContain("test ! -e /usr/local/lib/node_modules/npm && ! command -v npm && ! command -v npx");
    expect(workflow).toContain("scripts/runtime-exposure-probe.mjs > .runtime/security/runtime-exposure-raw.json");
    expect(workflow).toContain("scripts/bind-runtime-exposure-report.ts");
    expect(runtimeStage).toContain(`ADD --checksum=sha256:${PRODUCTION_BROWSER_DEB_SHA256}`);
    expect(runtimeStage).toContain(PRODUCTION_BROWSER_DEB_URL);
    expect(runtimeStage).toContain(PRODUCTION_BROWSER_DEB_NAME);
    expect(runtimeStage).toContain(PRODUCTION_BROWSER_KEYRING_DEB_NAME);
    expect(runtimeStage).toContain(PRODUCTION_BROWSER_KEYRING_DEB_URL);
    expect(runtimeStage).toContain(PRODUCTION_BROWSER_KEYRING_DEB_SHA256);
    expect(runtimeStage).toContain("/tmp/brave-keyring.deb /tmp/brave-browser.deb");
    expect(runtimeStage).toContain(`test "$(dpkg-query -W -f='\${Version}' brave-keyring)" = "${PRODUCTION_BROWSER_KEYRING_VERSION}"`);
    expect(runtimeStage).toContain("test ! -e /etc/apt/sources.list.d/brave-browser-release.list");
    expect(runtimeStage).toContain("test ! -e /usr/share/keyrings/brave-browser-archive-keyring.gpg");
    expect(runtimeStage).toContain("ln -s /usr/bin/brave-browser-stable /usr/bin/chromium");
    expect(runtimeStage).toContain("rm -f /usr/bin/pebble");
    expect(runtimeStage).toContain("rm -rf /var/lib/pebble");
    expect(runtimeStage).toContain("test ! -e /usr/bin/pebble");
    expect(runtimeStage).toContain("test ! -e /var/lib/pebble");
    expect(runtimeStage).not.toContain("PRODUCTION_CHROMIUM_MIN_VERSION");
    expect(runtimeStage).toContain(
      'test "$(dpkg-query -W -f=\'${Version}\' brave-browser)" = "1.93.136"'
    );
    expect(dockerfile).not.toContain("COPY . .");
    expect(packageJson.dependencies?.tsx).toBeDefined();
    expect(packageJson.dependencies?.prisma).toBeDefined();
    expect(packageJson.devDependencies?.tsx).toBeUndefined();
    for (const buildOnly of ["@tavily/core", "lucide-react", "react", "react-dom"]) {
      expect(packageJson.dependencies?.[buildOnly]).toBeUndefined();
      expect(packageJson.devDependencies?.[buildOnly]).toBeDefined();
    }
  });

  it("uses an allowlisted context, non-root runtime, liveness probe, and size guard", () => {
    const dockerfile = read("Dockerfile");
    const dockerignore = read(".dockerignore");
    const packageJson = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    const contextCheck = read("scripts/check-production-image-context.mjs");

    expect(dockerignore.trimStart()).toMatch(/^\*\*/u);
    for (const excluded of [".git", "node_modules", "tests", "outputs", ".scratch", "*.db"]) {
      expect(dockerignore).not.toContain(`!${excluded}`);
    }
    expect(dockerfile).toMatch(/^USER node$/mu);
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("/livez");
    expect(packageJson.scripts?.["image:context-check"]).toBe(
      "node scripts/check-production-image-context.mjs"
    );
    expect(packageJson.scripts?.["image:runtime-contract-check"]).toBe(
      "tsx scripts/check-production-runtime-contract.ts"
    );
    expect(contextCheck).toContain('".docker-build-provenance.bundle"');
    expect(contextCheck).toContain('"testExecutionContract.ts"');
    expect(contextCheck).toContain("MAX_PROVENANCE_BUNDLE_BYTES");
  });

  it("sets private-key permissions before transferring TLS fixture ownership", () => {
    const workflow = read(".github/workflows/production-image.yml");
    const privateKeys = ["privkey.pem", "invalid-tls/privkey.pem", "privkey.next"];

    for (const privateKey of privateKeys) {
      const chmod = `chmod 0640 \"$TEST_DIR/${privateKey.startsWith("invalid") ? "" : "tls/"}${privateKey}\"`;
      const chown = `sudo chown 101:101 \"$TEST_DIR/${privateKey.startsWith("invalid") ? "" : "tls/"}${privateKey}\"`;
      expect(workflow.indexOf(chmod)).toBeGreaterThan(-1);
      expect(workflow.indexOf(chown)).toBeGreaterThan(workflow.indexOf(chmod));
    }
  });

  it("runs the stateful health rate-limit probe only after readiness and TLS renewal checks", () => {
    const workflow = read(".github/workflows/production-image.yml");
    const rateLimitProbe = workflow.indexOf("RATE_LIMITED=0");
    const readinessRecovery = workflow.indexOf('docker exec "$WEB_NAME" rm /tmp/not-ready');
    const tlsReload = workflow.indexOf('docker exec "$NGINX_NAME" nginx -s reload');

    expect(readinessRecovery).toBeGreaterThan(-1);
    expect(tlsReload).toBeGreaterThan(readinessRecovery);
    expect(rateLimitProbe).toBeGreaterThan(tlsReload);
  });

  it("waits boundedly for nginx workers to serve the renewed certificate", () => {
    const workflow = read(".github/workflows/production-image.yml");
    const reload = workflow.indexOf('docker exec "$NGINX_NAME" nginx -s reload');
    const renewalSentinel = workflow.indexOf("RENEWED=0");
    const renewalAssertion = workflow.indexOf('test "$RENEWED" = 1');
    const renewalBlock = workflow.slice(reload, renewalAssertion + 'test "$RENEWED" = 1'.length);

    expect(reload).toBeGreaterThan(-1);
    expect(renewalSentinel).toBeGreaterThan(reload);
    expect(renewalAssertion).toBeGreaterThan(renewalSentinel);
    expect(renewalBlock.match(/for attempt in \$\(seq 1 30\); do/gu)).toHaveLength(1);
    expect(renewalBlock).toContain("--connect-timeout 2 --max-time 3");
    expect(renewalBlock).toContain('--cacert "$TEST_DIR/tls/fullchain.pem"');
    expect(renewalBlock).toContain('"https://$TEST_HOST:18443/" | grep --quiet "host=$TEST_HOST"');
    expect(renewalBlock).toContain("sleep 1");
  });

  it("keeps bootstrap evidence SQL out of nested quoted command substitutions", () => {
    const workflow = read(".github/workflows/production-image.yml");

    expect(workflow).toContain('ADMIN_COUNT="$(docker exec "$POSTGRES_NAME" psql');
    expect(workflow).toContain('AUDIT_COUNT="$(docker exec "$POSTGRES_NAME" psql');
    expect(workflow).toContain('test "$ADMIN_COUNT" = "1"');
    expect(workflow).toContain('test "$AUDIT_COUNT" = "1"');
    expect(workflow.match(/RESTORE_DATABASE_COUNT="\$\(docker exec "\$POSTGRES_NAME" psql/gu)).toHaveLength(3);
    expect(workflow.match(/WHERE left\(datname, 18\) = 'jobfinder_restore_'/gu)).toHaveLength(3);
    expect(workflow.match(/test "\$RESTORE_DATABASE_COUNT" = 0/gu)).toHaveLength(3);
    expect(workflow).not.toMatch(/test "\$\(docker exec/u);
  });

  it("builds restore evidence before making its parent crawl batch terminal", () => {
    const fixture = read("tests/ops/fixtures/restoreQualificationEvidence.sql");
    const begin = fixture.indexOf("BEGIN;");
    const pendingBatch = fixture.indexOf("NULL,'RUNNING');");
    const sourceResult = fixture.indexOf('INSERT INTO "CrawlBatchSourceResult"');
    const job = fixture.indexOf('INSERT INTO "Job"');
    const lifecycleEvidence = fixture.indexOf('INSERT INTO "LifecycleSetEvidenceMember"');
    const terminalBatch = fixture.indexOf(
      'UPDATE "CrawlBatch" SET "finishedAt"=now(),status=\'SUCCESS\' WHERE id=\'restore-batch\' AND status=\'RUNNING\';'
    );
    const commit = fixture.indexOf("COMMIT;");

    expect(begin).toBeGreaterThan(-1);
    expect(pendingBatch).toBeGreaterThan(begin);
    expect(sourceResult).toBeGreaterThan(pendingBatch);
    expect(job).toBeGreaterThan(sourceResult);
    expect(lifecycleEvidence).toBeGreaterThan(job);
    expect(terminalBatch).toBeGreaterThan(lifecycleEvidence);
    expect(commit).toBeGreaterThan(terminalBatch);
  });

  it("returns container-written restore receipts to the runner before host consumption", () => {
    const workflow = read(".github/workflows/production-image.yml");
    const restoreStepStart = workflow.indexOf("name: Qualify a real PostgreSQL 16 backup restore and failure receipts");
    const restoreStepEnd = workflow.indexOf("name: Publish exact-image qualification receipt");
    const restoreStep = workflow.slice(restoreStepStart, restoreStepEnd);
    const receiptPaths = [
      ".runtime/restore/restore-pass-receipt.json",
      ".runtime/restore/restore-failed-corrupt-receipt.json",
      ".runtime/restore/restore-failed-version-receipt.json"
    ];

    expect(restoreStepStart).toBeGreaterThan(-1);
    expect(restoreStepEnd).toBeGreaterThan(restoreStepStart);
    expect(restoreStep).toContain("normalize_restore_receipt() {");
    expect(restoreStep).toContain('restore_root="$(realpath --canonicalize-existing .runtime/restore)"');
    expect(restoreStep).toContain('receipt_real="$(realpath --canonicalize-existing -- "$receipt")"');
    expect(restoreStep).toContain('test ! -L "$receipt"');
    expect(restoreStep).toContain('test -f "$receipt"');
    expect(restoreStep).toContain('test "$(stat --format=%h -- "$receipt")" = 1');
    expect(restoreStep).toContain('sudo chown --no-dereference -- "$(id -u):$(id -g)" "$receipt"');
    expect(restoreStep.match(/normalize_restore_receipt ".runtime\/restore\/.+receipt\.json"/gu))
      .toHaveLength(receiptPaths.length);

    const helper = restoreStep.slice(
      restoreStep.indexOf("normalize_restore_receipt() {"),
      restoreStep.indexOf("docker network create")
    );
    expect(helper).toContain(
      ".runtime/restore/restore-pass-receipt.json|\\\n" +
      "              .runtime/restore/restore-failed-corrupt-receipt.json|\\\n" +
      "              .runtime/restore/restore-failed-version-receipt.json) ;;"
    );
    expect(helper).toContain('case "$receipt_real" in "$restore_root"/*) ;; *) return 1 ;; esac');
    expect(helper).toContain('test "$(realpath --canonicalize-existing -- "$receipt")" = "$receipt_real"');
    const firstSymlinkCheck = helper.indexOf('test ! -L "$receipt"');
    const chown = helper.indexOf('sudo chown --no-dereference -- "$(id -u):$(id -g)" "$receipt"');
    const secondSymlinkCheck = helper.indexOf('test ! -L "$receipt"', firstSymlinkCheck + 1);
    const chmod = helper.indexOf('chmod 0600 -- "$receipt"');
    const readable = helper.indexOf('test -r "$receipt"');
    expect(firstSymlinkCheck).toBeGreaterThan(-1);
    expect(chown).toBeGreaterThan(firstSymlinkCheck);
    expect(secondSymlinkCheck).toBeGreaterThan(chown);
    expect(chmod).toBeGreaterThan(secondSymlinkCheck);
    expect(readable).toBeGreaterThan(chmod);

    const passContainer = restoreStep.indexOf("--env RESTORE_RECEIPT_PATH=/backup/restore-pass-receipt.json");
    const passExitCapture = restoreStep.indexOf('RESTORE_EXIT=$?');
    const passNormalize = restoreStep.indexOf('normalize_restore_receipt ".runtime/restore/restore-pass-receipt.json"');
    const passExitPropagation = restoreStep.indexOf('if test "$RESTORE_EXIT" -ne 0; then exit "$RESTORE_EXIT"; fi');
    expect(passContainer).toBeGreaterThan(-1);
    expect(passExitCapture).toBeGreaterThan(passContainer);
    expect(passNormalize).toBeGreaterThan(passExitCapture);
    expect(passExitPropagation).toBeGreaterThan(passNormalize);

    for (const receiptPath of receiptPaths) {
      const normalize = restoreStep.indexOf(`normalize_restore_receipt "${receiptPath}"`);
      const hostRead = restoreStep.indexOf(`readFileSync('${receiptPath}')`);
      expect(normalize).toBeGreaterThan(-1);
      expect(hostRead).toBeGreaterThan(normalize);
    }
  });

  it("derives failure fixtures inside the container that owns private backup metadata", () => {
    const workflow = read(".github/workflows/production-image.yml");
    const restoreStepStart = workflow.indexOf("name: Qualify a real PostgreSQL 16 backup restore and failure receipts");
    const restoreStepEnd = workflow.indexOf("name: Publish exact-image qualification receipt");
    const restoreStep = workflow.slice(restoreStepStart, restoreStepEnd);

    expect(restoreStep).not.toContain("JSON.parse(fs.readFileSync('$ARCHIVE.metadata.json'))");
    expect(restoreStep.match(
      /docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true[\s\\]+--volume "\$PWD\/\.runtime\/restore:\/backup" "\$IMAGE_TAG" node -e/gu
    )).toHaveLength(2);
    expect(restoreStep.match(/fs\.writeFileSync\(target,JSON\.stringify\(value\),\{mode:0o600,flag:"wx"\}\)/gu))
      .toHaveLength(2);
    expect(restoreStep.match(/source=process\.argv\[1\],target=process\.argv\[2\]/gu)).toHaveLength(2);
    expect(restoreStep).toContain("value.archiveSha256=process.argv[3]");
    expect(restoreStep).toContain('value.database.serverVersionNum="150000"');
    expect(restoreStep).toContain('"/backup/$(basename "$ARCHIVE").metadata.json" /backup/corrupt.dump.metadata.json');
    expect(restoreStep).toContain('/backup/corrupt.dump.metadata.json "$CORRUPT_SHA"');
    expect(restoreStep).toContain('"/backup/$(basename "$ARCHIVE").metadata.json" /backup/incompatible.dump.metadata.json');
  });

  it("runs the two Launch Cohort qualification rounds from one exact image with explicit cross-run state", () => {
    const workflow = read(".github/workflows/production-image.yml");
    const runner = read("ops/run-fixed-cohort-qualification.sh");
    const cleanBuild = workflow.indexOf("name: Build from a clean context");
    const imageReceipt = workflow.indexOf("name: Publish exact-image qualification receipt");
    const resolveRound = workflow.indexOf("name: Resolve Launch Cohort qualification round");
    const runRound = workflow.indexOf("name: Run Launch Cohort qualification round");

    expect(workflow).toMatch(/permissions:\s+contents: read\s+actions: read/u);
    expect(workflow).toContain("startsWith(github.ref, 'refs/heads/qualification/launch-cohort-round-') && 360 || 30");
    expect(resolveRound).toBeGreaterThan(-1);
    expect(cleanBuild).toBeGreaterThan(resolveRound);
    expect(imageReceipt).toBeGreaterThan(cleanBuild);
    expect(runRound).toBeGreaterThan(resolveRound);
    expect(workflow).toContain("refs/heads/qualification/launch-cohort-round-1");
    expect(workflow).toContain("refs/heads/qualification/launch-cohort-round-2");
    expect(workflow).toContain('gh run download "$ROUND_ONE_RUN_ID"');
    expect(workflow).toContain('gunzip --stdout .runtime/formal-input/round-one-qualified-image.tar.gz | docker load');
    expect(workflow).toContain("if: env.REUSE_LAUNCH_COHORT_IMAGE != '1'");
    expect(workflow).toContain('launch-cohort-round-one-${{ github.sha }}');
    expect(workflow).toContain("ops/run-fixed-cohort-qualification.sh");
    expect(workflow).toMatch(/name: Preserve Launch Cohort round-one state\s+if: always\(\)/u);
    expect(workflow).toMatch(/name: Preserve Launch Cohort final evidence\s+if: always\(\)/u);
    const roundOneArtifact = workflow.slice(
      workflow.indexOf("name: Preserve Launch Cohort round-one state"),
      workflow.indexOf("name: Preserve Launch Cohort runner diagnostics")
    );
    expect(roundOneArtifact).toContain(".runtime/formal-state/round-one.dump");

    expect(runner).toContain("scripts/p0-formal-qualification-state.ts verify-files");
    expect(runner).toContain("scripts/p0-formal-qualification-state.ts verify-restored");
    expect(runner).toContain('docker save "$IMAGE_TAG" | gzip -1 > "$state_root/round-one-qualified-image.tar.gz"');
    expect(runner.match(/--evidence-archive/gu)).toHaveLength(3);
    expect(runner).toContain("P0_SCHEDULED_ATTEMPT_TIMEOUT_MS=14400000");
    expect(runner).toContain('test "$decision" = ROUND_ONE_QUALIFIED');
    expect(runner).toContain("trap 'exit 129' HUP");
    expect(runner).toContain("trap 'exit 130' INT");
    expect(runner).toContain("trap 'exit 143' TERM");
    expect(runner).toContain('test "$launch_decision" = READY');
    const secondCrawl = runner.indexOf("run_crawl || crawl_exit=$?", runner.indexOf("else"));
    const backup = runner.indexOf("ops/backup.sh", secondCrawl);
    const restore = runner.indexOf("scripts/qualify-backup-restore.ts", backup);
    const finalImageReceipt = runner.indexOf("scripts/write-image-qualification-receipt.ts", restore);
    const launchReceipt = runner.indexOf("scripts/p0-authoritative-launch-receipt.ts", finalImageReceipt);
    expect(backup).toBeGreaterThan(secondCrawl);
    expect(restore).toBeGreaterThan(backup);
    expect(finalImageReceipt).toBeGreaterThan(restore);
    expect(launchReceipt).toBeGreaterThan(finalImageReceipt);
    expect(runner).toContain("FORMAL_ROUND_ONE_STATE_RECEIPT_PATH=/round-one/round-one-state-receipt.json");
    expect(runner).toContain("FORMAL_ROUND_ONE_AUDIT_PATH=/round-one/round-one-audit.json");
    expect(runner).toContain("FORMAL_ROUND_TWO_AUDIT_PATH=/evidence/round-two-audit.json");
    expect(workflow).toContain("name: Select the Launch Cohort-qualified image receipt");
    expect(workflow).toContain("github.ref == 'refs/heads/qualification/launch-cohort-round-2'");
    expect(runner).not.toMatch(/sleep (?:4[3-9][0-9]{3,}|[5-9][0-9]{4,})/u);
  });

  it("reads the current staged authority using its direct return shape during formal state capture", () => {
    const source = read("scripts/p0-formal-qualification-state.ts");
    const stagedCli = read("src/crawler/stagedCrawlCli.ts");
    expect(source).not.toContain("resolved.authority.identity");
    expect(source).toContain("resolveCurrentBuildingStagedScheduleAuthority");
    expect(source).toContain("authority.identity.releaseCandidateId");
    expect(source).not.toContain('candidate?.status !== "BUILDING"');
    expect(stagedCli).toContain("{ syncLaunchCohortSourcesToDb }");
    expect(stagedCli).toContain("syncPlannedSourcesToDb: syncLaunchCohortSourcesToDb");
  });

  it("provides a repeatable clean Linux build and startup smoke workflow", () => {
    const workflow = read(".github/workflows/production-image.yml");

    expect(workflow).toContain("npm run image:context-check");
    expect(workflow).toContain("npm run image:runtime-contract-check");
    expect(workflow).toContain("npm run docker:export-provenance");
    expect(workflow).toMatch(/docker build[\s\S]*--no-cache/u);
    expect(workflow).toContain("BUILD_COMMIT_SHA=${{ github.sha }}");
    expect(workflow).toContain(".draft == false");
    expect(workflow).toContain(".prerelease == false");
    expect(workflow).toContain("Authorization: Bearer ${{ github.token }}");
    expect(workflow).toContain("brave-browser_1.93.136_amd64.deb");
    expect(workflow).toContain("--read-only --cap-drop ALL --security-opt no-new-privileges:true");
    expect(workflow.match(
      /docker run --rm --network "\$NETWORK" --read-only --cap-drop ALL --security-opt no-new-privileges:true[\s\S]{0,300}node node_modules\/prisma\/build\/index\.js migrate deploy/gu
    )).toHaveLength(2);
    expect(workflow.match(/node node_modules\/prisma\/build\/index\.js migrate deploy/gu)).toHaveLength(2);
    expect(workflow).toContain("--tmpfs /tmp:rw,nosuid,nodev,noexec");
    expect(workflow).toContain("BUILD_SOURCE_CLEAN=true");
    expect(workflow).toContain("BUILD_SOURCE_TREE_SHA256");
    expect(workflow).toContain("docker run");
    expect(workflow).toContain("docker build --platform linux/amd64");
    expect(workflow).toContain("scripts/browser-runtime-smoke.mjs");
    expect(workflow).toContain("/livez");
    expect(workflow).toContain(".Config.User");
    expect(workflow).toContain('IMAGE_USER="$(docker image inspect');
    expect(workflow).toContain('IMAGE_REVISION="$(docker image inspect');
    expect(workflow).toContain('printf \'runtime_user=%s\\nrevision=%s\\nimage_bytes=%s\\nmax_image_bytes=%s\\n\'');
    expect(workflow).toContain(
      `'{{index .Config.Labels "org.opencontainers.image.revision"}}'`
    );
    expect(workflow).not.toContain("docker run --detach --rm");
    expect(workflow).toContain("MAX_IMAGE_BYTES");
    expect(workflow).toContain("MAX_IMAGE_BYTES: 1600000000");
    expect(workflow).toContain("aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25");
    expect(workflow).toContain("npm audit --omit=dev --json");
    expect(workflow).toContain("npm run security:production-gate");
    expect(workflow).toContain("--image-digest \"$IMAGE_DIGEST\"");
    expect(workflow).toContain("production-security-receipt.json");
    expect(workflow).toContain("packages: write");
    expect(workflow.match(/packages: write/gu)).toHaveLength(1);
    expect(workflow).toContain("publish-qualified-image:");
    expect(workflow).toContain("needs: clean-build-and-smoke");
    expect(workflow).toContain("Publish and bind the qualified image manifest");
    expect(workflow).toContain("REMOTE_CONFIG_DIGEST");
    expect(workflow).toContain('test "$REMOTE_CONFIG_DIGEST" = "$LOCAL_CONFIG_DIGEST"');
    expect(workflow).toContain("scripts/write-deployment-image-receipt.ts");
    expect(workflow.indexOf("Publish and bind the qualified image manifest"))
      .toBeGreaterThan(workflow.indexOf("Publish exact-image qualification receipt"));
    expect(workflow).toContain("scripts/bind-npm-audit-report.ts");
    expect(workflow).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    expect(workflow).toMatch(/name: Preserve production security evidence\s+if: always\(\)/u);
    const record = workflow.indexOf("mkdir -p .runtime\n          printf '%s\\n' \"$IMAGE_BYTES\" > .runtime/image-bytes.txt");
    const decomposition = workflow.indexOf("name: Capture exact image size decomposition");
    const upload = workflow.indexOf("name: Preserve production security evidence");
    const sizeGate = workflow.indexOf("name: Enforce recorded production image size");
    const qualification = workflow.indexOf("name: Start in a blank Linux container and probe liveness");
    expect(record).toBeGreaterThan(0);
    expect(decomposition).toBeGreaterThan(record);
    expect(workflow.slice(decomposition, upload)).toContain("image-history.jsonl");
    expect(workflow.slice(decomposition, upload)).toContain("image-directory-bytes.txt");
    expect(workflow.slice(decomposition, upload)).toContain("image-package-kib.txt");
    expect(workflow.slice(decomposition, upload)).toContain("image-package-dpkg-raw.txt");
    expect(workflow.slice(decomposition, upload)).toContain("image-size-identity.txt");
    expect(workflow.slice(decomposition, upload)).toContain('IMAGE_DIGEST="$(docker image inspect');
    expect(workflow.slice(decomposition, upload)).toContain("docker history --no-trunc --human=false");
    expect(workflow.slice(decomposition, upload)).toContain("--network none --user 0 --read-only --cap-drop ALL");
    expect(workflow.slice(decomposition, upload)).toContain("--cap-add DAC_READ_SEARCH");
    expect(workflow.slice(decomposition, upload)).toContain("--entrypoint dpkg-query");
    expect(workflow.slice(decomposition, upload)).toContain("'--showformat=${db:Status-Abbrev}\\t${Installed-Size}\\t${Package}\\t${Version}\\t${Architecture}\\n'");
    expect(workflow.slice(decomposition, upload)).toContain("awk -F '\\t' '$1 == \"ii \"");
    expect(workflow.slice(decomposition, upload)).toContain('size=($2 == "" ? "UNKNOWN" : $2)');
    expect(workflow.slice(decomposition, upload)).toContain("END { if (count == 0) exit 1 }");
    expect(upload).toBeGreaterThan(record);
    expect(upload).toBeGreaterThan(decomposition);
    expect(sizeGate).toBeGreaterThan(upload);
    expect(qualification).toBeGreaterThan(sizeGate);
    expect(workflow.slice(sizeGate, qualification)).toContain("if: always()");
    expect(workflow.slice(sizeGate, qualification)).toContain('test "$IMAGE_BYTES" -le "$MAX_IMAGE_BYTES"');
    expect(workflow).toContain("--package-inventory .runtime/security/image-package-kib.txt");
  });

  it("keeps the declarative browser asset consumers bound to the single TypeScript contract", () => {
    const dockerfile = read("Dockerfile");
    const workflow = read(".github/workflows/production-image.yml");
    for (const consumer of [dockerfile, workflow]) {
      expect(consumer).toContain(PRODUCTION_BROWSER_RELEASE);
      expect(consumer).toContain(PRODUCTION_BROWSER_DEB_NAME);
      expect(consumer).toContain(PRODUCTION_BROWSER_DEB_URL);
      expect(consumer).toContain(PRODUCTION_BROWSER_DEB_SHA256);
    }
    expect(dockerfile).toContain(PRODUCTION_BROWSER_KEYRING_DEB_NAME);
    expect(dockerfile).toContain(PRODUCTION_BROWSER_KEYRING_DEB_URL);
    expect(dockerfile).toContain(PRODUCTION_BROWSER_KEYRING_DEB_SHA256);
  });

  it("rejects drift in every pinned build and runtime base stage", () => {
    const dockerfile = read("Dockerfile");
    for (const stage of ["deps", "production-deps", "runtime"] as const) {
      const expectedRef = stage === "runtime" ? PRODUCTION_RUNTIME_IMAGE_REF : PRODUCTION_NODE_IMAGE_REF;
      expect(extractProductionImageStage(dockerfile, stage)).toBeTruthy();
      expect(() => extractProductionImageStage(
        dockerfile.replace(`FROM ${expectedRef} AS ${stage}`, `FROM ubuntu:latest AS ${stage}`),
        stage
      )).toThrow(/pinned/u);
    }
  });
});
