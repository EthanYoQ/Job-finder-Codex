import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";

describe("Aspen China recruitment source (formerly Sandoz China)", () => {
  it("uses the manually verified Aspen public page and derives zero from page structure", () => {
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
    expect(JSON.stringify(plan)).not.toMatch(/expected(?:Job)?Count|manualCount/iu);
  });
});
