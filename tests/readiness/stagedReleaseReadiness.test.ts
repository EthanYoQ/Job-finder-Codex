import { describe, expect, it } from "vitest";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { isUserAuthorizedPhase1Exclusion } from "../../src/data/phase1ScopePolicy";
import type {
  CompanyPublicationRecord,
  CompanyPublicationSnapshot,
  PublicationHealth,
  PublicationState
} from "../../src/domain/publicationEligibility";
import {
  PHASE1_MINIMUM_STABLE_COMPANIES,
  evaluateStagedReleaseReadiness
} from "../../src/readiness/stagedReleaseReadiness";

const NOW = new Date("2026-07-15T12:00:00.000Z");
const FRESHNESS_MAXIMUM_MS = 30 * 60 * 60 * 1_000;
const compareUtf8 = (left: string, right: string) => Buffer.from(left).compare(Buffer.from(right));
const plansByCompanyId = new Map<string, string[]>();

for (const plan of buildStagedSourceCrawlPlans(candidateCompanies)) {
  plansByCompanyId.set(plan.company.id, [
    ...(plansByCompanyId.get(plan.company.id) ?? []),
    plan.source.id
  ].sort(compareUtf8));
}

const plannedCompanyIds = [...plansByCompanyId.keys()].sort(compareUtf8);

function countsBy<T extends string>(values: readonly T[], keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, values.filter((value) => value === key).length])) as Record<T, number>;
}

function snapshotWithStableCompanies(stableCount: number): CompanyPublicationSnapshot {
  const stableIds = new Set(plannedCompanyIds.slice(0, stableCount));
  const companies: CompanyPublicationRecord[] = candidateCompanies.map((company) => {
    const stagedSourceIds = plansByCompanyId.get(company.id) ?? [];
    const stable = stableIds.has(company.id);
    const excluded = isUserAuthorizedPhase1Exclusion(company.id);
    return {
      companyId: company.id,
      companyName: company.officialChineseName,
      pinyinName: company.pinyinName,
      category: company.category,
      officialWebsiteUrl: company.officialWebsiteUrl ?? null,
      officialCareersUrl: company.sources.find(({ kind }) => kind === "SOCIAL")?.officialEntryUrl ?? null,
      state: excluded ? "USER_AUTHORIZED_PHASE1_EXCLUSION" : stable ? "PUBLISHING" : "VERIFYING",
      health: stable ? "HEALTHY" : "NOT_APPLICABLE",
      stagedSourceIds,
      eligibleSourceIds: stable ? [...stagedSourceIds] : [],
      qualifiedAt: stable ? new Date(NOW.getTime() - 2 * 60 * 60 * 1_000) : null,
      lastAttemptAt: stable ? new Date(NOW.getTime() - 60 * 60 * 1_000) : null,
      lastSuccessAt: stable ? new Date(NOW.getTime() - 60 * 60 * 1_000) : null,
      reasonCode: excluded
        ? "USER_AUTHORIZED_PHASE1_EXCLUSION"
        : stable
          ? "ALL_CURRENT_STAGED_SOURCES_QUALIFIED"
          : "CURRENT_CONFIG_HAS_NO_ATTEMPT"
    };
  });
  const states = companies.map(({ state }) => state);
  const health = companies.map(({ health: value }) => value);
  return {
    companies,
    eligibleCompanyIds: companies.filter(({ state }) => state === "PUBLISHING").map(({ companyId }) => companyId).sort(compareUtf8),
    eligibleSourceIds: [...new Set(companies.flatMap(({ eligibleSourceIds }) => eligibleSourceIds))].sort(compareUtf8),
    countsByState: countsBy(states, [
      "PUBLISHING",
      "VERIFYING",
      "OFFICIAL_LINK_ONLY",
      "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME",
      "USER_AUTHORIZED_PHASE1_EXCLUSION"
    ] satisfies PublicationState[]),
    countsByHealth: countsBy(health, ["HEALTHY", "DEGRADED", "NOT_APPLICABLE"] satisfies PublicationHealth[])
  };
}

function evaluate(snapshot: CompanyPublicationSnapshot) {
  return evaluateStagedReleaseReadiness({
    snapshot,
    mode: "PHASE1",
    currentTime: NOW,
    releaseCandidateStatus: "READY_FOR_QA",
    freshnessMaximumMs: FRESHNESS_MAXIMUM_MS
  });
}

describe("staged release readiness", () => {
  it("derives the user-authorized 45-company Phase 1 threshold from current records", () => {
    expect(PHASE1_MINIMUM_STABLE_COMPANIES).toBe(45);
    expect(evaluate(snapshotWithStableCompanies(44))).toMatchObject({
      canRelease: false,
      stableCompanyCount: 44,
      minimumStableCompanyCount: 45
    });
    expect(evaluate(snapshotWithStableCompanies(44)).issues.map(({ code }) => code))
      .toContain("MINIMUM_STABLE_COMPANIES_NOT_MET");
    expect(evaluate(snapshotWithStableCompanies(45))).toMatchObject({
      canRelease: true,
      stableCompanyCount: 45,
      minimumStableCompanyCount: 45
    });
  });

  it("does not treat a build-in-progress crawl authority as release authority", () => {
    const report = evaluateStagedReleaseReadiness({
      snapshot: snapshotWithStableCompanies(45),
      mode: "PHASE1",
      currentTime: NOW,
      releaseCandidateStatus: "BUILDING"
    });
    expect(report.canRelease).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "RELEASE_CANDIDATE_NOT_RELEASE_ELIGIBLE"
    }));
  });

  it("excludes a stale publishing company from the dynamic stable count", () => {
    const snapshot = snapshotWithStableCompanies(45);
    const stale = snapshot.companies.find(({ state }) => state === "PUBLISHING")!;
    stale.lastSuccessAt = new Date(NOW.getTime() - FRESHNESS_MAXIMUM_MS);
    const report = evaluate(snapshot);
    expect(report.stableCompanyCount).toBe(44);
    expect(report.canRelease).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "STALE_LAST_SUCCESS",
      companyId: stale.companyId
    }));

    const stillFresh = snapshotWithStableCompanies(45);
    stillFresh.companies.find(({ state }) => state === "PUBLISHING")!.lastSuccessAt =
      new Date(NOW.getTime() - FRESHNESS_MAXIMUM_MS + 1);
    expect(evaluate(stillFresh).stableCompanyCount).toBe(45);
  });

  it("does not count a recently failed company and rejects stale snapshot eligibility ids", () => {
    const snapshot = snapshotWithStableCompanies(45);
    const failed = snapshot.companies.find(({ state }) => state === "PUBLISHING")!;
    failed.state = "VERIFYING";
    failed.health = "DEGRADED";
    failed.eligibleSourceIds = [];
    failed.reasonCode = "QUALIFIED_BUT_LATEST_WINDOW_UNHEALTHY";
    const report = evaluate(snapshot);
    expect(report.stableCompanyCount).toBe(44);
    expect(report.canRelease).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "SNAPSHOT_ELIGIBLE_COMPANY_DRIFT",
      companyId: failed.companyId
    }));
  });

  it("fails closed for roster, category, or authorized-exclusion drift", () => {
    const missing = snapshotWithStableCompanies(45);
    missing.companies = missing.companies.slice(1);
    expect(evaluate(missing).issues.map(({ code }) => code)).toContain("CANONICAL_ROSTER_MISMATCH");

    const category = snapshotWithStableCompanies(45);
    category.companies[0]!.category = category.companies[0]!.category === "FOREIGN_PHARMA"
      ? "DOMESTIC_PHARMA"
      : "FOREIGN_PHARMA";
    expect(evaluate(category).issues.map(({ code }) => code)).toContain("CANONICAL_ROSTER_MISMATCH");

    const exclusion = snapshotWithStableCompanies(45);
    exclusion.companies.find(({ companyId }) => companyId === "company-humanwell")!.state = "VERIFYING";
    expect(evaluate(exclusion).issues).toContainEqual(expect.objectContaining({
      code: "AUTHORIZED_EXCLUSION_MISMATCH",
      companyId: "company-humanwell"
    }));
  });

  it("rejects duplicate company records and forged eligible counts", () => {
    const duplicate = snapshotWithStableCompanies(45);
    duplicate.companies.push({ ...duplicate.companies[0]! });
    expect(evaluate(duplicate).issues.map(({ code }) => code)).toContain("DUPLICATE_COMPANY");

    const forged = snapshotWithStableCompanies(44);
    const extra = forged.companies.find(({ state, companyId }) =>
      state === "VERIFYING" && !isUserAuthorizedPhase1Exclusion(companyId)
    )!;
    forged.eligibleCompanyIds.push(extra.companyId);
    expect(evaluate(forged).issues.map(({ code }) => code)).toContain("SNAPSHOT_ELIGIBLE_COMPANY_DRIFT");
    expect(evaluate(forged).stableCompanyCount).toBe(44);
  });
});
