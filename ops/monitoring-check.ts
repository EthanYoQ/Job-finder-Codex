import { access, readFile } from "node:fs/promises";
import { Socket } from "node:net";
import { URL } from "node:url";
import { evaluateOpsAlerts, type OpsAlertInput } from "../src/server/opsMonitoring";

interface JsonMap {
  [key: string]: unknown;
}

void main();

async function main(): Promise<void> {
  const healthUrl = process.env.HEALTHCHECK_URL ?? "http://127.0.0.1:3000/healthz";
  const databaseUrl = process.env.DATABASE_URL;
  const readinessSummaryPath =
    process.env.READINESS_SUMMARY_PATH ?? `${process.cwd()}/var/readiness-summary.json`;
  const crawlSummaryPath = process.env.CRAWL_SUMMARY_PATH ?? `${process.cwd()}/var/crawl-summary.json`;
  const certificateExpiresAt = process.env.CERTIFICATE_EXPIRES_AT;

  const [health, dbReachable, readinessSummary, crawlSummary] = await Promise.all([
    checkHealth(healthUrl),
    databaseUrl ? checkPostgresSocket(databaseUrl) : Promise.resolve<null | boolean>(null),
    readOptionalJson(readinessSummaryPath),
    readOptionalJson(crawlSummaryPath)
  ]);

  const alerts = evaluateOpsAlerts({
    now: process.env.MONITORING_NOW ? new Date(process.env.MONITORING_NOW) : new Date(),
    health,
    backup: {
      latestBackupAt:
        readString(crawlSummary, "latestBackupAt") ??
        readString(readinessSummary, "latestBackupAt") ??
        process.env.LATEST_BACKUP_AT,
      latestBackupSucceeded:
        readBoolean(crawlSummary, "latestBackupSucceeded") ??
        readBoolean(readinessSummary, "latestBackupSucceeded") ??
        process.env.LATEST_BACKUP_SUCCEEDED !== "false"
    },
    crawl: {
      globalSuccessRate:
        readNumber(crawlSummary, "globalSuccessRate") ?? readNumber(readinessSummary, "globalSuccessRate"),
      consecutiveFailuresByCompany: toFailureMap(
        readRecord(crawlSummary, "consecutiveFailuresByCompany") ??
          readRecord(readinessSummary, "consecutiveFailuresByCompany")
      )
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

  for (const alert of alerts) {
    console.error(`[${alert.severity}] ${alert.code}: ${alert.message}`);
  }

  if (dbReachable === false) {
    console.error("[critical] DATABASE_UNREACHABLE: PostgreSQL socket check failed.");
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

async function checkPostgresSocket(databaseUrl: string): Promise<boolean> {
  const url = new URL(databaseUrl);
  const port = Number(url.port || "5432");
  const host = url.hostname;

  return new Promise((resolve) => {
    const socket = new Socket();

    socket.setTimeout(3000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
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

function readBoolean(source: JsonMap | undefined, key: string): boolean | undefined {
  const value = source?.[key];
  return typeof value === "boolean" ? value : undefined;
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
