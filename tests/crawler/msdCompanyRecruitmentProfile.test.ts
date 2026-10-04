import { describe, expect, it } from "vitest";
import { profile_msd_china } from "../../src/crawler/companyRecruitmentProfiles/profiles/msd-china";
import { candidateCompanies } from "../../src/data/companyRegistry";

const officialSearchUrl = "https://www.ajinga.com/msdchina/professionals";

describe("MSD company recruitment profile", () => {
  it("binds the current Ajinga professional source and its bounded company-specific traversal", () => {
    expect(profile_msd_china.sources).toHaveLength(1);
    expect(profile_msd_china.sources[0]).toMatchObject({
      sourceId: "source-msd-china-social",
      executionConfig: {
        adapterId: "official-json",
        transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 },
        profileBoundSource: {
          kind: "msd-ajinga",
          config: {
            entryUrl: officialSearchUrl,
            companyId: 13471,
            pageSize: expect.any(Number),
            maxPages: expect.any(Number)
          }
        }
      }
    });
  });

  it("makes the current Ajinga professional page the directory entry and chain evidence", () => {
    const company = candidateCompanies.find((candidate) => candidate.id === "company-msd-china");
    expect(company).toMatchObject({
      sources: [{
        id: "source-msd-china-social",
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: officialSearchUrl,
        officialChainEvidenceUrl: officialSearchUrl
      }]
    });
    expect(officialSearchUrl.startsWith("https://www.ajinga.com/")).toBe(true);
  });
});
