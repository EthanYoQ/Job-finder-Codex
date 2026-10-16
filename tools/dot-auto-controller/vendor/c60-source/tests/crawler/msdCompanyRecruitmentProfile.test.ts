import { describe, expect, it } from "vitest";
import { profile_msd_china } from "../../src/crawler/companyRecruitmentProfiles/profiles/msd-china";
import { candidateCompanies } from "../../src/data/companyRegistry";

const officialSearchUrl = "https://jobs.msd.com/cn/zh/search-results";
const officialDetailBaseUrl = "https://jobs.msd.com/cn/zh/job";
const officialWorkdayEntryUrl = "https://msd.wd5.myworkdayjobs.com/SearchJobs";

describe("MSD company recruitment profile", () => {
  it("binds both endorsed official sources in the company profile instead of a shared global exception", () => {
    expect(profile_msd_china.sources).toHaveLength(1);
    expect(profile_msd_china.sources[0]).toMatchObject({
      sourceId: "source-msd-china-social",
      executionConfig: {
        adapterId: "official-json",
        transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 },
        profileBoundSource: {
          kind: "msd-dual-official",
          config: {
            officialSearchUrl,
            officialDetailBaseUrl,
            workdayEntryUrl: officialWorkdayEntryUrl,
            countryDescriptor: "China",
            pageSize: expect.any(Number),
            maxPages: expect.any(Number)
          }
        }
      }
    });
  });

  it("makes the user-visible official search page the directory entry while retaining the official ATS as corroboration", () => {
    const company = candidateCompanies.find((candidate) => candidate.id === "company-msd-china");
    expect(company).toMatchObject({
      sources: [{
        id: "source-msd-china-social",
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: officialSearchUrl,
        officialChainEvidenceUrl: officialSearchUrl
      }]
    });
    expect(officialSearchUrl.startsWith("https://jobs.msd.com/")).toBe(true);
    expect(officialWorkdayEntryUrl.startsWith("https://msd.wd5.myworkdayjobs.com/")).toBe(true);
  });
});
