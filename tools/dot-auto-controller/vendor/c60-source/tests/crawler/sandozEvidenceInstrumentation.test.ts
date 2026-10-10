import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";

describe("Aspen China recruitment source (formerly Sandoz China)", () => {
  it("keeps the selected Aspen page without deriving zero from recruitment prose", () => {
    const plan = getPlanBySourceId(
      buildStagedSourceCrawlPlans(candidateCompanies),
      "source-sandoz-china-social"
    );
    expect(plan).toMatchObject({
      adapterId: "html-table",
      source: {
        officialEntryUrl: "https://www.aspenpharma.cn/careers-at-aspen/aspen-cnjobs/",
        atsKind: "OFFICIAL_HTML"
      },
      table: {
        completenessProof: { kind: "STATIC_PUBLIC_LIST" }
      }
    });
    if (plan?.adapterId !== "html-table") throw new Error("missing Aspen plan");
    expect(plan.table.staticPublicList?.explicitEmptyState).toBeUndefined();
    expect(JSON.stringify(plan)).not.toMatch(/expected(?:Job)?Count|manualCount/iu);
  });
});
