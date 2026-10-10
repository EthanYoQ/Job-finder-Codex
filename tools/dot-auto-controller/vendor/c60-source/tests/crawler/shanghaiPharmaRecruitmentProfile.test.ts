import { describe, expect, it } from "vitest";
import {
  companyRecruitmentProfiles
} from "../../src/crawler/companyRecruitmentProfiles";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId
} from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const COMPANY_ID = "company-shanghai-pharma";
const SOURCE_ID = "source-shanghai-pharma-social";
const OFFICIAL_CHAIN = "https://www.sphchina.com/html/footer.html";
const OFFICIAL_ENTRY = "https://sph.zhiye.com/social/jobs";

describe("Shanghai Pharma official social recruitment profile", () => {
  it("binds the fixed roster company to its website-endorsed Beisen social entry", () => {
    const company = candidateCompanies.find(({ id }) => id === COMPANY_ID);

    expect(company).toMatchObject({
      id: COMPANY_ID,
      officialChineseName: "上海医药集团股份有限公司",
      officialWebsiteUrl: "https://www.sphchina.com/",
      targetStatus: "ACTIVE",
      sources: [{
        id: SOURCE_ID,
        companyId: COMPANY_ID,
        kind: "SOCIAL",
        atsKind: "BEISEN_ZHIYE",
        status: "VERIFIED_SCRAPABLE",
        officialEntryUrl: OFFICIAL_ENTRY,
        officialChainEvidenceUrl: OFFICIAL_CHAIN
      }]
    });
  });

  it("keeps the Shanghai sibling-location rule in this company profile and emits an executable staged plan", () => {
    const profile = companyRecruitmentProfiles.find(({ companyId }) => companyId === COMPANY_ID);
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), SOURCE_ID);

    expect(profile).toMatchObject({
      companyId: COMPANY_ID,
      sources: [{
        companyId: COMPANY_ID,
        sourceId: SOURCE_ID,
        officialEntryAllowedUrls: [OFFICIAL_ENTRY],
        officialChainEvidenceUrl: OFFICIAL_CHAIN,
        atsKind: "BEISEN_ZHIYE",
        chinaSocialScope: {
          channel: "SOCIAL",
          geography: "MAINLAND_CHINA",
          authority: "OFFICIAL_LINK_OR_EXPLICIT_ENDORSEMENT"
        },
        executionConfig: {
          adapterId: "official-json",
          officialJsonFetch: {
            kind: "beisen-zhiye-2022",
            geographyScope: "DOMESTIC_OFFICIAL_TENANT",
            mixedLocationPolicy: "INHERIT_MAINLAND_PARENT_FOR_SIBLING_LOCATIONS",
            category: "1",
            pageSize: 100,
            detailPath: "social/detail"
          }
        }
      }]
    });
    expect(plan).toMatchObject({
      adapterId: "official-json",
      company: { id: COMPANY_ID },
      source: {
        id: SOURCE_ID,
        companyId: COMPANY_ID,
        atsKind: "BEISEN_ZHIYE",
        status: "VERIFIED_SCRAPABLE",
        officialEntryUrl: OFFICIAL_ENTRY,
        officialChainEvidenceUrl: OFFICIAL_CHAIN
      },
      officialJsonFetch: {
        kind: "beisen-zhiye-2022",
        geographyScope: "DOMESTIC_OFFICIAL_TENANT",
        mixedLocationPolicy: "INHERIT_MAINLAND_PARENT_FOR_SIBLING_LOCATIONS",
        category: "1",
        pageSize: 100,
        detailPath: "social/detail"
      }
    });
  });
});
