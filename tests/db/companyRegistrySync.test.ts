import { describe, expect, it, vi } from "vitest";
import type { CandidateCompany } from "../../src/data/companyRegistry";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { syncPlannedSourcesToDb } from "../../src/db/companyRegistrySync";

const plannedCompany: CandidateCompany = {
  id: "company-test",
  officialChineseName: "测试药企",
  officialWebsiteUrl: "https://example.com",
  pinyinName: "ceshi-yaoqi",
  inclusionReason: "测试来源",
  sources: [
    {
      id: "source-test-social",
      companyId: "company-test",
      kind: "SOCIAL",
      atsKind: "MOKA",
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
      officialChainEvidenceUrl: "https://example.com/careers"
    }
  ]
};

const plan: SourceCrawlPlan = {
  adapterId: "official-json",
  company: {
    id: plannedCompany.id,
    officialChineseName: plannedCompany.officialChineseName
  },
  source: {
    id: "source-test-social",
    companyId: "company-test",
    kind: "SOCIAL",
    atsKind: "MOKA",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
    officialChainEvidenceUrl: "https://example.com/careers"
  },
  json: {
    jobsPath: "data.jobs",
    fields: {
      sourceJobId: "id",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    },
    defaultCategory: "其他"
  }
};

function fakeDb() {
  return {
    company: {
      upsert: vi.fn(async (args: unknown) => args)
    },
    recruitmentSource: {
      upsert: vi.fn(async (args: unknown) => args)
    }
  };
}

describe("syncPlannedSourcesToDb", () => {
  it("upserts only companies and sources referenced by crawl plans", async () => {
    const db = fakeDb();

    const result = await syncPlannedSourcesToDb([plan], [plannedCompany], db);

    expect(result).toEqual({ companyCount: 1, sourceCount: 1 });
    expect(db.company.upsert).toHaveBeenCalledWith({
      where: { id: "company-test" },
      create: {
        id: "company-test",
        officialChineseName: "测试药企",
        officialWebsiteUrl: "https://example.com",
        pinyinName: "ceshi-yaoqi",
        inclusionReason: "测试来源"
      },
      update: {
        officialChineseName: "测试药企",
        officialWebsiteUrl: "https://example.com",
        pinyinName: "ceshi-yaoqi",
        inclusionReason: "测试来源"
      }
    });
    expect(db.recruitmentSource.upsert).toHaveBeenCalledWith({
      where: { id: "source-test-social" },
      create: {
        id: "source-test-social",
        companyId: "company-test",
        kind: "SOCIAL",
        atsKind: "MOKA",
        officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
        officialChainEvidenceUrl: "https://example.com/careers",
        status: "VERIFIED_SCRAPABLE"
      },
      update: {
        kind: "SOCIAL",
        atsKind: "MOKA",
        officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
        officialChainEvidenceUrl: "https://example.com/careers",
        status: "VERIFIED_SCRAPABLE"
      }
    });
  });

  it("throws instead of writing fake company website URLs", async () => {
    const db = fakeDb();
    const { officialWebsiteUrl: _officialWebsiteUrl, ...companyWithoutWebsite } = plannedCompany;

    await expect(
      syncPlannedSourcesToDb([plan], [companyWithoutWebsite], db)
    ).rejects.toThrow("company-test is missing officialWebsiteUrl");

    expect(db.company.upsert).not.toHaveBeenCalled();
    expect(db.recruitmentSource.upsert).not.toHaveBeenCalled();
  });
});
