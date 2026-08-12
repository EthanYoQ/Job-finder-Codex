import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, open, readFile, readdir, type FileHandle } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { evaluateOpsAlerts, type OpsAlertInput } from "../src/server/opsMonitoring";
import { checkPostgresReadiness, DEFAULT_POSTGRES_READINESS_TIMEOUT_MS } from "../src/server/postgresReadiness";
import { DEFAULT_CRAWL_SUMMARY_MAX_AGE_HOURS, readCrawlSummaryFile, type CrawlEvidenceIdentity } from "../src/crawler/crawlSummary";
import { readLatestCrawlAttempt } from "../src/crawler/crawlAttemptEvidence";
import { loadProductionStagedMonitoringIdentity } from "../src/crawler/stagedMonitoringIdentity";
import { resolveStagedCrawlEvidencePaths } from "../src/crawler/stagedCrawlEvidencePaths";
import { scheduledAttemptMaxRunningAgeHours } from "../src/crawler/officialHttpRuntimeLimits";
import { deliverOpsAlerts } from "../src/server/alertDelivery";
import { readInitialQualificationPauseBundle } from "../src/crawler/initialQualificationPauseBundle";
import { loadProductionInitialQualificationPauseCandidateStatus } from "../src/crawler/initialQualificationPauseCandidate";
import {
  acknowledgeDeliveredOneShotAlerts,
  filterAcknowledgedOneShotAlerts
} from "../src/server/oneShotAlertDelivery";
import { readRestoreQualificationEvidence } from "../src/ops/restoreQualification";

interface JsonMap {
  [key: string]: unknown;
}

void main();

async function main(): Promise<void> {
  const {
    attemptDir: crawlAttemptDir,
    summaryPath: crawlSummaryPath,
    initialQualificationPausePath
  } = resolveStagedCrawlEvidencePaths();
  const healthUrl = process.env.HEALTHCHECK_URL ?? "http://127.0.0.1:3000/healthz";
  const databaseUrl = process.env.DATABASE_URL;
  const backupDir = process.env.BACKUP_DIR ?? `${process.cwd()}/backups`;
  const restoreReceiptPath = process.env.RESTORE_RECEIPT_PATH ?? `${process.cwd()}/var/restore-receipt.json`;
  const readinessSummaryPath =
    process.env.READINESS_SUMMARY_PATH ?? `${process.cwd()}/var/readiness-summary.json`;
  const certificateExpiresAt = process.env.CERTIFICATE_EXPIRES_AT;
  const now = process.env.MONITORING_NOW ? new Date(process.env.MONITORING_NOW) : new Date();
  const monitorStateDir = process.env.MONITOR_STATE_DIR ?? `${process.cwd()}/var/monitor-state`;
  const postgresReadinessTimeoutMs = Number(
    process.env.POSTGRES_READINESS_TIMEOUT_MS ?? DEFAULT_POSTGRES_READINESS_TIMEOUT_MS
  );

  const [health, dbReachable, backupEvidence, restoreEvidence, readinessSummary] = await Promise.all([
    checkHealth(healthUrl),
    checkPostgresReadiness(databaseUrl, {
      timeoutMs: postgresReadinessTimeoutMs
    }),
    readBackupEvidence(backupDir),
    readRestoreQualificationEvidence(restoreReceiptPath),
    readOptionalJson(readinessSummaryPath)
  ]);

  let expectedIdentity: CrawlEvidenceIdentity | undefined;
  if (dbReachable) {
    try {
      expectedIdentity = await loadProductionStagedMonitoringIdentity(databaseUrl);
    } catch {
      expectedIdentity = undefined;
    }
  }

  const pauseBundle = await readInitialQualificationPauseBundle({
    pausePath: initialQualificationPausePath,
    summaryPath: crawlSummaryPath,
    attemptDir: crawlAttemptDir,
    now,
    ...(expectedIdentity ? { activeIdentity: expectedIdentity } : {}),
    loadCandidateStatus: (evidence) => {
      if (!dbReachable) throw new Error("PostgreSQL readiness failed before pause candidate validation");
      return loadProductionInitialQualificationPauseCandidateStatus(databaseUrl, evidence);
    }
  });
  const monitoringIdentity = pauseBundle.state === "PAUSED"
    ? pauseBundle.identity
    : expectedIdentity;
  const crawlEvidence = monitoringIdentity
    ? await readCrawlSummaryFile(crawlSummaryPath, {
        now,
        maxAgeHours: Number(process.env.CRAWL_SUMMARY_MAX_AGE_HOURS ?? DEFAULT_CRAWL_SUMMARY_MAX_AGE_HOURS),
        allowIncompleteScheduled: true,
        expectedIdentity: monitoringIdentity
      })
    : { state: "INVALID" as const };
  const crawlSummary = crawlEvidence.state === "VALID" ? crawlEvidence.summary : undefined;
  const crawlCounters = readRecord(crawlSummary, "counters");
  const attemptEvidence = monitoringIdentity
    ? await readLatestCrawlAttempt(crawlAttemptDir, {
        now,
        expectedIdentity: monitoringIdentity,
        maxRunningAgeHours: scheduledAttemptMaxRunningAgeHours(process.env),
        expectedCanonicalSummary: crawlEvidence.state === "VALID" || crawlEvidence.state === "STALE"
          ? { batchId: crawlEvidence.summary.batchId!, summarySha256: crawlEvidence.summarySha256 }
          : undefined
      })
    : { state: "INVALID" as const };

  const candidateAlerts = evaluateOpsAlerts({
    now,
    health,
    database: { ok: dbReachable },
    backup: backupEvidence,
    restore: restoreEvidence,
    crawl: {
      authorityState: pauseBundle.state === "PAUSED"
        ? "PAUSED"
        : expectedIdentity && (pauseBundle.state === "MISSING" || pauseBundle.state === "STALE_FOR_ACTIVE_IDENTITY")
          ? "VALID"
          : "INVALID",
      attemptState: attemptEvidence.state,
      summaryState: crawlEvidence.state,
      globalSuccessRate: readNumber(crawlSummary, "globalSuccessRate"),
      completenessFailureCount: readNumber(crawlCounters, "completenessIncompleteSourceCount"),
      consecutiveFailuresByCompany: toFailureMap(readRecord(crawlSummary, "consecutiveFailuresByCompany")),
      initialQualificationPause: pauseBundle.state === "PAUSED" ? {
        notificationKey: pauseBundle.evidence.notificationKey,
        releaseCandidateId: pauseBundle.evidence.releaseCandidateId,
        batchId: pauseBundle.evidence.batchId,
        completedRoundCount: pauseBundle.evidence.completedRoundCount,
        stableCompanyCount: pauseBundle.evidence.stableCompanyCount,
        minimumStableCompanyCount: pauseBundle.evidence.minimumStableCompanyCount
      } : undefined
    },
    certificate: {
      expiresAt: certificateExpiresAt ?? readString(readinessSummary, "certificateExpiresAt")
    },
    resources: {
      diskUsedPercent: readEnvNumber("DISK_USED_PERCENT"),
      memoryUsedPercent: readEnvNumber("MEMORY_USED_PERCENT")
    },
    traffic: {
      requestsLastHour: readEnvNumber("REQUESTS_LAST_HOUR"),
      baselineRequestsPerHour: readEnvNumber("BASELINE_REQUESTS_PER_HOUR")
    }
  } satisfies OpsAlertInput);

  let alerts: typeof candidateAlerts;
  try {
    alerts = await filterAcknowledgedOneShotAlerts(candidateAlerts, monitorStateDir);
  } catch {
    console.error("[critical] ALERT_DEDUPLICATION_STATE_INVALID: Operations alert state could not be verified.");
    process.exitCode = 1;
    return;
  }

  for (const alert of alerts) {
    console.error(`[${alert.severity}] ${alert.code}: ${alert.message}`);
  }

  try {
    await deliverOpsAlerts(alerts, {
      endpoint: process.env.ALERT_WEBHOOK_URL,
      allowInsecureHttp: process.env.ALERT_WEBHOOK_ALLOW_HTTP === "1"
    });
    await acknowledgeDeliveredOneShotAlerts(alerts, monitorStateDir, now);
  } catch {
    console.error("[critical] ALERT_DELIVERY_FAILED: Operations alerts could not be delivered.");
    process.exitCode = 1;
    return;
  }

  if (alerts.some((alert) => alert.severity === "critical")) {
    process.exitCode = 1;
  }
}

async function checkHealth(healthUrl: string): Promise<OpsAlertInput["health"]> {
  try {
    const response = await fetch(healthUrl);
    const body = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    return {
      ok: response.ok && body?.ok === true,
      statusCode: response.status
    };
  } catch {
    return { ok: false };
  }
}

async function readBackupEvidence(backupDir: string): Promise<OpsAlertInput["backup"]> {
  let newestMarker: { name: string; mtimeMs: number; mtime: Date } | undefined;

  try {
    const entries = await readdir(backupDir, { withFileTypes: true });
    const markers = await Promise.all(
      entries
        .filter((entry) => entry.name.endsWith(".dump.sha256"))
        .map(async (entry) => {
          const markerStat = await lstat(resolve(backupDir, entry.name));
          return { name: entry.name, mtimeMs: markerStat.mtimeMs, mtime: markerStat.mtime };
        })
    );
    newestMarker = markers.sort((left, right) => {
      const timeOrder = right.mtimeMs - left.mtimeMs;
      if (timeOrder !== 0) return timeOrder;
      return left.name > right.name ? -1 : left.name < right.name ? 1 : 0;
    })[0];
  } catch {
    return {};
  }

  if (!newestMarker) {
    return {};
  }

  const latestBackupAt = newestMarker.mtime.toISOString();
  const markerPath = resolve(backupDir, newestMarker.name);
  const expectedArchiveName = newestMarker.name.slice(0, -".sha256".length);

  try {
    const markerFile = await openRegularFileNoFollow(markerPath);
    let marker: string;
    try {
      if (markerFile.stat.size > 256) {
        return { latestBackupAt, latestBackupSucceeded: false };
      }
      marker = await markerFile.handle.readFile("utf8");
    } finally {
      await markerFile.handle.close();
    }

    const match = /^([0-9a-f]{64})  ([^/\\\r\n]+\.dump)\n$/u.exec(marker);
    if (!match || match[2] !== expectedArchiveName || basename(match[2]) !== match[2]) {
      return { latestBackupAt, latestBackupSucceeded: false };
    }

    const archiveFile = await openRegularFileNoFollow(resolve(backupDir, expectedArchiveName));
    try {
      const actualHash = await sha256File(archiveFile.handle);
      return { latestBackupAt, latestBackupSucceeded: actualHash === match[1] };
    } finally {
      await archiveFile.handle.close();
    }
  } catch {
    return { latestBackupAt, latestBackupSucceeded: false };
  }
}

async function openRegularFileNoFollow(path: string): Promise<{ handle: FileHandle; stat: Awaited<ReturnType<FileHandle["stat"]>> }> {
  const pathStatBefore = await lstat(path);
  if (!pathStatBefore.isFile()) {
    throw new Error("Backup evidence must be a regular file");
  }

  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const openedStat = await handle.stat();
    const pathStatAfter = await lstat(path);
    if (
      !openedStat.isFile() ||
      !pathStatAfter.isFile() ||
      openedStat.dev !== pathStatBefore.dev ||
      openedStat.ino !== pathStatBefore.ino ||
      openedStat.dev !== pathStatAfter.dev ||
      openedStat.ino !== pathStatAfter.ino
    ) {
      throw new Error("Backup evidence changed while it was opened");
    }
    return { handle, stat: openedStat };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function sha256File(handle: FileHandle): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = handle.createReadStream({ autoClose: false, start: 0 });
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function readOptionalJson(path: string): Promise<JsonMap | undefined> {
  try {
    await access(path);
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as JsonMap;
  } catch {
    return undefined;
  }
}

function readString(source: JsonMap | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(source: JsonMap | undefined, key: string): number | undefined {
  const value = source?.[key];
  return typeof value === "number" ? value : undefined;
}

function readRecord(source: JsonMap | undefined, key: string): JsonMap | undefined {
  const value = source?.[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonMap) : undefined;
}

function toFailureMap(source: JsonMap | undefined): Record<string, number> {
  if (!source) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(source)
      .filter(([, value]) => typeof value === "number")
      .map(([companyId, value]) => [companyId, value as number])
  );
}

function readEnvNumber(name: string): number | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
