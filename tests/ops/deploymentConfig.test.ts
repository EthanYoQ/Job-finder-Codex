import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const dockerfilePath = resolve(repoRoot, "Dockerfile");
const composePath = resolve(repoRoot, "ops/docker-compose.yml");
const nginxPath = resolve(repoRoot, "ops/nginx.conf");
const backupPath = resolve(repoRoot, "ops/backup.sh");
const monitoringCheckPath = resolve(repoRoot, "ops/monitoring-check.ts");
const httpServerPath = resolve(repoRoot, "src/server/httpServer.ts");

function readRequiredFile(path: string): string {
  expect(existsSync(path), `${path} should exist`).toBe(true);
  return readFileSync(path, "utf8");
}

function readComposeService(compose: string, serviceName: string): string {
  const match = compose.match(
    new RegExp(`^  ${serviceName}:\\n[\\s\\S]*?(?=^  [a-z][a-z0-9-]*:\\n|^volumes:\\n)`, "mu")
  );

  expect(match, `${serviceName} service should exist`).not.toBeNull();
  return match?.[0] ?? "";
}

describe("deployment configuration", () => {
  it("defines the production container stack without publicly exposing postgres", () => {
    const dockerfile = readRequiredFile(dockerfilePath);
    const compose = readRequiredFile(composePath);

    expect(dockerfile).toContain("FROM");
    expect(compose).toContain("postgres:");
    expect(compose).toContain("web:");
    expect(compose).toContain("worker:");
    expect(compose).toContain("scheduler:");
    expect(compose).toContain("nginx:");
    expect(compose).toContain("backup:");
    expect(compose).toContain("monitor:");
    expect(compose).not.toMatch(/5432:5432/);
    expect(compose).toMatch(/4 vCPU/i);
    expect(compose).toMatch(/8 ?GB/i);
    expect(compose).toMatch(/Cloudflare|WAF|CDN/i);
    expect(compose).toMatch(/Aliyun Korea|Korea origin|Seoul/i);
  });

  it("keeps runtime image inputs aligned with worker, scheduler, backup, and monitor commands", () => {
    const dockerfile = readRequiredFile(dockerfilePath);
    const compose = readRequiredFile(composePath);

    expect(compose).toMatch(/"p0:scheduler"/);
    expect(readRequiredFile(resolve(repoRoot, "scripts", "p0-formal-crawl-once.ts"))).toMatch(/npm.*p0:crawl/s);
    expect(compose).toMatch(/npx tsx ops\/monitoring-check\.ts/);
    expect(compose).toMatch(/node dist\/server\/httpServer\.js|"npm",\s*"run",\s*"start"|npm run start/);
    expect(compose).toContain("TRUSTED_PROXY_CIDRS");
    expect(dockerfile).toMatch(/COPY --from=build \/app\/scripts \.\/scripts/);
    expect(dockerfile).toMatch(/COPY --from=build \/app\/src \.\/src/);
    expect(dockerfile).toMatch(/COPY --from=build \/app\/prisma \.\/prisma/);
    expect(dockerfile).toMatch(/COPY --from=deps \/app\/node_modules \.\/node_modules|RUN npm ci(?!\s+--omit=dev)/);
    expect(dockerfile).toMatch(/COPY --from=pg16-client \/usr\/lib\/postgresql\/16\/bin\/pg_dump/);
  });

  it("ships only pinned PostgreSQL 16 backup clients in the runtime image", () => {
    const dockerfile = readRequiredFile(dockerfilePath);

    expect(dockerfile).toContain(
      "FROM postgres:16-bookworm@sha256:da788743d2060767375896de4d646f7576f5911461444b372616f19ea61db2ec AS pg16-client"
    );
    expect(dockerfile).toMatch(/^COPY --from=pg16-client \/usr\/lib\/postgresql\/16\/bin\/pg_dump \/usr\/local\/bin\/pg_dump$/mu);
    expect(dockerfile).toMatch(/^COPY --from=pg16-client \/usr\/lib\/postgresql\/16\/bin\/pg_restore \/usr\/local\/bin\/pg_restore$/mu);
    expect(dockerfile).toMatch(/^COPY --from=pg16-client \/usr\/lib\/postgresql\/16\/bin\/psql \/usr\/local\/bin\/psql$/mu);
    expect(dockerfile).not.toMatch(/COPY --from=pg16-client \/usr\/lib\/postgresql\/16\/bin\/?\s/u);
    expect(dockerfile).not.toMatch(/apt-get install[^\n]*postgresql-client/u);
    expect(dockerfile).not.toMatch(/^ENV PATH=.*postgresql\/16/mu);
    expect(dockerfile).toMatch(/command -v pg_dump[^\n]*\/usr\/local\/bin\/pg_dump/u);
    expect(dockerfile).toMatch(/command -v pg_restore[^\n]*\/usr\/local\/bin\/pg_restore/u);
    expect(dockerfile).toMatch(/command -v psql[^\n]*\/usr\/local\/bin\/psql/u);
    expect(dockerfile).toMatch(/sh -lc[^\n]*command -v pg_dump[^\n]*\/usr\/local\/bin\/pg_dump/u);
    expect(dockerfile).toContain("pg_dump --version | grep -E '^pg_dump \\(PostgreSQL\\) 16\\.14");
    expect(dockerfile).toContain("pg_restore --version | grep -E '^pg_restore \\(PostgreSQL\\) 16\\.14");
    expect(dockerfile).toContain("psql --version | grep -E '^psql \\(PostgreSQL\\) 16\\.14");
    expect(dockerfile).toMatch(/ldd -r \/usr\/local\/bin\/pg_dump/u);
    expect(dockerfile).toMatch(/ldd -r \/usr\/local\/bin\/pg_restore/u);
    expect(dockerfile).toMatch(/ldd -r \/usr\/local\/bin\/psql/u);
    expect(dockerfile).toMatch(/not found\|undefined symbol/u);
    expect(dockerfile).toMatch(/apt-get install[^\n]*libpq5[^\n]*libreadline8[^\n]*util-linux/u);
    expect(dockerfile).toMatch(/command -v flock[^\n]*\/usr\/bin\/flock/u);
    expect(dockerfile).toMatch(/flock --version[^\n]*util-linux/u);
    expect(dockerfile).toContain("flock -n /tmp/flock-build-probe true");
  });

  it("configures nginx no-index protections, rate limits, and denied internal paths", () => {
    const nginx = readRequiredFile(nginxPath);

    expect(nginx).toMatch(/proxy_set_header X-Forwarded-For \$remote_addr;/);
    expect(nginx).not.toContain("$proxy_add_x_forwarded_for");
    expect(nginx).toMatch(/location \^~ \/api\//);
    expect(nginx).toMatch(/location \^~ \/admin\//);
    expect(nginx).toMatch(/location \^~ \/batch\//);
    expect(nginx).toMatch(/location \^~ \/raw\//);
    expect(nginx).toMatch(/X-Robots-Tag\s+"noindex, nofollow"/i);
    expect(nginx).toMatch(/limit_req_zone/);
    expect(nginx).toMatch(/\/api\/|\/admin\/|\/search\//);
    expect(nginx).toMatch(/deny all;/);
    expect(nginx).toMatch(/\/raw\/|\/batch\/|\~ \/\./);
    expect(nginx).toMatch(/locked origin/i);
    expect(nginx).toMatch(/trusted prox(y|ies)|allowlist/i);
    expect(nginx).toMatch(/default deny|deny-by-default|deny all except/i);
  });

  it("ships a monitoring check command that reads env-driven health and database inputs", () => {
    const script = readRequiredFile(monitoringCheckPath);

    expect(script).toContain("/healthz");
    expect(script).toContain("DATABASE_URL");
    expect(script).toMatch(/process\.env/);
    expect(script).toMatch(/process\.exitCode|process\.exit\(/);
    expect(script).toMatch(/readString\(readinessSummary,\s*"latestBackupAt"\)/);
    expect(script).toMatch(/readBoolean\(readinessSummary,\s*"latestBackupSucceeded"\)/);
    expect(script).toContain("readEnvBoolean(\"LATEST_BACKUP_SUCCEEDED\")");
  });

  it("uses a Windows-safe direct-run guard for the HTTP server entrypoint", () => {
    const script = readRequiredFile(httpServerPath);

    expect(script).toContain("pathToFileURL(process.argv[1]).href");
    expect(script).not.toContain("new URL(process.argv[1], \"file:\").href");
  });

  it("runs backup through sh and publishes a validated custom archive", () => {
    const compose = readRequiredFile(composePath);
    const script = readRequiredFile(backupPath);

    expect(compose).toContain("sh ./ops/backup.sh");
    expect(script).toMatch(/pg_dump[^\n]*--format=custom[^\n]*--file="\$PARTIAL_ARCHIVE_PATH"/);
    expect(script).toMatch(/pg_restore --list "\$PARTIAL_ARCHIVE_PATH"/);
    expect(script).toMatch(/sha256sum "\$PARTIAL_ARCHIVE_PATH"/);
    expect(script).not.toMatch(/gzip|\.sql\.gz/i);
  });

  it("initializes backup volume ownership without running backup as root", () => {
    const compose = readRequiredFile(composePath);
    const init = readComposeService(compose, "backup-init");
    const backup = readComposeService(compose, "backup");

    expect(init).toMatch(/user:\s*["']0:0["']/u);
    expect(init).toContain('command: ["install", "-d", "-o", "node", "-g", "node", "-m", "0700", "/backups"]');
    expect(init).toMatch(/source:\s*backup-data[\s\S]*target:\s*\/backups/u);
    expect(init).toMatch(/network_mode:\s*none/u);
    expect(init).toMatch(/read_only:\s*true/u);
    expect(init).toMatch(/cap_drop:\s*\n\s+- ALL/u);
    expect(init).toMatch(/cap_add:\s*\n\s+- CHOWN\s*\n\s+- FOWNER/u);
    expect(init).toMatch(/security_opt:\s*\n\s+- no-new-privileges:true/u);
    expect(init).not.toMatch(/networks:/u);
    expect(init).not.toMatch(/DATABASE_URL|POSTGRES_PASSWORD|environment:|ports:|expose:/u);

    expect(backup).toMatch(/^\s+user:\s*node$/mu);
    expect(backup).toMatch(/backup-init:\s*\n\s+condition:\s*service_completed_successfully/u);
    expect(backup).toMatch(/postgres:\s*\n\s+condition:\s*service_healthy/u);
  });

  it("fails fast on backup errors and healthchecks only recent checksum markers", () => {
    const compose = readRequiredFile(composePath);
    const backup = readComposeService(compose, "backup");

    expect(backup).toMatch(/restart:\s*["']on-failure:3["']/u);
    expect(backup).toContain("set -eu; while true; do sh ./ops/backup.sh; sleep");
    expect(backup).toMatch(/healthcheck:[\s\S]*\.dump\.sha256[\s\S]*-mmin/u);
    expect(backup).toMatch(/start_period:\s*(?:[1-9]\d*s|[1-9]\d*m)/u);
    expect(backup).not.toMatch(/healthcheck:[\s\S]*-name\s+["']\*\.dump["']/u);
  });

  it("falls back to readinessSummary latestBackupAt when crawlSummary omits it", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitoring-"));
    const readinessSummaryPath = resolve(tempDir, "readiness-summary.json");
    const crawlSummaryPath = resolve(tempDir, "crawl-summary.json");

    writeFileSync(
      readinessSummaryPath,
      JSON.stringify({
        latestBackupAt: "2026-07-07T06:00:00.000Z",
        latestBackupSucceeded: true
      }),
      "utf8"
    );
    writeFileSync(
      crawlSummaryPath,
      JSON.stringify({
        latestBackupSucceeded: true,
        consecutiveFailuresByCompany: {}
      }),
      "utf8"
    );

    let stderr = "";

    try {
      execFileSync(
        process.execPath,
        ["node_modules/tsx/dist/cli.mjs", "ops/monitoring-check.ts"],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HEALTHCHECK_URL: "http://127.0.0.1:9/healthz",
            READINESS_SUMMARY_PATH: readinessSummaryPath,
            CRAWL_SUMMARY_PATH: crawlSummaryPath,
            MONITORING_NOW: "2026-07-08T13:00:00.000Z"
          },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
    } catch (error) {
      const result = error as { stderr?: string };
      stderr = result.stderr ?? "";
    }

    expect(stderr).toContain("BACKUP_STALE");
    expect(stderr).toContain("31 hours old");
  });

  it("alerts when no backup evidence exists", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitoring-"));
    const readinessSummaryPath = resolve(tempDir, "readiness-summary.json");
    const crawlSummaryPath = resolve(tempDir, "crawl-summary.json");

    writeFileSync(readinessSummaryPath, JSON.stringify({}), "utf8");
    writeFileSync(crawlSummaryPath, JSON.stringify({ consecutiveFailuresByCompany: {} }), "utf8");

    let stderr = "";

    try {
      execFileSync(
        process.execPath,
        ["node_modules/tsx/dist/cli.mjs", "ops/monitoring-check.ts"],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            HEALTHCHECK_URL: "http://127.0.0.1:9/healthz",
            READINESS_SUMMARY_PATH: readinessSummaryPath,
            CRAWL_SUMMARY_PATH: crawlSummaryPath,
            MONITORING_NOW: "2026-07-08T13:00:00.000Z"
          },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
    } catch (error) {
      const result = error as { stderr?: string };
      stderr = result.stderr ?? "";
    }

    expect(stderr).toContain("BACKUP_MISSING");
  });
});
