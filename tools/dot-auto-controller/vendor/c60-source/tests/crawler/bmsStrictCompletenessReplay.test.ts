import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";

describe("BMS public China source contract", () => {
  it("uses the official Eightfold China query without an expected-count knob", () => {
    const plan = getPlanBySourceId(
      buildStagedSourceCrawlPlans(candidateCompanies),
      "source-bms-china-social"
    );
    expect(plan).toMatchObject({
      adapterId: "official-json",
      source: {
        officialEntryUrl: expect.stringContaining("jobs.bms.com/careers"),
        atsKind: "OFFICIAL_JSON"
      },
      officialJsonFetch: {
        kind: "eightfold-pcsx",
        domain: "bms.com",
        location: "china",
        pageSize: 10
      }
    });
    expect(JSON.stringify(plan)).not.toMatch(/expected(?:Job)?Count|manualCount/iu);
  });

  it("binds location changes into the staged-plan identity", () => {
    const plan = getPlanBySourceId(
      buildStagedSourceCrawlPlans(candidateCompanies),
      "source-bms-china-social"
    );
    if (plan?.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "eightfold-pcsx") {
      throw new Error("Expected canonical BMS Eightfold plan");
    }
    const changed = {
      ...plan,
      officialJsonFetch: { ...plan.officialJsonFetch, location: "global" }
    } as typeof plan;
    expect(sourcePlanConfigSha256(changed)).not.toBe(sourcePlanConfigSha256(plan));
  });
});
