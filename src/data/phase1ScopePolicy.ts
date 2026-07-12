import { confirmedCompanyRosterV3Members } from "./confirmedCompanyRosterV3";

export const USER_AUTHORIZED_PHASE1_EXCLUSION = "USER_AUTHORIZED_PHASE1_EXCLUSION" as const;

export const AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS = Object.freeze([
  "company-humanwell",
  "company-north-china-pharma"
] as const);

const authorizedIds: ReadonlySet<string> = new Set(AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS);
const expectedCategories: Readonly<Record<(typeof AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS)[number], "DOMESTIC_PHARMA">> = {
  "company-humanwell": "DOMESTIC_PHARMA",
  "company-north-china-pharma": "DOMESTIC_PHARMA"
};

export interface Phase1ScopeRosterRecord {
  id: string;
  category: "FOREIGN_PHARMA" | "DOMESTIC_PHARMA";
  targetStatus: string;
  sources?: readonly unknown[];
}

export interface Phase1Scope<T extends Phase1ScopeRosterRecord> {
  rosterCount: number;
  authorizedExclusionCount: number;
  inScopeCompanies: T[];
  authorizedExclusionCompanies: T[];
}

export function isUserAuthorizedPhase1Exclusion(companyId: string): boolean {
  return authorizedIds.has(companyId);
}

export function derivePhase1Scope<T extends Phase1ScopeRosterRecord>(roster: readonly T[]): Phase1Scope<T> {
  const byId = new Map<string, T>();
  for (const company of roster) {
    if (byId.has(company.id)) throw new Error(`Duplicate Phase 1 roster company: ${company.id}`);
    byId.set(company.id, company);
    if (company.targetStatus === USER_AUTHORIZED_PHASE1_EXCLUSION && !isUserAuthorizedPhase1Exclusion(company.id)) {
      throw new Error(`Unauthorized Phase 1 exclusion status: ${company.id}`);
    }
  }

  for (const id of AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS) {
    const company = byId.get(id);
    if (!company) throw new Error(`Authorized Phase 1 exclusion is missing from the roster: ${id}`);
    if (company.category !== expectedCategories[id]) {
      throw new Error(`Authorized Phase 1 exclusion category drift: ${id}`);
    }
    if (company.targetStatus !== USER_AUTHORIZED_PHASE1_EXCLUSION) {
      throw new Error(`Authorized Phase 1 exclusion is not marked: ${id}`);
    }
    if ((company.sources?.length ?? 0) !== 0) {
      throw new Error(`Authorized Phase 1 exclusion must have zero sources: ${id}`);
    }
  }

  const authorizedExclusionCompanies = roster.filter(({ id }) => isUserAuthorizedPhase1Exclusion(id));
  const inScopeCompanies = roster.filter(({ id }) => !isUserAuthorizedPhase1Exclusion(id));
  return {
    rosterCount: roster.length,
    authorizedExclusionCount: authorizedExclusionCompanies.length,
    inScopeCompanies: [...inScopeCompanies],
    authorizedExclusionCompanies: [...authorizedExclusionCompanies]
  };
}

export function assertValidPhase1ScopePolicy(roster: readonly Phase1ScopeRosterRecord[]): void {
  derivePhase1Scope(roster);
}

export const canonicalPhase1RosterPolicyRecords = Object.freeze(
  confirmedCompanyRosterV3Members.map((member) => Object.freeze({
    ...member,
    targetStatus: isUserAuthorizedPhase1Exclusion(member.id)
      ? USER_AUTHORIZED_PHASE1_EXCLUSION
      : "ACTIVE" as const
  }))
);

const canonicalPhase1Scope = derivePhase1Scope(canonicalPhase1RosterPolicyRecords);

export const canonicalPhase1InScopeRosterMembers = Object.freeze(
  canonicalPhase1Scope.inScopeCompanies.map(({ id, category }) => Object.freeze({ id, category }))
);

export function assertExactCanonicalPhase1InScopeRoster(
  actual: readonly { id: string; category: string }[]
): void {
  const canonical = (values: readonly { id: string; category: string }[]) => [...values]
    .map(({ id, category }) => ({ id, category }))
    .sort((left, right) => left.id.localeCompare(right.id) || left.category.localeCompare(right.category));
  const normalized = canonical(actual);
  if (new Set(normalized.map(({ id }) => id)).size !== normalized.length ||
      JSON.stringify(normalized) !== JSON.stringify(canonicalPhase1InScopeRosterMembers)) {
    throw new Error("CANONICAL_PHASE1_IN_SCOPE_ROSTER_MISMATCH");
  }
}
