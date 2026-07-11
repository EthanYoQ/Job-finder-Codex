import { describe, expect, it } from "vitest";
import {
  candidateCompanies,
  getCandidatePoolStats,
  getSocialSources
} from "../../src/data/companyRegistry";

const excludedCompanyNames = [
  "爱德华生命科学中国",
  "科赴中国",
  "美敦力中国",
  "赛默飞世尔科技中国",
  "通用电气医疗中国",
  "雅培中国",
  "史赛克中国",
  "安捷伦科技（中国）有限公司",
  "赫力昂（中国）有限公司"
];

function collectCandidateUrls(candidate: (typeof candidateCompanies)[number]): string[] {
  const companyUrls = [candidate.officialWebsiteUrl];
  const sourceUrls = candidate.sources.flatMap((source) => [
    source.officialEntryUrl,
    source.officialChainEvidenceUrl,
    source.campusEntryUrl
  ]);

  return [...companyUrls, ...sourceUrls].filter((url): url is string => Boolean(url));
}

describe("60-company pharma registry", () => {
  it("contains exactly 30 foreign and 30 domestic target companies", () => {
    const foreignCompanies = candidateCompanies.filter(
      (company) => company.category === "FOREIGN_PHARMA"
    );
    const domesticCompanies = candidateCompanies.filter(
      (company) => company.category === "DOMESTIC_PHARMA"
    );
    expect(candidateCompanies).toHaveLength(60);
    expect(foreignCompanies).toHaveLength(30);
    expect(domesticCompanies).toHaveLength(30);
  });

  it("excludes device, life-science tool, consumer-health, and pure diagnostics companies", () => {
    const names = new Set(candidateCompanies.map((company) => company.officialChineseName));

    for (const excludedName of excludedCompanyNames) {
      expect(names.has(excludedName)).toBe(false);
    }
  });

  it("uses one social source per active company before campus expansion", () => {
    const socialSources = getSocialSources(candidateCompanies);

    expect(socialSources).toHaveLength(60);
    expect(socialSources.every((source) => source.kind === "SOCIAL")).toBe(true);
  });

  it("does not use placeholder .invalid URLs for candidate provenance", () => {
    const urls = candidateCompanies.flatMap(collectCandidateUrls);

    expect(urls.some((url) => url.includes(".invalid"))).toBe(false);
  });

  it("requires official-chain URLs before a source can be marked verified scrapable", () => {
    const companiesById = new Map(candidateCompanies.map((company) => [company.id, company]));
    const verifiedSocialSources = getSocialSources(candidateCompanies).filter(
      (source) => source.status === "VERIFIED_SCRAPABLE"
    );

    expect(verifiedSocialSources.length).toBeGreaterThan(0);

    for (const source of verifiedSocialSources) {
      const company = companiesById.get(source.companyId);

      expect(company?.officialWebsiteUrl).toEqual(expect.any(String));
      expect(source.officialEntryUrl).toEqual(expect.any(String));
      expect(source.officialChainEvidenceUrl).toEqual(expect.any(String));
    }
  });

  it("keeps unresolved foreign targets in the roster without replacement", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));
    const astellasSource = byId.get("company-astellas-china")?.sources[0];

    expect(astellasSource?.status).toBe("VERIFIED_SCRAPABLE");
    expect(astellasSource?.atsKind).toBe("OFFICIAL_HTML");
    expect(astellasSource?.officialEntryUrl).toEqual(expect.any(String));
    expect(byId.get("company-otsuka-china")?.targetStatus).toBe("BLOCKED_NO_PUBLIC_SOURCE");
    expect(byId.get("company-sandoz-china")?.targetStatus).toBe("BLOCKED_NO_PUBLIC_SOURCE");
    expect(byId.has("company-beta-pharma")).toBe(false);
    expect(byId.has("company-sinocelltech")).toBe(false);
    expect(byId.has("company-jacobio")).toBe(false);
  });

  it("reports registry-level launchability only after all 60 sources are configured", () => {
    const stats = getCandidatePoolStats(candidateCompanies);

    expect(stats.totalCandidates).toBe(60);
    expect(stats.socialSources).toBeGreaterThanOrEqual(60);
    expect(stats.verifiedScrapableCompanies).toBeLessThan(60);
    expect(stats.canLaunchP0).toBe(false);
  });

  it("includes critical foreign pharma additions from the rebuilt list", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-abbvie-china")).toMatchObject({
      officialChineseName: "艾伯维中国",
      category: "FOREIGN_PHARMA"
    });
    expect(byId.get("company-servier-china")).toMatchObject({
      officialChineseName: "施维雅中国",
      category: "FOREIGN_PHARMA"
    });
    expect(byId.get("company-ucb-china")).toMatchObject({
      officialChineseName: "优时比中国",
      category: "FOREIGN_PHARMA"
    });
  });
});
