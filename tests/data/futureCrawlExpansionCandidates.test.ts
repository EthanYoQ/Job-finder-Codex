import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import {
  EXISTING_ROSTER_REQUALIFICATION_CANDIDATES,
  FUTURE_CRAWL_EXPANSION_CANDIDATES,
  FUTURE_CRAWL_INTAKE
} from "../../src/data/futureCrawlExpansionCandidates";

describe("future crawl expansion intake", () => {
  it("keeps nine new companies separate from the existing roster and requalifies 3SBio explicitly", () => {
    expect(FUTURE_CRAWL_INTAKE).toHaveLength(10);
    expect(FUTURE_CRAWL_EXPANSION_CANDIDATES).toHaveLength(9);
    expect(EXISTING_ROSTER_REQUALIFICATION_CANDIDATES.map(({ companyId }) => companyId)).toEqual(["company-3sbio"]);
    const existing = new Set(candidateCompanies.map(({ id }) => id));
    expect(FUTURE_CRAWL_EXPANSION_CANDIDATES.filter(({ companyId }) => existing.has(companyId))).toEqual([]);
  });

  it("requires an executable time window or an explicit unavailable state", () => {
    for (const candidate of FUTURE_CRAWL_INTAKE) {
      if (candidate.recencyPolicy.kind === "CRAWLER_DATE_WINDOW") {
        expect(candidate.recencyPolicy.days).toBe(183);
        expect(candidate.recencyPolicy.sourceField).toBeTruthy();
      } else if (candidate.recencyPolicy.kind === "SOURCE_NATIVE_WINDOW") {
        expect(candidate.recencyPolicy.days).toBe(180);
        expect(["d", "PostDate"]).toContain(candidate.recencyPolicy.queryParameter);
      } else {
        expect(candidate.companyId).toBe("company-zaiding");
        expect(candidate.recencyPolicy.reason).toBeTruthy();
      }
    }
    expect(new Set(FUTURE_CRAWL_INTAKE.map(({ companyId }) => companyId)).size).toBe(10);
    expect(new Set(FUTURE_CRAWL_INTAKE.map(({ officialEntryUrl }) => officialEntryUrl)).size).toBe(10);
    expect(FUTURE_CRAWL_INTAKE.filter(({ extractionMethod }) =>
      extractionMethod === "BEISEN_2022_API_PAGINATION"
    ).every(({ recencyPolicy }) =>
      recencyPolicy.kind === "SOURCE_NATIVE_WINDOW" && recencyPolicy.queryParameter === "PostDate"
    )).toBe(true);
  });
});
