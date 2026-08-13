import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PRODUCTION_RUNTIME_APT_COMMAND } from "../../src/readiness/productionImageContract";

const repoRoot = process.cwd();
const dockerfilePath = resolve(repoRoot, "Dockerfile");
const composePath = resolve(repoRoot, "ops/docker-compose.yml");
const nginxPath = resolve(repoRoot, "ops/nginx.conf");
const nginxMainPath = resolve(repoRoot, "ops/nginx-main.conf");
const backupPath = resolve(repoRoot, "ops/backup.sh");
const monitoringCheckPath = resolve(repoRoot, "ops/monitoring-check.ts");
const envExamplePath = resolve(repoRoot, ".env.example");
const httpServerPath = resolve(repoRoot, "src/server/httpServer.ts");
const p0CrawlPath = resolve(repoRoot, "scripts/p0-crawl.ts");

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

function runMonitoringCheck(env: NodeJS.ProcessEnv): { status: number | null; stderr: string; elapsedMs: number } {
  const startedAt = Date.now();
  try {
    execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "ops/monitoring-check.ts"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        STAGED_CRAWL_SUMMARY_PATH: resolve(repoRoot, "outputs", "monitoring-test-summary.json"),
        STAGED_CRAWL_ATTEMPT_DIR: resolve(repoRoot, "outputs", "monitoring-test-attempts"),
        ...env
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { status: 0, stderr: "", elapsedMs: Date.now() - startedAt };
  } catch (error) {
    const result = error as { status?: number | null; stderr?: string };
    return { status: result.status ?? null, stderr: result.stderr ?? "", elapsedMs: Date.now() - startedAt };
  }
}

function renderCompose(env: NodeJS.ProcessEnv = {}): string {
  return execFileSync("docker", ["compose", "-f", composePath, "config"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      BUILD_COMMIT_SHA: "1".repeat(40),
      BUILD_SOURCE_CLEAN: "true",
      BUILD_SOURCE_TREE_SHA256: "2".repeat(64),
      ALERT_WEBHOOK_URL: "https://alerts.example.invalid/job-finder",
      DATABASE_URL: "postgresql://jobfinder:secret@postgres:5432/jobfinder",
      P0_FULL_RELEASE_MEMBERSHIP_FILE: "/evidence/membership.json",
      P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256: "3".repeat(64),
      P0_FULL_RELEASE_ORACLE_FILE: "/evidence/oracle.json",
      P0_FULL_RELEASE_ORACLE_FILE_SHA256: "4".repeat(64),
      POSTGRES_PASSWORD: "secret",
      PUBLIC_HOSTNAME: "jobs.example.test",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function renderBaseComposeWithoutManualAuthority(): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BUILD_COMMIT_SHA: "1".repeat(40),
    BUILD_SOURCE_CLEAN: "true",
    BUILD_SOURCE_TREE_SHA256: "2".repeat(64),
    ALERT_WEBHOOK_URL: "https://alerts.example.invalid/job-finder",
    DATABASE_URL: "postgresql://jobfinder:secret@postgres:5432/jobfinder?schema=public",
    POSTGRES_PASSWORD: "secret",
    PUBLIC_HOSTNAME: "jobs.example.test"
  };
  for (const name of [
    "P0_FULL_RELEASE_MEMBERSHIP_FILE",
    "P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256",
    "P0_FULL_RELEASE_ORACLE_FILE",
    "P0_FULL_RELEASE_ORACLE_FILE_SHA256"
  ]) delete env[name];
  return execFileSync("docker", ["compose", "-f", composePath, "config"], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function startRecordingHttpServer(markerPath: string): Promise<{ port: number; stop: () => Promise<void> }> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "const fs=require('node:fs'),http=require('node:http');const server=http.createServer((_q,r)=>{fs.writeFileSync(process.env.MARKER_PATH,'hit');r.setHeader('content-type','application/json');r.end('{\"ok\":true}')});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));"
    ],
    { env: { ...process.env, MARKER_PATH: markerPath }, stdio: ["ignore", "pipe", "pipe"] }
  );
  const port = await new Promise<number>((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error("recording HTTP server did not start")), 2_000);
    child.once("error", reject);
    child.stdout.once("data", (chunk) => {
      clearTimeout(timer);
      resolvePort(Number(String(chunk).trim()));
    });
  });
  return {
    port,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill();
      await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
    }
  };
}

async function startFakeTcpServer(): Promise<{ port: number; stop: () => Promise<void> }> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "const net=require('node:net');const server=net.createServer(()=>{});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));process.on('SIGTERM',()=>server.close(()=>process.exit(0)));"
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  const port = await new Promise<number>((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error("fake TCP server did not start")), 10_000);
    child.once("error", reject);
    child.stdout.once("data", (chunk) => {
      clearTimeout(timer);
      resolvePort(Number(String(chunk).trim()));
    });
  });
  return {
    port,
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill();
      await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
    }
  };
}

describe("deployment configuration", () => {
  it("renders the base stack with the deployed manual-request worker", () => {
    const rendered = renderBaseComposeWithoutManualAuthority();
    expect(readComposeService(rendered, "web")).toContain("DATABASE_URL");
    const worker = readComposeService(rendered, "worker");
    expect(worker).toMatch(/command:\s*\n\s+- npm\s*\n\s+- run\s*\n\s+- p0:manual-crawl-worker/u);
    expect(worker).toMatch(/restart:\s*unless-stopped/u);
    expect(worker).not.toContain("profiles:");
    expect(worker).not.toContain("P0_FULL_RELEASE_");
    expect(worker).not.toContain("/run/release-authority/");
    expect(readRequiredFile(envExamplePath)).toContain(
      "postgresql://jobfinder:replace-with-a-long-random-database-password@postgres:5432/jobfinder?schema=public"
    );
  });

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

  it("bounds retained logs for every long-running production service", () => {
    const compose = readRequiredFile(composePath);
    expect(compose).toMatch(/x-bounded-logging:\s*&bounded-logging[\s\S]*driver:\s*local[\s\S]*max-size:\s*"10m"[\s\S]*max-file:\s*"5"/u);
    for (const serviceName of ["postgres", "web", "worker", "scheduler", "nginx", "backup", "restore-verifier", "monitor"]) {
      const service = readComposeService(compose, serviceName);
      expect(service).toContain("logging: *bounded-logging");
    }
  });

  it("keeps runtime image inputs aligned with worker, scheduler, backup, and monitor commands", () => {
    const dockerfile = readRequiredFile(dockerfilePath);
    const compose = readRequiredFile(composePath);

    expect(compose).toMatch(/"p0:scheduler"/);
    expect(readRequiredFile(resolve(repoRoot, "scripts", "p0-formal-crawl-once.ts"))).toMatch(/npm.*p0:crawl/s);
    expect(compose).toMatch(/npx tsx ops\/monitoring-check\.ts/);
    const monitor = readComposeService(compose, "monitor");
    expect(monitor).toMatch(/ALERT_WEBHOOK_URL:\s*\$\{ALERT_WEBHOOK_URL:\?set ALERT_WEBHOOK_URL\}/u);
    expect(monitor).toMatch(/ALERT_WEBHOOK_ALLOW_HTTP:\s*\$\{ALERT_WEBHOOK_ALLOW_HTTP:-0\}/u);
    expect(readRequiredFile(monitoringCheckPath)).toContain("deliverOpsAlerts");
    expect(compose).toMatch(/node dist\/server\/httpServer\.js|"npm",\s*"run",\s*"start"|npm run start/);
    expect(compose).toContain("TRUSTED_PROXY_CIDRS");
    expect(dockerfile).toMatch(/COPY --from=identity \/app\/scripts \.\/scripts/);
    expect(dockerfile).toMatch(/COPY --from=identity \/app\/src \.\/src/);
    expect(dockerfile).toMatch(/COPY --from=identity \/app\/prisma \.\/prisma/);
    expect(dockerfile).toMatch(/COPY --from=identity \/app\/node_modules \.\/node_modules/);
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
    expect(dockerfile).toContain(PRODUCTION_RUNTIME_APT_COMMAND);
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
    expect(nginx).toMatch(/listen 8443 ssl/);
    expect(nginx).toContain("ssl_certificate /run/tls/fullchain.pem");
    expect(nginx).toContain("ssl_certificate_key /run/tls/privkey.pem");
    expect(nginx).toMatch(/client_max_body_size\s+1m/);
    expect(nginx).toMatch(/client_body_timeout\s+10s/);
    expect(nginx).toMatch(/proxy_connect_timeout\s+5s/);
    expect(nginx).toMatch(/proxy_read_timeout\s+30s/);
    expect(nginx).toMatch(/proxy_send_timeout\s+30s/);
  });

  it("publishes only nginx HTTP/TLS ports and mounts TLS material read-only", () => {
    const compose = readRequiredFile(composePath);
    const nginx = readComposeService(compose, "nginx");
    expect(nginx).toContain('source: ${TLS_DIRECTORY:-./tls-not-configured}');
    expect(nginx).toContain('target: /run/tls');
    expect(nginx.match(/read_only:\s*true/gu)).toHaveLength(5);
    expect(nginx).toContain('${HTTP_PORT:-80}:8080');
    expect(nginx).toContain('${HTTPS_PORT:-443}:8443');
    expect(nginx).toMatch(/user:\s*["']101:101["']/u);
    expect(nginx).toMatch(/cap_drop:\s*\n\s+- ALL/u);
    expect(nginx).toMatch(/read_only:\s*true/u);
    expect(nginx).toContain('source: ./nginx-main.conf');
    expect(nginx).toContain('source: ./render-nginx-config.sh');
    expect(readRequiredFile(nginxMainPath)).toContain('include /tmp/jobfinder-ingress.conf;');
    for (const serviceName of ["postgres", "web", "worker", "scheduler"]) {
      expect(readComposeService(compose, serviceName)).not.toContain("ports:");
    }
  });

  it("binds ingress to one hostname and gates ordinary traffic on live readiness", () => {
    const nginx = readRequiredFile(nginxPath);
    const compose = readRequiredFile(composePath);
    const ingress = readComposeService(compose, "nginx");

    expect(nginx).toContain('listen 8080 default_server;');
    expect(nginx).toContain('listen 8443 ssl default_server;');
    expect(nginx).toMatch(/server_name "";\s*return 444;/u);
    expect(nginx).toMatch(/server_name \$\{PUBLIC_HOSTNAME\};/u);
    expect(nginx).toContain('return 308 https://${PUBLIC_HTTPS_AUTHORITY}$request_uri;');
    expect(nginx).not.toContain('https://$host');
    expect(nginx).toContain('proxy_set_header Host $server_name;');
    expect(nginx).toContain('auth_request /__readiness_gate;');
    expect(nginx).toContain('error_page 500 =503 @ingress_not_ready;');
    expect(nginx).toMatch(/location = \/__readiness_gate \{[\s\S]*internal;[\s\S]*proxy_pass http:\/\/jobfinder_web\/readyz;/u);
    expect(ingress).toContain('PUBLIC_HOSTNAME: ${PUBLIC_HOSTNAME:?set PUBLIC_HOSTNAME}');
    expect(ingress).toContain('target: /etc/nginx/templates/default.conf.template');
    expect(ingress).toContain('sh /usr/local/bin/render-jobfinder-nginx-config');
    expect(ingress).toContain('PUBLIC_HTTPS_PORT: ${HTTPS_PORT:-443}');
  });

  it("rate-limits the exact public health endpoint without changing the internal web healthcheck", () => {
    const nginx = readRequiredFile(nginxPath);
    const compose = readRequiredFile(composePath);
    const healthLocation = nginx.match(/location = \/healthz \{[\s\S]*?^    \}/mu)?.[0] ?? "";
    const configuredRates = [...nginx.matchAll(/zone=([a-z_]+):\d+m rate=(\d+)r\/m;/gu)]
      .map((match) => ({ zone: match[1], requestsPerMinute: Number(match[2]) }));
    const healthRate = configuredRates.find((entry) => entry.zone === "health_limit");
    const otherRates = configuredRates
      .filter((entry) => entry.zone !== "health_limit")
      .map((entry) => entry.requestsPerMinute);

    expect(healthRate).toEqual({ zone: "health_limit", requestsPerMinute: 5 });
    expect(otherRates.length).toBeGreaterThan(0);
    expect(healthRate!.requestsPerMinute).toBeLessThan(Math.min(...otherRates));
    expect(healthLocation).toMatch(/add_header X-Robots-Tag "noindex, nofollow" always;/u);
    expect(healthLocation).toMatch(/limit_req zone=health_limit burst=2 nodelay;/u);
    expect(healthLocation).toMatch(/limit_req_status 429;/u);
    expect(healthLocation).toMatch(/proxy_pass http:\/\/jobfinder_web;/u);

    const web = readComposeService(compose, "web");
    expect(web).toMatch(/healthcheck:[\s\S]*http:\/\/127\.0\.0\.1:3000\/healthz/u);
  });

  it("ships a monitoring check command that reads env-driven health, database, and backup artifact inputs", () => {
    const script = readRequiredFile(monitoringCheckPath);

    expect(script).toContain("/healthz");
    expect(script).toContain("DATABASE_URL");
    expect(script).toContain("BACKUP_DIR");
    expect(script).toContain("checkPostgresReadiness");
    expect(script).not.toMatch(/new Socket|checkPostgresSocket/u);
    expect(script).toMatch(/process\.env/);
    expect(script).toMatch(/process\.exitCode|process\.exit\(/);
  });

  it("publishes formal crawl summaries from terminal batch results and persisted source health", () => {
    const script = readRequiredFile(p0CrawlPath);

    expect(script).toContain("runAndPublishCrawlSummary");
    expect(script).toContain("collectConsecutiveFailuresByCompany");
    expect(script).toContain("writeCrawlSummaryAtomic");
    expect(script).toContain("CRAWL_SUMMARY_PATH");
    expect(script).toContain("canonicalSummaryWriteAttempted");
    expect(script.indexOf("canonicalSummaryWriteAttempted=true"))
      .toBeLessThan(script.indexOf("writeCrawlSummaryAtomic(crawlSummaryPath"));
    const monitor = readRequiredFile(monitoringCheckPath);
    expect(monitor).not.toMatch(/readNumber\(readinessSummary,\s*["']globalSuccessRate["']\)/u);
    expect(monitor).not.toMatch(/readRecord\(readinessSummary,\s*["']consecutiveFailuresByCompany["']\)/u);
  });

  it("binds scheduler and monitor to the same staged paths and database-backed identity", () => {
    const compose = readRequiredFile(composePath);
    const scheduler = readComposeService(compose, "scheduler");
    const monitor = readComposeService(compose, "monitor");
    const worker = readComposeService(compose, "worker");
    for (const service of [scheduler, monitor]) {
      expect(service).not.toMatch(/P0_(?:FULL_RELEASE|RELEASE_)/u);
      expect(service).not.toContain("/run/release-authority/");
      expect(service).toMatch(/source:\s*formal-artifacts[\s\S]*target:\s*\/app\/outputs/u);
      expect(service).toContain("STAGED_CRAWL_SUMMARY_PATH: /app/outputs/staged-crawl-summary.json");
      expect(service).toContain("STAGED_CRAWL_ATTEMPT_DIR: /app/outputs/staged-crawl-attempts");
      expect(service).toContain("STAGED_INITIAL_QUALIFICATION_PAUSE_PATH: /app/outputs/staged-initial-qualification-pause.json");
      expect(service).not.toMatch(/STAGED_CRAWL_(?:SUMMARY_PATH|ATTEMPT_DIR):\s*\$\{/u);
    }
    expect(worker).not.toContain("P0_MANUAL_CRAWL_WORKER_ID:");
    expect(worker).not.toMatch(/P0_(?:FULL_RELEASE|RELEASE_)/u);
    expect(worker).not.toContain("/run/release-authority/");
    const manualWorkerScript = readRequiredFile(resolve(repoRoot, "scripts", "p0-manual-crawl-worker.ts"));
    expect(manualWorkerScript).toContain("resolveCurrentStagedScheduleAuthority(prisma)");
    expect(manualWorkerScript).not.toContain("loadCurrentReleaseIdentity");
    expect(manualWorkerScript).toMatch(/manual-\$\{hostname\(\)\}-\$\{process\.pid\}/u);
    const monitorScript = readRequiredFile(monitoringCheckPath);
    expect(monitorScript).toContain("loadProductionStagedMonitoringIdentity");
    expect(monitorScript).toContain("loadProductionStagedMonitoringIdentity(databaseUrl)");
    expect(monitorScript).not.toContain("loadMonitoringReleaseIdentity");
    expect(monitorScript).toContain("resolveStagedCrawlEvidencePaths");
    expect(monitorScript).not.toContain("process.env.CRAWL_SUMMARY_PATH");
    expect(monitorScript).not.toContain("process.env.CRAWL_ATTEMPT_DIR");
    expect(monitorScript.indexOf("resolveStagedCrawlEvidencePaths"))
      .toBeLessThan(monitorScript.indexOf("loadProductionStagedMonitoringIdentity(databaseUrl)"));
    expect(monitorScript).toContain("readLatestCrawlAttempt");
    expect(monitorScript).toContain("scheduledAttemptMaxRunningAgeHours");
    expect(monitorScript).toMatch(/readLatestCrawlAttempt\([\s\S]*maxRunningAgeHours:\s*scheduledAttemptMaxRunningAgeHours/u);
  });

  it("keeps rendered scheduler and monitor evidence on the shared volume despite caller overrides", () => {
    const rendered = renderCompose({
      STAGED_CRAWL_SUMMARY_PATH: "/tmp/rogue-summary.json",
      STAGED_CRAWL_ATTEMPT_DIR: "/tmp/rogue-attempts",
      STAGED_INITIAL_QUALIFICATION_PAUSE_PATH: "/tmp/rogue-pause.json"
    });
    for (const serviceName of ["scheduler", "monitor"]) {
      const service = readComposeService(rendered, serviceName);
      expect(service).toContain("STAGED_CRAWL_SUMMARY_PATH: /app/outputs/staged-crawl-summary.json");
      expect(service).toContain("STAGED_CRAWL_ATTEMPT_DIR: /app/outputs/staged-crawl-attempts");
      expect(service).toContain("STAGED_INITIAL_QUALIFICATION_PAUSE_PATH: /app/outputs/staged-initial-qualification-pause.json");
      expect(service).not.toContain("/tmp/rogue-");
      expect(service).toMatch(/source:\s*formal-artifacts[\s\S]*target:\s*\/app\/outputs/u);
    }
  });

  it("rejects an unconfined monitor path before database, health, or evidence I/O", async () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitor-path-boundary-"));
    const healthMarker = resolve(tempDir, "health-requested");
    const server = await startRecordingHttpServer(healthMarker);
    try {
      const result = runMonitoringCheck({
        DATABASE_URL: "not-a-database-url",
        HEALTHCHECK_URL: `http://127.0.0.1:${server.port}/healthz`,
        BACKUP_DIR: resolve(tempDir, "missing-backups"),
        STAGED_CRAWL_SUMMARY_PATH: resolve(repoRoot, "outputs", "monitor-boundary-summary.json"),
        STAGED_CRAWL_ATTEMPT_DIR: resolve(tempDir, "rogue-attempts")
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/canonical outputs root/i);
      expect(existsSync(healthMarker)).toBe(false);
    } finally {
      await server.stop();
    }
  }, 15_000);

  it("rejects a TCP listener that does not authenticate or speak the PostgreSQL protocol", async () => {
    const fake = await startFakeTcpServer();
    try {
      const tempDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitoring-fake-postgres-"));
      const startupBaseline = runMonitoringCheck({
        BACKUP_DIR: tempDir,
        HEALTHCHECK_URL: "http://127.0.0.1:9/healthz",
        READINESS_SUMMARY_PATH: resolve(tempDir, "absent-readiness.json"),
        CRAWL_SUMMARY_PATH: resolve(tempDir, "absent-crawl.json")
      });
      const result = runMonitoringCheck({
        DATABASE_URL: `postgresql://user:placeholder@127.0.0.1:${fake.port}/database`,
        POSTGRES_READINESS_TIMEOUT_MS: "150",
        BACKUP_DIR: tempDir,
        HEALTHCHECK_URL: "http://127.0.0.1:9/healthz",
        READINESS_SUMMARY_PATH: resolve(tempDir, "absent-readiness.json"),
        CRAWL_SUMMARY_PATH: resolve(tempDir, "absent-crawl.json")
      });

      expect(result.status).not.toBe(0);
      expect(result.elapsedMs - startupBaseline.elapsedMs).toBeLessThan(2_500);
      expect(result.stderr).toContain("DATABASE_UNREACHABLE");
      expect(result.stderr).not.toContain("postgresql://user:placeholder");
    } finally {
      await fake.stop();
    }
  }, 30_000);

  it("fails closed when the monitor database URL is missing", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitoring-missing-database-"));
    const result = runMonitoringCheck({
      DATABASE_URL: undefined,
      BACKUP_DIR: tempDir,
      HEALTHCHECK_URL: "http://127.0.0.1:9/healthz",
      READINESS_SUMMARY_PATH: resolve(tempDir, "absent-readiness.json"),
      CRAWL_SUMMARY_PATH: resolve(tempDir, "absent-crawl.json")
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("DATABASE_UNREACHABLE");
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

  it("initializes a least-privilege persistent monitor state volume for one-shot alert acknowledgements", () => {
    const compose = readRequiredFile(composePath);
    const init = readComposeService(compose, "monitor-state-init");
    const monitor = readComposeService(compose, "monitor");

    expect(init).toMatch(/user:\s*["']0:0["']/u);
    expect(init).toContain('command: ["install", "-d", "-o", "node", "-g", "node", "-m", "0700", "/app/monitor-state"]');
    expect(init).toMatch(/network_mode:\s*none/u);
    expect(init).toMatch(/read_only:\s*true/u);
    expect(init).toMatch(/cap_drop:\s*\n\s+- ALL/u);
    expect(init).toMatch(/cap_add:\s*\n\s+- CHOWN\s*\n\s+- FOWNER/u);
    expect(init).toMatch(/source:\s*monitor-state[\s\S]*target:\s*\/app\/monitor-state/u);
    expect(monitor).toMatch(/monitor-state-init:\s*\n\s+condition:\s*service_completed_successfully/u);
    expect(monitor).toMatch(/source:\s*monitor-state[\s\S]*target:\s*\/app\/monitor-state/u);
  });

  it("fails fast on backup errors and healthchecks the authoritative attempt receipt", () => {
    const compose = readRequiredFile(composePath);
    const backup = readComposeService(compose, "backup");

    expect(backup).toMatch(/restart:\s*["']on-failure:3["']/u);
    expect(backup).toContain("set -eu; while true; do sh ./ops/backup.sh; sleep");
    expect(backup).toMatch(/healthcheck:[\s\S]*readBackupAttemptEvidence/u);
    expect(backup).toContain("readBackupAttemptEvidence('/backups/latest-backup-attempt.json')");
    expect(backup).toMatch(/BACKUP_DIR:\s*\/backups/u);
    expect(backup).not.toContain("${BACKUP_DIR");
    expect(backup).not.toContain("BACKUP_ATTEMPT_RECEIPT_PATH:");
    expect(backup).toMatch(/start_period:\s*(?:[1-9]\d*s|[1-9]\d*m)/u);
    expect(backup).not.toMatch(/healthcheck:[\s\S]*-name\s+["']\*\.dump["']/u);
  });

  it("mounts backup evidence read-only and uses paths that exist inside the monitor container", () => {
    const compose = readRequiredFile(composePath);
    const monitor = readComposeService(compose, "monitor");

    expect(monitor).toMatch(/restart:\s*["']unless-stopped["']/u);
    expect(monitor).toContain("set -u; while true; do npx tsx ops/monitoring-check.ts; status=$$?");
    expect(monitor).toContain("[monitor-loop] check exited with status $$status; continuing after interval.");
    expect(monitor).not.toContain("set -eu; while true; do npx tsx ops/monitoring-check.ts");
    expect(monitor).toMatch(/BACKUP_DIR:\s*\/backups/u);
    expect(monitor).toMatch(/DATABASE_URL:\s*\$\{DATABASE_URL:\?set DATABASE_URL\}/u);
    expect(monitor).toMatch(/READINESS_SUMMARY_PATH:\s*\$\{READINESS_SUMMARY_PATH:-\/app\/outputs\//u);
    expect(monitor).toContain("STAGED_CRAWL_SUMMARY_PATH: /app/outputs/staged-crawl-summary.json");
    expect(monitor).toContain("STAGED_CRAWL_ATTEMPT_DIR: /app/outputs/staged-crawl-attempts");
    expect(monitor).toContain("STAGED_INITIAL_QUALIFICATION_PAUSE_PATH: /app/outputs/staged-initial-qualification-pause.json");
    expect(monitor).toContain("MONITOR_STATE_DIR: /app/monitor-state");
    expect(monitor).toMatch(/source:\s*backup-data[\s\S]*target:\s*\/backups[\s\S]*read_only:\s*true/u);
    expect(monitor).toMatch(/source:\s*monitor-state[\s\S]*target:\s*\/app\/monitor-state(?![\s\S]{0,40}read_only:\s*true)/u);
    expect(monitor).toMatch(/backup:\s*\n\s+condition:\s*service_healthy/u);
    expect(monitor).toMatch(/postgres:\s*\n\s+condition:\s*service_healthy/u);
  });

  it("waits for initial web health without disabling runtime website checks", () => {
    const compose = readRequiredFile(composePath);
    const web = readComposeService(compose, "web");
    const monitor = readComposeService(compose, "monitor");

    expect(web).toMatch(/healthcheck:[\s\S]*\/healthz/u);
    expect(monitor).toMatch(/web:\s*\n\s+condition:\s*service_healthy/u);
    expect(monitor).toContain("HEALTHCHECK_URL");
    expect(readRequiredFile(monitoringCheckPath)).toContain("checkHealth(healthUrl)");
  });

  it("runs the web service with a read-only root and a constrained temporary filesystem", () => {
    const compose = readRequiredFile(composePath);
    const web = readComposeService(compose, "web");

    expect(web).toMatch(/^    read_only:\s*true$/mu);
    expect(web).toMatch(/^    cap_drop:\s*\n      - ALL$/mu);
    expect(web).toMatch(/^    security_opt:\s*\n      - no-new-privileges:true$/mu);
    expect(web).toMatch(/^    tmpfs:\s*\n      - \/tmp:rw,nosuid,nodev,(?:noexec,)?size=(?:32|64|128)m(?:,mode=1777)?$/mu);
  });

  it("hardens every application runtime while preserving only its required writable volume", () => {
    const compose = readRequiredFile(composePath);
    const expectedTmpfsSize = new Map([
      ["web", "(?:64|128)m"],
      ["worker", "1g"],
      ["scheduler", "1g"],
      ["backup", "(?:64|128)m"],
      ["monitor", "(?:64|128)m"]
    ]);

    for (const [serviceName, size] of expectedTmpfsSize) {
      const service = readComposeService(compose, serviceName);
      expect(service, serviceName).toMatch(/^    user:\s*node$/mu);
      expect(service, serviceName).toMatch(/^    read_only:\s*true$/mu);
      expect(service, serviceName).toMatch(/^    cap_drop:\s*\n      - ALL$/mu);
      expect(service, serviceName).toMatch(/^    security_opt:\s*\n      - no-new-privileges:true$/mu);
      expect(service, serviceName).toMatch(
        new RegExp(`^    tmpfs:\\s*\\n      - /tmp:rw,nosuid,nodev,noexec,size=${size},mode=1777$`, "mu")
      );
    }

    const worker = readComposeService(compose, "worker");
    const scheduler = readComposeService(compose, "scheduler");
    const backup = readComposeService(compose, "backup");
    const monitor = readComposeService(compose, "monitor");
    expect(worker).toMatch(/target:\s*\/app\/outputs(?![\s\S]{0,40}read_only:\s*true)/u);
    expect(scheduler).toMatch(/target:\s*\/app\/outputs(?![\s\S]{0,40}read_only:\s*true)/u);
    expect(backup).toContain("- backup-data:/backups");
    expect(monitor.match(/read_only:\s*true/gu)).toHaveLength(4);
  });

  it("pins external postgres and nginx images by digest", () => {
    const compose = readRequiredFile(composePath);

    expect(compose).toContain(
      "image: postgres:16-bookworm@sha256:da788743d2060767375896de4d646f7576f5911461444b372616f19ea61db2ec"
    );
    expect(compose).toContain(
      "image: nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10"
    );
  });

  it("derives successful backup evidence from the newest canonical marker and archive", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitoring-backup-"));
    const archiveName = "jobfinder-20260712T120000Z.dump";
    const archivePath = resolve(tempDir, archiveName);
    const markerPath = `${archivePath}.sha256`;
    const archive = Buffer.from("stream-me-instead-of-loading-a-production-dump");
    writeFileSync(archivePath, archive);
    writeFileSync(markerPath, `${createHash("sha256").update(archive).digest("hex")}  ${archiveName}\n`, "utf8");
    const markerTime = new Date("2026-07-12T12:00:00.000Z");
    utimesSync(markerPath, markerTime, markerTime);

    const readinessSummaryPath = resolve(tempDir, "readiness-summary.json");
    const crawlSummaryPath = resolve(tempDir, "crawl-summary.json");
    writeFileSync(
      readinessSummaryPath,
      JSON.stringify({ latestBackupAt: "2020-01-01T00:00:00.000Z", latestBackupSucceeded: false }),
      "utf8"
    );
    writeFileSync(crawlSummaryPath, JSON.stringify({ consecutiveFailuresByCompany: {} }), "utf8");

    const result = runMonitoringCheck({
      BACKUP_DIR: tempDir,
      HEALTHCHECK_URL: "http://127.0.0.1:9/healthz",
      READINESS_SUMMARY_PATH: readinessSummaryPath,
      CRAWL_SUMMARY_PATH: crawlSummaryPath,
      MONITORING_NOW: "2026-07-12T13:00:00.000Z"
    });

    expect(result.stderr).not.toMatch(/BACKUP_(?:FAILED|MISSING|STALE)/u);
  });

  it("fails closed for a missing marker and invalid newest backup artifacts", () => {
    const scenarios = [
      {
        name: "wrong marker basename",
        marker: (hash: string) => `${hash}  another.dump\n`,
        archive: true
      },
      {
        name: "path traversal marker basename",
        marker: (hash: string) => `${hash}  ../outside.dump\n`,
        archive: true
      },
      {
        name: "non-canonical multiline marker",
        marker: (hash: string, archiveName: string) => `${hash}  ${archiveName}\nextra\n`,
        archive: true
      },
      {
        name: "checksum mismatch",
        marker: (_hash: string, archiveName: string) => `${"0".repeat(64)}  ${archiveName}\n`,
        archive: true
      },
      {
        name: "missing archive",
        marker: (hash: string, archiveName: string) => `${hash}  ${archiveName}\n`,
        archive: false
      }
    ];

    for (const scenario of scenarios) {
      const tempDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitoring-backup-"));
      const olderArchiveName = "jobfinder-20260711T120000Z.dump";
      const olderArchivePath = resolve(tempDir, olderArchiveName);
      const olderArchive = Buffer.from("older-valid-backup");
      writeFileSync(olderArchivePath, olderArchive);
      writeFileSync(
        `${olderArchivePath}.sha256`,
        `${createHash("sha256").update(olderArchive).digest("hex")}  ${olderArchiveName}\n`,
        "utf8"
      );
      const olderTime = new Date("2026-07-11T12:00:00.000Z");
      utimesSync(`${olderArchivePath}.sha256`, olderTime, olderTime);
      const archiveName = "jobfinder-20260712T120000Z.dump";
      const archivePath = resolve(tempDir, archiveName);
      const archive = Buffer.from("backup");
      const hash = createHash("sha256").update(archive).digest("hex");
      if (scenario.archive) writeFileSync(archivePath, archive);
      writeFileSync(`${archivePath}.sha256`, scenario.marker(hash, archiveName), "utf8");
      const result = runMonitoringCheck({
        BACKUP_DIR: tempDir,
        HEALTHCHECK_URL: "http://127.0.0.1:9/healthz",
        READINESS_SUMMARY_PATH: resolve(tempDir, "absent-readiness.json"),
        CRAWL_SUMMARY_PATH: resolve(tempDir, "absent-crawl.json"),
        LATEST_BACKUP_AT: "2026-07-12T12:00:00.000Z",
        LATEST_BACKUP_SUCCEEDED: "true",
        MONITORING_NOW: "2026-07-12T13:00:00.000Z"
      });
      expect(result.status, scenario.name).not.toBe(0);
      expect(result.stderr, scenario.name).toMatch(/BACKUP_(?:FAILED|MISSING)/u);
    }

    const emptyDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitoring-backup-"));
    const missing = runMonitoringCheck({
      BACKUP_DIR: emptyDir,
      HEALTHCHECK_URL: "http://127.0.0.1:9/healthz",
      READINESS_SUMMARY_PATH: resolve(emptyDir, "absent-readiness.json"),
      CRAWL_SUMMARY_PATH: resolve(emptyDir, "absent-crawl.json"),
      LATEST_BACKUP_AT: "2026-07-12T12:00:00.000Z",
      LATEST_BACKUP_SUCCEEDED: "true",
      MONITORING_NOW: "2026-07-12T13:00:00.000Z"
    });
    expect(missing.stderr).toContain("BACKUP_MISSING");
  }, 45_000);

  it("fails closed when the newest marker-like entry or its archive is a symbolic link", () => {
    for (const symlinkKind of ["marker", "archive"] as const) {
      const tempDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitoring-backup-symlink-"));
      const olderArchiveName = "jobfinder-20260712T060000Z.dump";
      const olderArchivePath = resolve(tempDir, olderArchiveName);
      const olderArchive = Buffer.from("older-valid-backup");
      writeFileSync(olderArchivePath, olderArchive);
      writeFileSync(
        `${olderArchivePath}.sha256`,
        `${createHash("sha256").update(olderArchive).digest("hex")}  ${olderArchiveName}\n`,
        "utf8"
      );
      const olderTime = new Date("2026-07-12T06:00:00.000Z");
      utimesSync(`${olderArchivePath}.sha256`, olderTime, olderTime);

      const newestArchiveName = "jobfinder-20260712T120000Z.dump";
      const newestArchivePath = resolve(tempDir, newestArchiveName);
      const newestMarkerPath = `${newestArchivePath}.sha256`;
      const targetArchivePath = resolve(tempDir, "symlink-target.dump");
      const targetMarkerPath = resolve(tempDir, "symlink-target.marker");
      const targetArchive = Buffer.from("newest-backup-through-symlink");
      const targetMarker = `${createHash("sha256").update(targetArchive).digest("hex")}  ${newestArchiveName}\n`;
      writeFileSync(targetArchivePath, targetArchive);

      if (symlinkKind === "marker") {
        writeFileSync(newestArchivePath, targetArchive);
        writeFileSync(targetMarkerPath, targetMarker, "utf8");
        symlinkSync(targetMarkerPath, newestMarkerPath, "file");
      } else {
        symlinkSync(targetArchivePath, newestArchivePath, "file");
        writeFileSync(newestMarkerPath, targetMarker, "utf8");
      }

      const result = runMonitoringCheck({
        BACKUP_DIR: tempDir,
        HEALTHCHECK_URL: "http://127.0.0.1:9/healthz",
        READINESS_SUMMARY_PATH: resolve(tempDir, "absent-readiness.json"),
        CRAWL_SUMMARY_PATH: resolve(tempDir, "absent-crawl.json"),
        MONITORING_NOW: "2026-07-12T13:00:00.000Z"
      });

      expect(result.status, symlinkKind).not.toBe(0);
      expect(result.stderr, symlinkKind).toMatch(/BACKUP_(?:FAILED|MISSING)/u);
    }
  });

  it("uses a deterministic ordinal name tie-break and fails closed for an invalid equal-mtime winner", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitoring-backup-tie-"));
    const validArchiveName = "jobfinder-B.dump";
    const validArchive = Buffer.from("valid-equal-mtime-backup");
    writeFileSync(resolve(tempDir, validArchiveName), validArchive);
    writeFileSync(
      resolve(tempDir, `${validArchiveName}.sha256`),
      `${createHash("sha256").update(validArchive).digest("hex")}  ${validArchiveName}\n`,
      "utf8"
    );

    const ordinalWinnerName = "jobfinder-a.dump";
    writeFileSync(resolve(tempDir, ordinalWinnerName), "invalid-equal-mtime-backup", "utf8");
    writeFileSync(
      resolve(tempDir, `${ordinalWinnerName}.sha256`),
      `${"0".repeat(64)}  ${ordinalWinnerName}\n`,
      "utf8"
    );
    const equalTime = new Date("2026-07-12T12:00:00.000Z");
    utimesSync(resolve(tempDir, `${validArchiveName}.sha256`), equalTime, equalTime);
    utimesSync(resolve(tempDir, `${ordinalWinnerName}.sha256`), equalTime, equalTime);

    const result = runMonitoringCheck({
      BACKUP_DIR: tempDir,
      HEALTHCHECK_URL: "http://127.0.0.1:9/healthz",
      READINESS_SUMMARY_PATH: resolve(tempDir, "absent-readiness.json"),
      CRAWL_SUMMARY_PATH: resolve(tempDir, "absent-crawl.json"),
      MONITORING_NOW: "2026-07-12T13:00:00.000Z"
    });

    expect(ordinalWinnerName > validArchiveName).toBe(true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("BACKUP_FAILED");
  });

  it("uses the canonical marker mtime for backup staleness instead of summary claims", () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), "job-finder-monitoring-"));
    const archiveName = "jobfinder-20260707T060000Z.dump";
    const archivePath = resolve(tempDir, archiveName);
    const archive = Buffer.from("backup");
    writeFileSync(archivePath, archive);
    writeFileSync(
      `${archivePath}.sha256`,
      `${createHash("sha256").update(archive).digest("hex")}  ${archiveName}\n`,
      "utf8"
    );
    const markerTime = new Date("2026-07-07T06:00:00.000Z");
    utimesSync(`${archivePath}.sha256`, markerTime, markerTime);
    const readinessSummaryPath = resolve(tempDir, "readiness-summary.json");
    const crawlSummaryPath = resolve(tempDir, "crawl-summary.json");

    writeFileSync(
      readinessSummaryPath,
      JSON.stringify({
        latestBackupAt: "2026-07-08T12:59:00.000Z",
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
            BACKUP_DIR: tempDir,
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
