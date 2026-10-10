import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildSystemicCompletenessAuditReport } from "../../scripts/systemic-completeness-audit";

describe("systemic completeness audit report", () => {
  it("fails closed without an explicit historical-only acknowledgement", async () => {
    await expect(
      buildSystemicCompletenessAuditReport({
        companies: candidateCompanies,
        plans: buildSourceCrawlPlans(candidateCompanies),
        db: {} as never,
        auditTimestamp: "2026-07-09T00:00:00.000Z"
      })
    ).rejects.toThrow(/superseded.*not release[- ]eligible/i);
  });

  it("freezes all current planned-source counts when persisted observations are unavailable", async () => {
    const db = {
      crawlObservation: {
        findMany: async () => {
          throw new Error("Can't reach database server at `localhost:5432`");
        }
      },
      job: {
        groupBy: async () => []
      }
    };

    const report = await buildSystemicCompletenessAuditReport({
      companies: candidateCompanies,
      plans: buildSourceCrawlPlans(candidateCompanies),
      db: db as never,
      auditTimestamp: "2026-07-09T00:00:00.000Z",
      historicalOnlyAcknowledgement: "ACKNOWLEDGE_SUPERSEDED_NOT_RELEASE_ELIGIBLE"
    });

    expect(report).toMatchObject({
      historicalStatus: "SUPERSEDED_HISTORICAL_ONLY",
      releaseGateEligible: false,
      controllingPlanPath: "docs/superpowers/plans/2026-07-10-p0-recovery-and-release-evidence.md",
      supersededOn: "2026-07-12"
    });
    expect(report.supersededReason).toMatch(/judgment update/i);
    expect(report.supersededReason).toMatch(/no replacement inference/i);
    expect(report.trustFreezeStatus).toBe("UNTRUSTED_PENDING_COMPLETENESS_AUDIT");
    expect(report.persistedObservationAvailable).toBe(false);
    expect(report.persistedObservationError).toContain("Can't reach database server");
    expect(report.officialEntryAudit).toHaveLength(60);
    expect(report.sourceCompletenessAudit).toHaveLength(0);
    expect(report.sourceCompletenessAudit.every((row) => row.completenessStatus === "BLOCKED")).toBe(
      true
    );
    expect(JSON.stringify(report)).not.toMatch(/should be replaced by ranked backfill/i);
  });

  it("is not exposed by package scripts or current readiness imports", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(JSON.stringify(packageJson.scripts ?? {})).not.toContain("systemic-completeness-audit");

    const readinessImports = readdirSync("src/readiness")
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(join("src/readiness", file), "utf8"))
      .join("\n");
    expect(readinessImports).not.toContain("systemic-completeness-audit");
    expect(readinessImports).not.toContain("buildSystemicCompletenessAuditReport");

    const historicalAuditSource = readFileSync(
      "scripts/systemic-completeness-audit.ts",
      "utf8"
    );
    expect(historicalAuditSource).not.toContain(
      "Current source counts must not be delivered for manual review"
    );
    expect(historicalAuditSource).not.toContain("should be replaced by ranked backfill");
  });
});
