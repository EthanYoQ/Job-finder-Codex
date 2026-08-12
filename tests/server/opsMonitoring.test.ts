import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { OpsAlert, OpsAlertInput } from "../../src/server/opsMonitoring";

const now = new Date("2026-07-08T12:00:00.000Z");
const modulePath = resolve(process.cwd(), "src/server/opsMonitoring.ts");

async function loadOpsMonitoringModule() {
  expect(existsSync(modulePath), `${modulePath} should exist`).toBe(true);
  return import(pathToFileURL(modulePath).href);
}

describe("ops monitoring alerts", () => {
  type MonitorPatch = {
    health?: OpsAlertInput["health"];
    database?: OpsAlertInput["database"];
    backup?: Partial<OpsAlertInput["backup"]>;
    crawl?: Partial<OpsAlertInput["crawl"]>;
  };
  const requiredFailureCases = [
    ["website not ready", { health: { ok: false, statusCode: 503 } }, "WEBSITE_DOWN"],
    ["database unavailable", { database: { ok: false } }, "DATABASE_UNREACHABLE"],
    ["formal crawl stale", { crawl: { attemptState: "STALE" } }, "CRAWL_ATTEMPT_STALE"],
    ["mandatory company failed once", { crawl: { consecutiveFailuresByCompany: { "company-a": 1 } } }, "MANDATORY_COMPANY_FAILURE"],
    ["completeness failed", { crawl: { completenessFailureCount: 1 } }, "CRAWL_COMPLETENESS_FAILURE"],
    ["backup failed", { backup: { latestBackupSucceeded: false } }, "BACKUP_FAILED"]
  ] as const satisfies readonly (readonly [string, MonitorPatch, OpsAlert["code"]])[];
  it.each(requiredFailureCases)("emits a nonzero-severity signal and recovers for %s", async (_label, patch, code) => {
    const { evaluateOpsAlerts } = await loadOpsMonitoringModule();
    const typedPatch: MonitorPatch = patch;
    const healthy = {
      now,
      health: { ok: true, statusCode: 200 },
      database: { ok: true },
      backup: { latestBackupAt: "2026-07-08T10:00:00.000Z", latestBackupSucceeded: true },
      crawl: {
        authorityState: "VALID" as const,
        attemptState: "SUCCESS" as const,
        summaryState: "VALID" as const,
        globalSuccessRate: 1,
        consecutiveFailuresByCompany: {},
        completenessFailureCount: 0
      }
    };
    const failing = {
      ...healthy,
      ...typedPatch,
      crawl: { ...healthy.crawl, ...(typedPatch.crawl ?? {}) },
      backup: { ...healthy.backup, ...(typedPatch.backup ?? {}) }
    };
    const failingAlerts = evaluateOpsAlerts(failing) as OpsAlert[];
    const healthyAlerts = evaluateOpsAlerts(healthy) as OpsAlert[];
    expect(failingAlerts.find((alert) => alert.code === code)).toMatchObject({ severity: "critical" });
    expect(healthyAlerts.some((alert) => alert.code === code)).toBe(false);
  });

  it("emits an exact identity-bound one-shot alert for the two-round initial qualification pause", async () => {
    const { evaluateOpsAlerts } = await loadOpsMonitoringModule();
    const notificationKey = "a".repeat(64);
    const alerts = evaluateOpsAlerts({
      now,
      health: { ok: true, statusCode: 200 },
      backup: { latestBackupAt: "2026-07-08T10:00:00.000Z", latestBackupSucceeded: true },
      crawl: {
        authorityState: "PAUSED",
        attemptState: "PAUSED",
        summaryState: "VALID",
        globalSuccessRate: 1,
        consecutiveFailuresByCompany: {},
        initialQualificationPause: {
          notificationKey,
          releaseCandidateId: "rc-pause",
          batchId: "batch-second-round",
          completedRoundCount: 2,
          stableCompanyCount: 44,
          minimumStableCompanyCount: 45
        }
      }
    }) as OpsAlert[];

    expect(alerts).toContainEqual({
      code: "INITIAL_QUALIFICATION_PAUSED_BELOW_MINIMUM",
      severity: "critical",
      message: "Initial qualification paused after exactly two completed rounds: 44/45 stable companies. No third qualification round is allowed.",
      dedupeKey: `initial-qualification-pause:${notificationKey}`,
      metadata: {
        releaseCandidateId: "rc-pause",
        batchId: "batch-second-round",
        completedRoundCount: 2,
        stableCompanyCount: 44,
        minimumStableCompanyCount: 45
      }
    });
    expect(alerts).not.toContainEqual(expect.objectContaining({ code: "CRAWL_ATTEMPT_FAILED" }));
  });

  it("raises immediate alerts for website downtime, backup failure, and database resource exhaustion", async () => {
    const { evaluateOpsAlerts } = await loadOpsMonitoringModule();

    const alerts = evaluateOpsAlerts({
      now,
      health: { ok: false, statusCode: 503 },
      backup: { latestBackupAt: "2026-07-08T10:00:00.000Z", latestBackupSucceeded: false },
      crawl: { authorityState: "VALID", attemptState: "SUCCESS", summaryState: "VALID", globalSuccessRate: 0.92, consecutiveFailuresByCompany: {} },
      certificate: { expiresAt: "2026-08-20T00:00:00.000Z" },
      resources: { diskUsedPercent: 93, memoryUsedPercent: 91 },
      traffic: { requestsLastHour: 1200, baselineRequestsPerHour: 1000 }
    }) as OpsAlert[];

    expect(alerts.map((alert) => alert.code)).toEqual(
      expect.arrayContaining([
        "WEBSITE_DOWN",
        "BACKUP_FAILED",
        "HIGH_DISK_USAGE",
        "HIGH_MEMORY_USAGE"
      ])
    );
  });

  it("alerts on crawl quality regressions, certificate expiry, and abnormal traffic spikes", async () => {
    const { evaluateOpsAlerts } = await loadOpsMonitoringModule();

    const alerts = evaluateOpsAlerts({
      now,
      health: { ok: true, statusCode: 200 },
      backup: { latestBackupAt: "2026-07-08T10:00:00.000Z", latestBackupSucceeded: true },
      crawl: {
        authorityState: "VALID",
        attemptState: "SUCCESS",
        summaryState: "VALID",
        globalSuccessRate: 0.79,
        consecutiveFailuresByCompany: {
          "company-a": 3,
          "company-b": 1
        }
      },
      certificate: { expiresAt: "2026-07-14T00:00:00.000Z" },
      resources: { diskUsedPercent: 61, memoryUsedPercent: 54 },
      traffic: { requestsLastHour: 4500, baselineRequestsPerHour: 1000 }
    }) as OpsAlert[];

    expect(alerts.map((alert) => alert.code)).toEqual(
      expect.arrayContaining([
        "CRAWL_SUCCESS_BELOW_SLO",
        "COMPANY_CONSECUTIVE_FAILURES",
        "CERTIFICATE_EXPIRING",
        "ABNORMAL_TRAFFIC"
      ])
    );
    expect(alerts.find((alert) => alert.code === "COMPANY_CONSECUTIVE_FAILURES")?.metadata).toMatchObject({
      companies: ["company-a"]
    });
  });

  it("stays quiet when core health, backup, crawl, certificate, and resource signals are normal", async () => {
    const { evaluateOpsAlerts } = await loadOpsMonitoringModule();

    expect(
      evaluateOpsAlerts({
        now,
        health: { ok: true, statusCode: 200 },
        backup: { latestBackupAt: "2026-07-08T10:00:00.000Z", latestBackupSucceeded: true },
        crawl: { authorityState: "VALID", attemptState: "SUCCESS", summaryState: "VALID", globalSuccessRate: 1, consecutiveFailuresByCompany: { "company-a": 0 } },
        certificate: { expiresAt: "2026-08-20T00:00:00.000Z" },
        resources: { diskUsedPercent: 62, memoryUsedPercent: 58 },
        traffic: { requestsLastHour: 1050, baselineRequestsPerHour: 1000 }
      })
    ).toEqual([]);
  });

  it("warns without stopping the site when a partial crawl remains above the service level", async () => {
    const { evaluateOpsAlerts } = await loadOpsMonitoringModule();
    const alerts = evaluateOpsAlerts({
      now,
      health: { ok: true, statusCode: 200 },
      backup: { latestBackupAt: "2026-07-08T10:00:00.000Z", latestBackupSucceeded: true },
      crawl: {
        authorityState: "VALID",
        attemptState: "SUCCESS",
        summaryState: "VALID",
        globalSuccessRate: 0.98,
        consecutiveFailuresByCompany: { "company-a": 1 }
      }
    }) as OpsAlert[];

    expect(alerts).toContainEqual(expect.objectContaining({ code: "CRAWL_PARTIAL_COMPANY_RESULTS", severity: "critical" }));
  });

  it("keeps a low post-launch partial result advisory because healthy companies publish independently", async () => {
    const { evaluateOpsAlerts } = await loadOpsMonitoringModule();
    const alerts = evaluateOpsAlerts({
      now,
      health: { ok: true, statusCode: 200 },
      backup: { latestBackupAt: "2026-07-08T10:00:00.000Z", latestBackupSucceeded: true },
      crawl: {
        authorityState: "VALID",
        attemptState: "SUCCESS",
        summaryState: "VALID",
        globalSuccessRate: 0.5,
        consecutiveFailuresByCompany: { "company-a": 1 }
      }
    }) as OpsAlert[];

    expect(alerts).toContainEqual(expect.objectContaining({ code: "CRAWL_SUCCESS_BELOW_SLO", severity: "critical" }));
  });

  it("keeps a real crawl execution failure distinct from partial company results", async () => {
    const { evaluateOpsAlerts } = await loadOpsMonitoringModule();
    const alerts = evaluateOpsAlerts({
      now,
      health: { ok: true, statusCode: 200 },
      backup: { latestBackupAt: "2026-07-08T10:00:00.000Z", latestBackupSucceeded: true },
      crawl: {
        authorityState: "VALID",
        attemptState: "FAILED",
        summaryState: "VALID",
        globalSuccessRate: 1,
        consecutiveFailuresByCompany: {}
      }
    }) as OpsAlert[];

    expect(alerts).toContainEqual(expect.objectContaining({ code: "CRAWL_ATTEMPT_FAILED", severity: "critical" }));
    expect(alerts).not.toContainEqual(expect.objectContaining({ code: "CRAWL_PARTIAL_COMPANY_RESULTS" }));
  });

  it.each([
    ["MISSING", "CRAWL_SUMMARY_MISSING"],
    ["INVALID", "CRAWL_SUMMARY_INVALID"],
    ["STALE", "CRAWL_SUMMARY_STALE"]
  ] as const)("fails closed for a %s crawl summary", async (summaryState, code) => {
    const { evaluateOpsAlerts } = await loadOpsMonitoringModule();
    const alerts = evaluateOpsAlerts({
      now,
      health: { ok: true, statusCode: 200 },
      backup: { latestBackupAt: "2026-07-08T10:00:00.000Z", latestBackupSucceeded: true },
      crawl: { authorityState: "VALID", attemptState: "SUCCESS", summaryState, consecutiveFailuresByCompany: {} }
    }) as OpsAlert[];

    expect(alerts).toContainEqual(expect.objectContaining({ code, severity: "critical" }));
  });

  it.each([
    ["INVALID", "SUCCESS", "CRAWL_AUTHORITY_INVALID"],
    ["VALID", "MISSING", "CRAWL_ATTEMPT_MISSING"],
    ["VALID", "INVALID", "CRAWL_ATTEMPT_INVALID"],
    ["VALID", "STALE", "CRAWL_ATTEMPT_STALE"]
  ] as const)("fails closed for authority=%s attempt=%s", async (authorityState, attemptState, code) => {
    const { evaluateOpsAlerts } = await loadOpsMonitoringModule();
    const alerts = evaluateOpsAlerts({
      now,
      health: { ok: true, statusCode: 200 },
      backup: { latestBackupAt: "2026-07-08T10:00:00.000Z", latestBackupSucceeded: true },
      crawl: { authorityState, attemptState, summaryState: "VALID", globalSuccessRate: 1,
        consecutiveFailuresByCompany: {} }
    }) as OpsAlert[];
    expect(alerts).toContainEqual(expect.objectContaining({ code, severity: "critical" }));
  });
});
