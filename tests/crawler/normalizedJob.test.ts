import { describe, expect, it } from "vitest";
import {
  NormalizedJobRecordSchema,
  buildJobDedupeKey,
  hasRequiredJobFields
} from "../../src/crawler/normalizedJob";

describe("normalized job record", () => {
  it("accepts the minimum P0 official-source job fields", () => {
    const record = NormalizedJobRecordSchema.parse({
      companyId: "company-astrazeneca",
      sourceId: "source-astrazeneca-social",
      sourceKind: "SOCIAL",
      atsKind: "OFFICIAL_JSON",
      officialChineseCompanyName: "阿斯利康制药有限公司",
      officialTitle: "Regional Sales Manager (Beijing)",
      auxiliaryChineseTitle: "区域销售经理（北京）",
      officialUrl: "https://job-search.astrazeneca.cn/job/123",
      listUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c",
      sourceJobId: "123",
      locationRaw: "北京",
      cities: ["北京"],
      category: "销售",
      isBaseline: true,
      evidence: {
        officialEntryUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c",
        officialChainEvidenceUrl: "https://www.astrazeneca.cn/careers",
        capturedAt: "2026-07-08T00:00:00.000Z"
      }
    });

    expect(hasRequiredJobFields(record)).toBe(true);
    expect(buildJobDedupeKey(record)).toBe("source-astrazeneca-social:123");
  });

  it("rejects non-social records for P0 front-end ingestion", () => {
    expect(() =>
      NormalizedJobRecordSchema.parse({
        companyId: "company-campus",
        sourceId: "source-campus",
        sourceKind: "CAMPUS",
        atsKind: "MOKA",
        officialChineseCompanyName: "测试药企",
        officialTitle: "校园招聘",
        officialUrl: "https://example.com/campus",
        locationRaw: "北京",
        cities: ["北京"],
        category: "其他",
        isBaseline: false,
        evidence: {
          officialEntryUrl: "https://example.com/campus",
          officialChainEvidenceUrl: "https://example.com/careers",
          capturedAt: "2026-07-08T00:00:00.000Z"
        }
      })
    ).toThrow();
  });
});
