import { describe, expect, it, vi } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { confirmedCompanyRosterV3 } from "../../src/data/confirmedCompanyRosterV3";
import { AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS } from "../../src/data/phase1ScopePolicy";
import {
  activeSourcePlanSha256,
  buildDiscoverySourcePlanCandidates,
  buildStagedSourceCrawlPlans,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import {
  __testOnlyDeriveStagedScheduleExpectation,
  deriveCurrentStagedScheduleExpectation,
  deriveStagedAdapterBundleSha256,
  deriveStagedSourceConfigSha256,
  resolveCurrentStagedScheduleAuthority,
  STAGED_SCHEDULE_ORACLE_VERSION,
  type StagedScheduleExpectation
} from "../../src/crawler/stagedScheduleAuthority";

vi.mock("../../src/readiness/buildIdentity", () => ({
  resolveCurrentBuildIdentity: () => ({
    schemaVersion: 2,
    commitSha: "1".repeat(40),
    sourceTreeSha256: "2".repeat(64),
    runtimeTreeSha256: "3".repeat(64),
    contentSha256: "4".repeat(64)
  })
}));

const BUILD = {
  schemaVersion: 2 as const,
  commitSha: "1".repeat(40),
  sourceTreeSha256: "2".repeat(64),
  runtimeTreeSha256: "3".repeat(64),
  contentSha256: "4".repeat(64)
};

function releaseCandidateRow(
  expectation: StagedScheduleExpectation,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: "rc-staged-1",
    status: "READY_FOR_QA",
    commitSha: expectation.commitSha,
    rosterHash: expectation.rosterSha256,
    sourcePlanHash: expectation.sourcePlanSha256,
    sourceConfigHash: expectation.sourceConfigSha256,
    adapterBundleHash: expectation.adapterBundleSha256,
    sourceTreeHash: expectation.sourceTreeSha256,
    runtimeTreeHash: expectation.runtimeTreeSha256,
    oracleVersion: STAGED_SCHEDULE_ORACLE_VERSION,
    ...overrides
  };
}

describe("current staged schedule expectation", () => {
  it("derives the exact 30+30 roster and canonical STAGED plans without planning exclusions", () => {
    const expectation = deriveCurrentStagedScheduleExpectation(BUILD);
    const exclusions = new Set<string>(AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS);

    expect(expectation.companies).toHaveLength(60);
    expect(expectation.companies.filter(({ category }) => category === "FOREIGN_PHARMA")).toHaveLength(30);
    expect(expectation.companies.filter(({ category }) => category === "DOMESTIC_PHARMA")).toHaveLength(30);
    expect(expectation.rosterSha256).toBe(confirmedCompanyRosterV3.membersSha256);
    expect(expectation.plans.map((plan) => plan.source.id)).toEqual(
      buildStagedSourceCrawlPlans(candidateCompanies).map((plan) => plan.source.id).sort()
    );
    expect(expectation.plans.every((plan) => plan.executionAuthority === "STAGED")).toBe(true);
    expect(expectation.plans.some((plan) => exclusions.has(plan.company.id))).toBe(false);
    expect(expectation.companies.filter(({ id }) => exclusions.has(id))).toHaveLength(2);
  });

  it("keeps canonical hash results stable when source input order changes", () => {
    const plans = buildStagedSourceCrawlPlans(candidateCompanies);
    const reversed = [...plans].reverse();

    expect(activeSourcePlanSha256(reversed)).toBe(activeSourcePlanSha256(plans));
    expect(deriveStagedSourceConfigSha256(reversed)).toBe(deriveStagedSourceConfigSha256(plans));
    expect(deriveStagedAdapterBundleSha256(BUILD.runtimeTreeSha256, reversed)).toBe(
      deriveStagedAdapterBundleSha256(BUILD.runtimeTreeSha256, plans)
    );
  });

  it("binds plan/config/runtime-tree/adapter changes to the appropriate digests without circular RC input", () => {
    const plans = buildStagedSourceCrawlPlans(candidateCompanies);
    const first = plans[0]!;
    const changedConfig = [{
      ...first,
      company: { ...first.company, officialChineseName: `${first.company.officialChineseName}-changed` }
    } as SourceCrawlPlan, ...plans.slice(1)];
    const changedAdapterSet = [{ ...first, adapterId: "new-adapter" as never }, ...plans.slice(1)] as SourceCrawlPlan[];

    expect(activeSourcePlanSha256(changedConfig)).not.toBe(activeSourcePlanSha256(plans));
    expect(deriveStagedSourceConfigSha256(changedConfig)).not.toBe(deriveStagedSourceConfigSha256(plans));
    expect(deriveStagedAdapterBundleSha256(BUILD.runtimeTreeSha256, plans)).toBe(
      "03c97721c377de8d5e92b388277fc4e37cb7a9b768b89ca7055fb996cbfd62d2"
    );
    expect(deriveStagedAdapterBundleSha256("5".repeat(64), plans)).not.toBe(
      deriveStagedAdapterBundleSha256(BUILD.runtimeTreeSha256, plans)
    );
    expect(deriveStagedAdapterBundleSha256(BUILD.runtimeTreeSha256, changedAdapterSet)).not.toBe(
      deriveStagedAdapterBundleSha256(BUILD.runtimeTreeSha256, plans)
    );
    expect(deriveStagedAdapterBundleSha256(BUILD.runtimeTreeSha256, changedConfig)).toBe(
      deriveStagedAdapterBundleSha256(BUILD.runtimeTreeSha256, plans)
    );
  });

  it.each([
    ["discovery", () => buildDiscoverySourcePlanCandidates(candidateCompanies)],
    ["subset", () => buildStagedSourceCrawlPlans(candidateCompanies).slice(1)],
    ["mutated ownership", () => {
      const plans = buildStagedSourceCrawlPlans(candidateCompanies);
      return [{ ...plans[0]!, company: { ...plans[0]!.company, id: plans[1]!.company.id } }, ...plans.slice(1)];
    }],
    ["non-STAGED", () => buildStagedSourceCrawlPlans(candidateCompanies).map((plan) => ({
      ...plan,
      executionAuthority: undefined
    }))]
  ])("rejects %s fixture during pure derivation", (_label, fixture) => {
    expect(() => __testOnlyDeriveStagedScheduleExpectation(BUILD, candidateCompanies, fixture() as SourceCrawlPlan[]))
      .toThrow();
  });

  it("rejects a roster object mutation even when ids and categories are unchanged", () => {
    const mutated = candidateCompanies.map((company, index) => index === 0
      ? { ...company, officialWebsiteUrl: "https://attacker.invalid" }
      : company);
    expect(() => __testOnlyDeriveStagedScheduleExpectation(
      BUILD,
      mutated,
      buildStagedSourceCrawlPlans(candidateCompanies)
    )).toThrow(/canonical|roster/i);
  });
});

describe("current staged schedule release-candidate lookup", () => {
  it("uses every derived field, reads at most two rows, and returns the fixed SCHEDULED identity", async () => {
    const expected = deriveCurrentStagedScheduleExpectation(BUILD);
    const findMany = vi.fn(async () => [releaseCandidateRow(expected)]);

    const authority = await resolveCurrentStagedScheduleAuthority({ releaseCandidate: { findMany } });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        commitSha: expected.commitSha,
        rosterHash: expected.rosterSha256,
        sourcePlanHash: expected.sourcePlanSha256,
        sourceConfigHash: expected.sourceConfigSha256,
        adapterBundleHash: expected.adapterBundleSha256,
        sourceTreeHash: expected.sourceTreeSha256,
        runtimeTreeHash: expected.runtimeTreeSha256,
        oracleVersion: STAGED_SCHEDULE_ORACLE_VERSION,
        status: { in: ["BUILDING", "READY_FOR_QA", "RELEASED"] }
      },
      select: {
        id: true,
        status: true,
        commitSha: true,
        rosterHash: true,
        sourcePlanHash: true,
        sourceConfigHash: true,
        adapterBundleHash: true,
        sourceTreeHash: true,
        runtimeTreeHash: true,
        oracleVersion: true
      },
      take: 2
    });
    expect(authority.identity).toEqual({
      releaseCandidateId: "rc-staged-1",
      commitSha: expected.commitSha,
      rosterSha256: expected.rosterSha256,
      sourcePlanSha256: expected.sourcePlanSha256,
      sourceConfigSha256: expected.sourceConfigSha256,
      adapterBundleSha256: expected.adapterBundleSha256,
      batchKind: "SCHEDULED",
      ownerId: "staged-scheduler",
      expectedPlannedSourceIds: expected.plannedSourceIds,
      expectedPlannedSourceSetSha256: expected.plannedSourceSetSha256,
      expectedPlannedSourceCount: expected.plannedSourceCount
    });
  });

  it.each([
    ["missing", () => []],
    ["duplicate", (row: ReturnType<typeof releaseCandidateRow>) => [row, { ...row, id: "rc-staged-2" }]],
    ["TRUST_FREEZE", (row: ReturnType<typeof releaseCandidateRow>) => [{ ...row, status: "TRUST_FREEZE" }]],
    ["QA_FAILED", (row: ReturnType<typeof releaseCandidateRow>) => [{ ...row, status: "QA_FAILED" }]],
    ["INVALIDATED", (row: ReturnType<typeof releaseCandidateRow>) => [{ ...row, status: "INVALIDATED" }]]
  ])("rejects %s release-candidate result", async (_label, rows) => {
    const expected = deriveCurrentStagedScheduleExpectation(BUILD);
    const row = releaseCandidateRow(expected);
    await expect(resolveCurrentStagedScheduleAuthority({
      releaseCandidate: { findMany: vi.fn(async () => rows(row) as never) }
    })).rejects.toThrow();
  });

  it.each([
    "commitSha",
    "rosterHash",
    "sourcePlanHash",
    "sourceConfigHash",
    "adapterBundleHash",
    "sourceTreeHash",
    "runtimeTreeHash",
    "oracleVersion"
  ])("recompares and rejects mismatched %s returned by the DB", async (field) => {
    const expected = deriveCurrentStagedScheduleExpectation(BUILD);
    const row = releaseCandidateRow(expected, { [field]: field === "commitSha" ? "9".repeat(40) : "9".repeat(64) });
    await expect(resolveCurrentStagedScheduleAuthority({
      releaseCandidate: { findMany: vi.fn(async () => [row] as never) }
    })).rejects.toThrow(/mismatch/i);
  });

  it("returns a deeply frozen copy instead of exposing mutable canonical authority", async () => {
    const expected = deriveCurrentStagedScheduleExpectation(BUILD);
    const authority = await resolveCurrentStagedScheduleAuthority({
      releaseCandidate: { findMany: vi.fn(async () => [releaseCandidateRow(expected)] as never) }
    });

    expect(authority.companies).not.toBe(candidateCompanies);
    expect(authority.plans).not.toBe(expected.plans);
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.companies)).toBe(true);
    expect(Object.isFrozen(authority.companies[0])).toBe(true);
    expect(Object.isFrozen(authority.companies[0]!.sources)).toBe(true);
    expect(Object.isFrozen(authority.plans[0])).toBe(true);
    expect(Object.isFrozen(authority.identity)).toBe(true);
    expect(Object.isFrozen(authority.identity.expectedPlannedSourceIds)).toBe(true);
  });
});
