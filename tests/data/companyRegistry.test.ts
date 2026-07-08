import { describe, expect, it } from "vitest";
import {
  candidateCompanies,
  getCandidatePoolStats,
  getSocialSources
} from "../../src/data/companyRegistry";

const THIRD_PARTY_ATS_HOSTS = new Set(["app.mokahr.com", "fosunpharma.zhiye.com"]);

function collectCandidateUrls(candidate: (typeof candidateCompanies)[number]): string[] {
  const companyUrls = [candidate.officialWebsiteUrl];
  const sourceUrls = candidate.sources.flatMap((source) => [
    source.officialEntryUrl,
    source.officialChainEvidenceUrl,
    source.campusEntryUrl
  ]);

  return [...companyUrls, ...sourceUrls].filter((url): url is string => Boolean(url));
}

describe("P0 company registry", () => {
  it("keeps the P0 candidate pool inside the required 80-120 range", () => {
    const stats = getCandidatePoolStats(candidateCompanies);

    expect(stats.totalCandidates).toBeGreaterThanOrEqual(80);
    expect(stats.totalCandidates).toBeLessThanOrEqual(120);
  });

  it("does not mark the registry as P0-launchable before 50 companies are verified scrapable", () => {
    const stats = getCandidatePoolStats(candidateCompanies);

    expect(stats.verifiedScrapableCompanies).toBeLessThan(50);
    expect(stats.canLaunchP0).toBe(false);
  });

  it("separates social sources from campus sources", () => {
    const socialSources = getSocialSources(candidateCompanies);

    expect(socialSources.length).toBeGreaterThan(0);
    expect(socialSources.every((source) => source.kind === "SOCIAL")).toBe(true);
  });

  it("does not use placeholder .invalid URLs for candidate provenance", () => {
    const urls = candidateCompanies.flatMap(collectCandidateUrls);

    expect(urls.some((url) => url.includes(".invalid"))).toBe(false);
  });

  it("requires first-party official-chain provenance for verified scrapable social sources", () => {
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

      const officialWebsiteHost = new URL(company!.officialWebsiteUrl!).host;
      const chainEvidenceHost = new URL(source.officialChainEvidenceUrl!).host;

      expect(THIRD_PARTY_ATS_HOSTS.has(officialWebsiteHost)).toBe(false);
      expect(THIRD_PARTY_ATS_HOSTS.has(chainEvidenceHost)).toBe(false);
    }
  });

  it("omits official-source URLs for unverified candidates without known provenance", () => {
    const candidate = candidateCompanies.find(
      (company) => company.id === "company-sino-biopharmaceutical"
    );
    const socialSource = candidate?.sources.find((source) => source.kind === "SOCIAL");

    expect(candidate?.officialWebsiteUrl).toBeUndefined();
    expect(socialSource?.officialEntryUrl).toBeUndefined();
    expect(socialSource?.officialChainEvidenceUrl).toBeUndefined();
  });

  it("records official-chain evidence for wave 1 added sources", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-hengrui")?.sources[0]).toMatchObject({
      status: "VERIFIED_SCRAPABLE",
      atsKind: "MOKA",
      officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
      officialChainEvidenceUrl: "https://www.hengrui.com/development/recruit.html"
    });

    expect(byId.get("company-kelun")?.sources[0]).toMatchObject({
      status: "VERIFIED_SCRAPABLE",
      atsKind: "BEISEN_ZHIYE",
      officialEntryUrl: "https://kelun.zhiye.com/social",
      officialChainEvidenceUrl: "https://www.kelun.com/intro/3.html"
    });
  });
});
