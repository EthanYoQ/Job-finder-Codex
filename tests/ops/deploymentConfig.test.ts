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
const monitoringCheckPath = resolve(repoRoot, "ops/monitoring-check.ts");

function readRequiredFile(path: string): string {
  expect(existsSync(path), `${path} should exist`).toBe(true);
  return readFileSync(path, "utf8");
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

    expect(compose).toMatch(/npm run p0:crawl/);
    expect(compose).toMatch(/npx tsx ops\/monitoring-check\.ts/);
    expect(compose).toMatch(/node dist\/server\/httpServer\.js|"npm",\s*"run",\s*"start"|npm run start/);
    expect(dockerfile).toMatch(/COPY --from=build \/app\/scripts \.\/scripts/);
    expect(dockerfile).toMatch(/COPY --from=build \/app\/src \.\/src/);
    expect(dockerfile).toMatch(/COPY --from=build \/app\/prisma \.\/prisma/);
    expect(dockerfile).toMatch(/COPY --from=deps \/app\/node_modules \.\/node_modules|RUN npm ci(?!\s+--omit=dev)/);
    expect(dockerfile).toMatch(/apt-get update && apt-get install -y --no-install-recommends postgresql-client|apk add --no-cache postgresql-client/);
  });

  it("configures nginx no-index protections, rate limits, and denied internal paths", () => {
    const nginx = readRequiredFile(nginxPath);

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
});
