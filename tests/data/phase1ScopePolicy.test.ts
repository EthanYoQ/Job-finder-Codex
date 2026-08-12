import { describe, expect, it } from "vitest";
import { confirmedCompanyRosterV3Members } from "../../src/data/confirmedCompanyRosterV3";
import {
  AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS,
  USER_AUTHORIZED_PHASE1_EXCLUSION,
  derivePhase1Scope
} from "../../src/data/phase1ScopePolicy";
import * as phase1Policy from "../../src/data/phase1ScopePolicy";

const authorizedIds = new Set<string>(AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS);

function validRoster() {
  return confirmedCompanyRosterV3Members.map((member) => ({
    ...member,
    targetStatus: authorizedIds.has(member.id)
      ? USER_AUTHORIZED_PHASE1_EXCLUSION
      : "ACTIVE"
  }));
}

describe("Phase 1 authorized-exclusion policy", () => {
  it("exposes the canonical fixed roster and exact dynamically in-scope members", () => {
    const api = phase1Policy as unknown as {
      canonicalPhase1RosterPolicyRecords?: readonly { id: string; category: string; targetStatus: string }[];
      canonicalPhase1InScopeRosterMembers?: readonly { id: string; category: string }[];
      assertExactCanonicalPhase1InScopeRoster?: (actual: readonly { id: string; category: string }[]) => void;
    };

    expect(api.canonicalPhase1RosterPolicyRecords).toHaveLength(60);
    expect(api.canonicalPhase1InScopeRosterMembers).toHaveLength(58);
    expect(api.assertExactCanonicalPhase1InScopeRoster).toEqual(expect.any(Function));
    expect(() => api.assertExactCanonicalPhase1InScopeRoster!(
      api.canonicalPhase1InScopeRosterMembers!
    )).not.toThrow();
    expect(() => api.assertExactCanonicalPhase1InScopeRoster!([
      ...api.canonicalPhase1InScopeRosterMembers!.slice(1),
      { id: "company-replacement", category: "FOREIGN_PHARMA" }
    ])).toThrow(/canonical|in-scope|roster/i);
  });

  it("derives the effective denominator and exclusion count from validated canonical IDs and statuses", () => {
    const scope = derivePhase1Scope(validRoster());

    expect(AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS).toEqual([
      "company-humanwell",
      "company-north-china-pharma"
    ]);
    expect(scope.rosterCount).toBe(60);
    expect(scope.authorizedExclusionCount).toBe(AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS.length);
    expect(scope.inScopeCompanies).toHaveLength(
      scope.rosterCount - scope.authorizedExclusionCount
    );
    expect(scope.inScopeCompanies.map(({ id }) => id)).not.toContain("company-humanwell");
    expect(scope.inScopeCompanies.map(({ id }) => id)).not.toContain("company-north-china-pharma");
  });

  it("fails closed when an unauthorized third company carries the status", () => {
    const roster = validRoster();
    roster.find(({ id }) => id === "company-3sbio")!.targetStatus = USER_AUTHORIZED_PHASE1_EXCLUSION;

    expect(() => derivePhase1Scope(roster)).toThrow(/unauthorized|company-3sbio/i);
  });

  it.each([
    ["missing", (roster: ReturnType<typeof validRoster>) => roster.filter(({ id }) => id !== "company-humanwell")],
    ["not marked", (roster: ReturnType<typeof validRoster>) => roster.map((company) => company.id === "company-humanwell" ? { ...company, targetStatus: "ACTIVE" } : company)],
    ["category drift", (roster: ReturnType<typeof validRoster>) => roster.map((company) => company.id === "company-humanwell" ? { ...company, category: "FOREIGN_PHARMA" as const } : company)]
  ])("fails closed when an authorized ID is %s", (_label, mutate) => {
    expect(() => derivePhase1Scope(mutate(validRoster()))).toThrow(/humanwell|authorized|category/i);
  });
});
