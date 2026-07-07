import { describe, expect, it } from "vitest";
import {
  candidateCompanies,
  getCandidatePoolStats,
  getSocialSources
} from "../../src/data/companyRegistry";

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
});
