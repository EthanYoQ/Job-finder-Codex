import { describe, expect, it } from "vitest";
import {
  parseSourceDiscoveryCandidates,
  summarizeSourceDiscoveryCandidates
} from "../../src/crawler/sourceDiscovery";

describe("source discovery candidates", () => {
  it("parses official-chain discovery candidates without making them readiness evidence", () => {
    const candidates = parseSourceDiscoveryCandidates([
      {
        companyId: "company-innovent",
        companyName: "信达生物制药（苏州）有限公司",
        officialWebsiteUrl: "https://www.innoventbio.com/",
        officialEntryUrl: "https://www.innoventbio.com/cn/careers/jobs",
        officialChainEvidenceUrl: "https://www.innoventbio.com/cn/careers",
        atsKind: "OFFICIAL_HTML",
        confidence: "HIGH",
        discoveryMethod: "official page inspection",
        selectorHint: ".job-list tr",
        formalEvidenceStatus: "DISCOVERED_NOT_COUNTED"
      }
    ]);

    expect(candidates).toEqual([
      {
        companyId: "company-innovent",
        companyName: "信达生物制药（苏州）有限公司",
        officialWebsiteUrl: "https://www.innoventbio.com/",
        officialEntryUrl: "https://www.innoventbio.com/cn/careers/jobs",
        officialChainEvidenceUrl: "https://www.innoventbio.com/cn/careers",
        atsKind: "OFFICIAL_HTML",
        confidence: "HIGH",
        discoveryMethod: "official page inspection",
        selectorHint: ".job-list tr",
        apiHint: undefined,
        formalEvidenceStatus: "DISCOVERED_NOT_COUNTED"
      }
    ]);
  });

  it("summarizes high-confidence candidates by ATS kind", () => {
    const candidates = parseSourceDiscoveryCandidates([
      {
        companyId: "company-a",
        companyName: "A",
        officialWebsiteUrl: "https://a.example/",
        officialEntryUrl: "https://a.example/jobs",
        officialChainEvidenceUrl: "https://a.example/careers",
        atsKind: "MOKA",
        confidence: "HIGH",
        discoveryMethod: "official page inspection",
        formalEvidenceStatus: "DISCOVERED_NOT_COUNTED"
      },
      {
        companyId: "company-b",
        companyName: "B",
        officialWebsiteUrl: "https://b.example/",
        officialEntryUrl: "https://b.example/jobs",
        officialChainEvidenceUrl: "https://b.example/careers",
        atsKind: "MOKA",
        confidence: "LOW",
        discoveryMethod: "search result only",
        formalEvidenceStatus: "DISCOVERED_NOT_COUNTED"
      }
    ]);

    expect(summarizeSourceDiscoveryCandidates(candidates)).toEqual({
      total: 2,
      highConfidence: 1,
      byAtsKind: { MOKA: 2 }
    });
  });
});
