import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { OpsAlert } from "../../src/server/opsMonitoring";

const now = new Date("2026-07-08T12:00:00.000Z");
const modulePath = resolve(process.cwd(), "src/server/opsMonitoring.ts");

async function loadOpsMonitoringModule() {
  expect(existsSync(modulePath), `${modulePath} should exist`).toBe(true);
  return import(pathToFileURL(modulePath).href);
}

describe("ops monitoring alerts", () => {
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
        crawl: { authorityState: "VALID", attemptState: "SUCCESS", summaryState: "VALID", globalSuccessRate: 0.95, consecutiveFailuresByCompany: { "company-a": 2 } },
        certificate: { expiresAt: "2026-08-20T00:00:00.000Z" },
        resources: { diskUsedPercent: 62, memoryUsedPercent: 58 },
        traffic: { requestsLastHour: 1050, baselineRequestsPerHour: 1000 }
      })
    ).toEqual([]);
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
    ["VALID", "FAILED", "CRAWL_ATTEMPT_FAILED"],
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
