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
    expect(candidateCompanies.filter((company) =>
      company.targetStatus === "USER_AUTHORIZED_PHASE1_EXCLUSION"
    ).map((company) => company.id).sort()).toEqual([
      "company-humanwell",
      "company-north-china-pharma"
    ]);
    expect(candidateCompanies.filter((company) =>
      company.targetStatus === "USER_AUTHORIZED_PHASE1_EXCLUSION"
    ).every((company) => company.sources.length === 0)).toBe(true);
  });

  it("excludes device, life-science tool, consumer-health, and pure diagnostics companies", () => {
    const names = new Set(candidateCompanies.map((company) => company.officialChineseName));

    for (const excludedName of excludedCompanyNames) {
      expect(names.has(excludedName)).toBe(false);
    }
  });

  it("keeps recorded social sources without imposing one source per company", () => {
    const socialSources = getSocialSources(candidateCompanies);

    expect(socialSources.length).toBeGreaterThan(0);
    expect(socialSources.every((source) => source.kind === "SOCIAL")).toBe(true);
    expect(new Set(socialSources.map((source) => source.id)).size).toBe(socialSources.length);
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
    expect(byId.get("company-otsuka-china")?.targetStatus).toBe("BLOCKED_EVIDENCE_GAP");
    expect(byId.get("company-sandoz-china")?.targetStatus).toBe("BLOCKED_EVIDENCE_GAP");
    expect(byId.has("company-beta-pharma")).toBe(false);
    expect(byId.has("company-sinocelltech")).toBe(false);
    expect(byId.has("company-jacobio")).toBe(false);
  });

  it("reports registry-level launchability from the audited official-link set", () => {
    const stats = getCandidatePoolStats(candidateCompanies);

    expect(stats.totalCandidates).toBe(60);
    expect(stats.authorizedExclusionCompanies).toBe(2);
    expect(stats.phase1InScopeCompanies).toBe(
      stats.totalCandidates - stats.authorizedExclusionCompanies
    );
    expect(stats.socialSources).toBe(getSocialSources(candidateCompanies).length);
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

  it("uses the fresh official source bindings and rejects the stale bindings", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-hengrui")?.sources[0]).toMatchObject({
      officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
      officialChainEvidenceUrl: "https://www.hengrui.com/development/joinUs.html",
      campusEntryUrl: "https://app.mokahr.com/m/campus-recruitment/hengrui/145997"
    });
    expect(byId.get("company-servier-china")?.sources[0]).toMatchObject({
      atsKind: "MOKA",
      officialEntryUrl: "https://www.servier.com.cn/social-recruitment/shiweiya/47734",
      officialChainEvidenceUrl: "https://www.servier.com.cn/social-recruitment/shiweiya/47734",
      campusEntryUrl: "https://www.servier.com.cn/campus-recruitment/shiweiya/70032"
    });
    expect(byId.get("company-ucb-china")?.sources[0]?.officialEntryUrl).toBe(
      "https://careers.ucb.com/global/en/search-results?qcountry=China"
    );
    expect(byId.get("company-roche-china")?.sources[0]).toMatchObject({
      atsKind: "OFFICIAL_JSON",
      officialEntryUrl: "https://careers.roche.com/cn/zh/search-results",
      officialChainEvidenceUrl: "https://careers.roche.com/cn/zh/china-mainland"
    });
    expect(byId.get("company-tianjin-pharma")?.sources[0]).toMatchObject({
      officialEntryUrl: "https://tjph.zhiye.com/social/jobs",
      officialChainEvidenceUrl: "https://www.pharm.com.cn/"
    });
    expect(byId.get("company-qilu")?.sources[0]?.officialEntryUrl).toBe(
      "https://qilu-pharma.zhiye.com/social/jobs"
    );
    expect(byId.get("company-nhu")?.sources[0]?.officialEntryUrl).toBe(
      "https://xinhecheng1.zhiye.com/social/jobs"
    );
    expect(byId.get("company-xinhua-pharma")?.sources[0]).toMatchObject({
      officialEntryUrl: "https://www.xhzy.com/SHZP/index.html",
      officialChainEvidenceUrl: "https://www.xhzy.com/SHZP/index.html"
    });

    const urls = candidateCompanies.flatMap(collectCandidateUrls);
    expect(urls).not.toContain("https://careers.ucb.com/global/en/search-results?keywords=China");
    expect(urls).not.toContain("https://www.hengrui.com/development/recruit.html");
    expect(urls).not.toContain("https://tjph1.zhiye.com/social/jobs");
    expect(urls).not.toContain("https://www.pharm.com.cn/career/join.html");
    expect(urls).not.toContain("https://www.xhzy.com/XYZP/index.html");
  });
});
