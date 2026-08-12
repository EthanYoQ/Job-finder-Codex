import { describe, expect, it, vi } from "vitest";
import { confirmedCompanyRosterV3Members } from "../../src/data/confirmedCompanyRosterV3";
import {
  AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS,
  canonicalPhase1ScopeCounts
} from "../../src/data/phase1ScopePolicy";
import { getCompanyPublicationSnapshotFromDb } from "../../src/db/publicationEligibilityRepository";
import { listCompanyCoverage, type CoverageDb } from "../../src/server/coverageService";

const readTestSnapshot = (db: CoverageDb) => getCompanyPublicationSnapshotFromDb(
  db,
  async () => ({ identity: { releaseCandidateId: "phase1-current-release" } })
);

function emptyAttemptDb() {
  const findMany = vi.fn(async () => []);
  return {
    db: { crawlBatchSourceResult: { findMany } } as CoverageDb,
    findMany
  };
}

describe("company coverage service", () => {
  it("returns the canonical exact 60-company directory from one publication batch read even when attempts are empty", async () => {
    const { db, findMany } = emptyAttemptDb();
    const result = await listCompanyCoverage({
      keyword: "",
      offset: 0,
      limit: canonicalPhase1ScopeCounts.fixedRosterCompanyCount
    }, db, readTestSnapshot);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result.companies).toHaveLength(canonicalPhase1ScopeCounts.fixedRosterCompanyCount);
    expect(result.limit).toBe(canonicalPhase1ScopeCounts.fixedRosterCompanyCount);
    expect(result.hasMore).toBe(false);
    expect(result.companies.map(({ id }) => id).sort()).toEqual(
      confirmedCompanyRosterV3Members.map(({ id }) => id).sort()
    );
    expect(result.companies.filter(({ category }) => category === "FOREIGN_PHARMA")).toHaveLength(30);
    expect(result.companies.filter(({ category }) => category === "DOMESTIC_PHARMA")).toHaveLength(30);
    expect(result.companies.every((company) =>
      Object.hasOwn(company, "officialWebsiteUrl") &&
      Object.hasOwn(company, "officialCareersUrl") &&
      Object.hasOwn(company, "state") &&
      Object.hasOwn(company, "health") &&
      Object.hasOwn(company, "lastSuccessAt")
    )).toBe(true);

    const exclusions = result.companies
      .filter(({ state }) => state === "USER_AUTHORIZED_PHASE1_EXCLUSION")
      .map(({ id }) => id)
      .sort();
    expect(exclusions).toEqual([...AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS].sort());
    for (const exclusion of result.companies.filter(({ id }) => exclusions.includes(id))) {
      expect(exclusion).toMatchObject({
        category: "DOMESTIC_PHARMA",
        officialCareersUrl: null,
        health: "NOT_APPLICABLE",
        lastSuccessAt: null
      });
    }

    expect(result.companies.find(({ id }) => id === "company-apeloa")).toMatchObject({
      companyName: "普洛药业股份有限公司",
      officialWebsiteUrl: "https://www.apeloa.com/",
      officialCareersUrl: "https://www.apeloa.com/join.html"
    });
  });

  it("keeps keyword and pagination deterministic over the canonical publication snapshot", async () => {
    const { db, findMany } = emptyAttemptDb();
    const result = await listCompanyCoverage({
      keyword: "renfu",
      offset: 0,
      limit: canonicalPhase1ScopeCounts.fixedRosterCompanyCount
    }, db, readTestSnapshot);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      companies: [expect.objectContaining({
        id: "company-humanwell",
        companyName: "人福医药集团股份公司",
        state: "USER_AUTHORIZED_PHASE1_EXCLUSION"
      })],
      offset: 0,
      limit: canonicalPhase1ScopeCounts.fixedRosterCompanyCount,
      hasMore: false
    });
  });
});
