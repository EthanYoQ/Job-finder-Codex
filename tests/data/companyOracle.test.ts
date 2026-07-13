import { describe, expect, it } from "vitest";
import {
  candidateCompanies,
  CONFIRMED_ROSTER_V3_PROVENANCE,
  CONFIRMED_V3_TO_RUNTIME_COMPANY_ID,
  companyRosterSha256,
  expectedOfficialSurfaces,
  officialSurfaceOracleSha256,
  excludedCompanies,
  validateStrictCompanyRegistry
} from "../../src/data/companyRegistry";
import {
  activeSourcePlanSha256,
  buildDiscoverySourcePlanCandidates,
  buildSourceCrawlPlans,
  buildStagedSourceCrawlPlans,
  getSourcePlanCoverage,
  validateExecutablePlanChannelBinding
} from "../../src/crawler/sourcePlan";
import { derivePhase1Scope } from "../../src/data/phase1ScopePolicy";

describe("strict 30+30 roster and expected official-surface oracle", () => {
  it("rejects free-form China scope and independently-verified scope without evidence bindings", () => {
    const jnj = candidateCompanies.find((company) => company.id === "company-johnson-innovative-medicine")!;
    const base = expectedOfficialSurfaces.find((surface) => surface.companyId === jnj.id && surface.kind === "SOCIAL")!;
    const falselyResolved = {
      ...base,
      oracleStatus: "INDEPENDENTLY_VERIFIED" as const,
      legalEntityScope: [{ status: "RESOLVED" as const, value: "Johnson & Johnson (China) Investment Ltd." }],
      businessUnitScope: [{ status: "RESOLVED" as const, value: "Innovative Medicine" }],
      brandScope: [{ status: "RESOLVED" as const, value: "Johnson & Johnson" }],
      channels: [{ channelId: `source:${jnj.sources[0]!.id}:default`, kind: "SOCIAL" as const, status: "EXPECTED" as const }],
      chinaScope: "China"
    };

    expect(validateStrictCompanyRegistry(candidateCompanies, [falselyResolved as never], excludedCompanies)).toEqual(
      expect.arrayContaining(["VERIFIED_SURFACE_HAS_UNRESOLVED_SCOPE"])
    );
  });

  it.each([
    ["empty required scope array", { legalEntityScope: [] }],
    ["malformed scope status", { businessUnitScope: [{ status: "APPROVED", value: "Innovative Medicine", evidenceArtifactSha256: "1".repeat(64) }] }],
    ["blank resolved scope", { brandScope: [{ status: "RESOLVED", value: "   ", evidenceArtifactSha256: "2".repeat(64) }] }],
    ["resolved scope without evidence binding", { legalEntityScope: [{ status: "RESOLVED", value: "J&J China" }] }],
    ["well-formed unresolved company scope", { legalEntityScope: [{ status: "UNRESOLVED", reason: "legal entity pending" }] }],
    ["well-formed unresolved business-unit scope", { businessUnitScope: [{ status: "UNRESOLVED", reason: "business unit pending" }] }],
    ["well-formed unresolved brand scope", { brandScope: [{ status: "UNRESOLVED", reason: "brand pending" }] }],
    ["well-formed unresolved channel", { channels: [{ channelId: "pending", kind: "UNKNOWN", status: "UNRESOLVED" }] }]
  ])("fails closed for %s", (_label, mutation) => {
    const base = expectedOfficialSurfaces.find((surface) => surface.companyId === "company-johnson-innovative-medicine" && surface.kind === "SOCIAL")!;
    const evidenceArtifactSha256 = "a".repeat(64);
    const resolved = {
      ...base,
      oracleStatus: "INDEPENDENTLY_VERIFIED",
      legalEntityScope: [{ status: "RESOLVED", value: "J&J China", evidenceArtifactSha256 }],
      businessUnitScope: [{ status: "RESOLVED", value: "Innovative Medicine", evidenceArtifactSha256 }],
      brandScope: [{ status: "RESOLVED", value: "Johnson & Johnson", evidenceArtifactSha256 }],
      channels: [{ channelId: "official-channel", kind: "SOCIAL", status: "EXPECTED" }],
      chinaScope: { status: "RESOLVED", geography: "MAINLAND_CHINA", evidenceArtifactSha256 },
      ...mutation
    };
    expect(validateStrictCompanyRegistry(candidateCompanies, [resolved as never], excludedCompanies)).toContain(
      "VERIFIED_SURFACE_HAS_UNRESOLVED_SCOPE"
    );
  });

  it("matches the exact user-confirmed V3 ids through an explicit auditable mapping", () => {
    const runtimeIds = [...Object.values(CONFIRMED_V3_TO_RUNTIME_COMPANY_ID)].sort();
    expect(Object.keys(CONFIRMED_V3_TO_RUNTIME_COMPANY_ID)).toHaveLength(60);
    expect(runtimeIds).toEqual(candidateCompanies.map((company) => company.id).sort());
    expect(CONFIRMED_ROSTER_V3_PROVENANCE).toMatchObject({
      artifact: "docs/research/company-list-60-official-entry-status.md",
      userConfirmation: "名单已确认"
    });
    expect(runtimeIds).toEqual(expect.arrayContaining([
      "company-sinopharm", "company-grand-pharma", "company-shanghai-pharma", "company-gphl",
      "company-humanwell", "company-changchun-high-tech", "company-livzon", "company-buchang",
      "company-huahai", "company-north-china-pharma", "company-apeloa", "company-xinhua-pharma"
    ]));
    expect(runtimeIds).not.toEqual(expect.arrayContaining([
      "company-beigene", "company-jichuan", "company-simcere", "company-yiling",
      "company-kanghong", "company-innocare", "company-henlius", "company-haisco",
      "company-ascentage", "company-better-pharma", "company-mabwell", "company-cms"
    ]));
  });
  it("contains exactly 30 foreign and 30 domestic targets without replacement semantics", () => {
    expect(candidateCompanies.filter((company) => company.category === "FOREIGN_PHARMA")).toHaveLength(30);
    expect(candidateCompanies.filter((company) => company.category === "DOMESTIC_PHARMA")).toHaveLength(30);
    expect(JSON.stringify(candidateCompanies)).not.toMatch(/递补|replacement|backfill/i);
    expect(validateStrictCompanyRegistry(candidateCompanies, expectedOfficialSurfaces, excludedCompanies)).toEqual([]);
  });

  it("activates the canonical Sandoz source and only the verified Otsuka group source without substitutions", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));
    expect(byId.get("company-sandoz-china")).toMatchObject({
      targetStatus: "ACTIVE",
      sources: [{ id: "source-sandoz-china-social", status: "VERIFIED_SCRAPABLE" }]
    });
    expect(byId.get("company-otsuka-china")).toMatchObject({
      targetStatus: "ACTIVE",
      sources: [
        { id: "source-otsuka-china-social", status: "ENTRY_FOUND_PENDING_ADAPTER" },
        { id: "source-otsuka-china-social-2", status: "VERIFIED_SCRAPABLE" }
      ]
    });
    expect(expectedOfficialSurfaces.filter((surface) => surface.companyId === "company-otsuka-china" && surface.kind === "SOCIAL"))
      .toHaveLength(2);
    expect(byId.has("company-beta-pharma")).toBe(false);
    expect(byId.has("company-jacobio")).toBe(false);
    expect(excludedCompanies.map((company) => company.companyId)).toEqual(
      expect.arrayContaining(["company-beta-pharma", "company-jacobio"])
    );
  });

  it("uses one official Chinese display name and globally unique company and surface ids", () => {
    expect(candidateCompanies.every((company) => company.officialChineseName.trim().length > 0)).toBe(true);
    expect(candidateCompanies.every((company) => !company.officialChineseName.includes("/"))).toBe(true);
    expect(new Set(candidateCompanies.map((company) => company.officialChineseName)).size).toBe(60);
    expect(new Set(candidateCompanies.map((company) => company.id)).size).toBe(60);
    expect(new Set(expectedOfficialSurfaces.map((surface) => surface.surfaceId)).size).toBe(expectedOfficialSurfaces.length);
  });

  it("uses explicit nonempty scope records and prevents unresolved scope from becoming independently verified", () => {
    for (const surface of expectedOfficialSurfaces) {
      expect(surface.legalEntityScope.length).toBeGreaterThan(0);
      expect(surface.businessUnitScope.length).toBeGreaterThan(0);
      expect(surface.brandScope.length).toBeGreaterThan(0);
      if ([surface.legalEntityScope, surface.businessUnitScope, surface.brandScope].flat().some((scope) => scope.status === "UNRESOLVED")) {
        expect(surface.oracleStatus).not.toBe("INDEPENDENTLY_VERIFIED");
      }
    }
  });

  it("models social and campus surfaces independently and preserves multiple social surfaces", () => {
    const synthetic = [
      ...expectedOfficialSurfaces,
      {
        ...expectedOfficialSurfaces[0]!,
        surfaceId: "surface-synthetic-second-social"
      },
      {
        ...expectedOfficialSurfaces[0]!,
        surfaceId: "surface-synthetic-campus",
        kind: "CAMPUS" as const
      }
    ];
    expect(synthetic.filter((surface) => surface.kind === "SOCIAL")).toHaveLength(
      expectedOfficialSurfaces.filter((surface) => surface.kind === "SOCIAL").length + 1
    );
    expect(synthetic.find((surface) => surface.surfaceId === "surface-synthetic-campus")?.kind).toBe("CAMPUS");
  });

  it("keeps research-pending surfaces as discovery candidates but emits zero active plans", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);
    const discoveryCandidates = buildDiscoverySourcePlanCandidates(candidateCompanies);
    const stagedPlans = buildStagedSourceCrawlPlans(candidateCompanies);
    const coverage = getSourcePlanCoverage(candidateCompanies, plans);
    expect(plans).toEqual([]);
    expect(stagedPlans.map((plan) => plan.source.id)).toEqual(
      discoveryCandidates.map((plan) => plan.source.id)
    );
    for (const plan of stagedPlans) expect(() => validateExecutablePlanChannelBinding(plan)).not.toThrow();
    for (const plan of discoveryCandidates) expect(() => validateExecutablePlanChannelBinding(plan)).toThrow();
    expect(coverage.unexpectedPlanSourceIds).toEqual([]);
    const inScopeCompanyIds = new Set(
      derivePhase1Scope(candidateCompanies).inScopeCompanies.map(({ id }) => id)
    );
    expect(coverage.blockedExpectedSurfaceIds).toEqual(
      expectedOfficialSurfaces
        .filter((surface) => surface.kind === "SOCIAL" && inScopeCompanyIds.has(surface.companyId))
        .map(({ surfaceId }) => surfaceId)
        .sort()
    );
  });

  it("keeps resolved multi-social surfaces inactive when the adapter cannot prove channel coverage", () => {
    const company = candidateCompanies[0]!;
    const base = expectedOfficialSurfaces.find((surface) => surface.companyId === company.id && surface.kind === "SOCIAL")!;
    const evidenceArtifactSha256 = "a".repeat(64);
    const resolved = {
      ...base,
      oracleStatus: "INDEPENDENTLY_VERIFIED" as const,
      legalEntityScope: [{ status: "RESOLVED" as const, value: "Legal entity", evidenceArtifactSha256 }],
      businessUnitScope: [{ status: "RESOLVED" as const, value: "Pharma", evidenceArtifactSha256 }],
      brandScope: [{ status: "RESOLVED" as const, value: "Brand", evidenceArtifactSha256 }],
      chinaScope: { status: "RESOLVED" as const, geography: "MAINLAND_CHINA" as const, evidenceArtifactSha256 },
      channels: [{ channelId: "social", kind: "SOCIAL" as const, status: "EXPECTED" as const }]
    };
    const second = { ...resolved, surfaceId: `${resolved.surfaceId}-second` };
    const companyWithTwo = { ...company, sources: [...company.sources, { ...company.sources[0]!, surfaceId: second.surfaceId }] };
    const plans = buildSourceCrawlPlans([companyWithTwo], [resolved, second]);
    expect([resolved, second].map((surface) => surface.surfaceId)).toHaveLength(2);
    expect(plans).toEqual([]);
  });

  it("produces order-independent hashes that change when roster, oracle or plan identity changes", () => {
    const reversedCompanies = [...candidateCompanies].reverse();
    const reversedSurfaces = [...expectedOfficialSurfaces].reverse();
    expect(companyRosterSha256(reversedCompanies)).toBe(companyRosterSha256(candidateCompanies));
    expect(officialSurfaceOracleSha256(reversedSurfaces)).toBe(officialSurfaceOracleSha256(expectedOfficialSurfaces));
    expect(activeSourcePlanSha256(buildDiscoverySourcePlanCandidates(reversedCompanies))).toBe(
      activeSourcePlanSha256(buildDiscoverySourcePlanCandidates(candidateCompanies))
    );
    expect(companyRosterSha256([{ ...candidateCompanies[0]!, id: "changed" }, ...candidateCompanies.slice(1)])).not.toBe(
      companyRosterSha256(candidateCompanies)
    );
    expect(officialSurfaceOracleSha256([{ ...expectedOfficialSurfaces[0]!, surfaceId: "changed" }, ...expectedOfficialSurfaces.slice(1)])).not.toBe(
      officialSurfaceOracleSha256(expectedOfficialSurfaces)
    );
    const discovery = buildDiscoverySourcePlanCandidates(candidateCompanies);
    expect(activeSourcePlanSha256([{ ...discovery[0]!, source: { ...discovery[0]!.source, id: "changed" } }, ...discovery.slice(1)])).not.toBe(
      activeSourcePlanSha256(discovery)
    );
  });
});
