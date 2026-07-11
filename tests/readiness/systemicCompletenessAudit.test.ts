import { describe, expect, it } from "vitest";
import { buildSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildSystemicCompletenessAuditReport } from "../../scripts/systemic-completeness-audit";

describe("systemic completeness audit report", () => {
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
      auditTimestamp: "2026-07-09T00:00:00.000Z"
    });

    expect(report.trustFreezeStatus).toBe("UNTRUSTED_PENDING_COMPLETENESS_AUDIT");
    expect(report.persistedObservationAvailable).toBe(false);
    expect(report.persistedObservationError).toContain("Can't reach database server");
    expect(report.officialEntryAudit).toHaveLength(60);
    expect(report.sourceCompletenessAudit).toHaveLength(0);
    expect(report.sourceCompletenessAudit.every((row) => row.completenessStatus === "BLOCKED")).toBe(
      true
    );
  });
});
