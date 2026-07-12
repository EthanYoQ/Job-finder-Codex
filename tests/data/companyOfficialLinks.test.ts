import { describe, expect, it } from "vitest";
import * as registry from "../../src/data/companyRegistry";
import type {
  CandidateCompany,
  ExpectedOfficialRecruitmentSurface
} from "../../src/data/companyRegistry";

const NO_LINK_STATUS = "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME";

interface SyntheticSocialSourceSeed {
  status: "VERIFIED_SCRAPABLE";
  atsKind: "OFFICIAL_JSON";
  socialEntryUrl: string;
  officialChainEvidenceUrl: string;
}

interface SyntheticCandidateSeed {
  id: string;
  officialChineseName: string;
  pinyinName: string;
  category: "FOREIGN_PHARMA" | "DOMESTIC_PHARMA";
  targetStatus?: "ACTIVE" | typeof NO_LINK_STATUS;
  officialWebsiteUrl: string;
  socialEntryUrl?: string;
  officialChainEvidenceUrl?: string;
  campusEntryUrl?: string;
  socialSources?: SyntheticSocialSourceSeed[];
}

interface BuiltRegistry {
  companies: CandidateCompany[];
  surfaces: ExpectedOfficialRecruitmentSurface[];
}

type RegistryBuilder = (seeds: readonly SyntheticCandidateSeed[]) => BuiltRegistry;

function requireRegistryBuilder(): RegistryBuilder {
  const builder = (registry as unknown as { buildCandidateCompanyRegistry?: RegistryBuilder })
    .buildCandidateCompanyRegistry;
  expect(builder).toEqual(expect.any(Function));
  return builder!;
}

function makeSyntheticSeeds(options: { secondSourceForFirstLinked?: boolean } = {}): SyntheticCandidateSeed[] {
  return Array.from({ length: 60 }, (_, index) => {
    const noLink = index >= 58;
    const companyNumber = index + 1;
    const source = (suffix: string): SyntheticSocialSourceSeed => ({
      status: "VERIFIED_SCRAPABLE",
      atsKind: "OFFICIAL_JSON",
      socialEntryUrl: `https://careers.example.com/company-${companyNumber}/${suffix}`,
      officialChainEvidenceUrl: `https://company-${companyNumber}.example.com/careers/${suffix}`
    });

    return {
      id: `company-synthetic-${companyNumber}`,
      officialChineseName: `合成药企${companyNumber}`,
      pinyinName: `synthetic-${companyNumber}`,
      category: index < 30 ? "FOREIGN_PHARMA" : "DOMESTIC_PHARMA",
      targetStatus: noLink ? NO_LINK_STATUS : "ACTIVE",
      officialWebsiteUrl: `https://company-${companyNumber}.example.com/`,
      ...(noLink
        ? {}
        : {
            socialSources:
              index === 0 && options.secondSourceForFirstLinked
                ? [source("primary"), source("secondary")]
                : [source("primary")]
          })
    };
  });
}

function fullyResolveSurface(
  surface: ExpectedOfficialRecruitmentSurface
): ExpectedOfficialRecruitmentSurface {
  const evidenceArtifactSha256 = "a".repeat(64);
  return {
    ...surface,
    legalEntityScope: [{ status: "RESOLVED", value: "Legal entity", evidenceArtifactSha256 }],
    businessUnitScope: [{ status: "RESOLVED", value: "Pharma", evidenceArtifactSha256 }],
    brandScope: [{ status: "RESOLVED", value: "Brand", evidenceArtifactSha256 }],
    channels: [{ channelId: `${surface.surfaceId}-channel`, kind: "SOCIAL", status: "EXPECTED" }],
    chinaScope: { status: "RESOLVED", geography: "MAINLAND_CHINA", evidenceArtifactSha256 },
    adapterId: "official-json",
    status: "INCLUDED",
    oracleStatus: "INDEPENDENTLY_VERIFIED"
  };
}

describe("official-link registry cardinality", () => {
  it("validates a 30+30 roster with two exact no-link companies and 58 linked companies", () => {
    const built = requireRegistryBuilder()(makeSyntheticSeeds());

    expect(built.companies).toHaveLength(60);
    expect(built.companies.filter((company) => company.category === "FOREIGN_PHARMA")).toHaveLength(30);
    expect(built.companies.filter((company) => company.category === "DOMESTIC_PHARMA")).toHaveLength(30);
    expect(built.companies.filter((company) => company.targetStatus === NO_LINK_STATUS)).toHaveLength(2);
    expect(
      built.companies
        .filter((company) => company.targetStatus === NO_LINK_STATUS)
        .every((company) => company.sources.length === 0)
    ).toBe(true);
    expect(built.surfaces).toHaveLength(58);
    expect(registry.validateStrictCompanyRegistry(built.companies, built.surfaces, [])).toEqual([]);
  });

  it("rejects an exact no-link company that carries a source", () => {
    const source = registry.candidateCompanies[0]!.sources[0]!;
    const companies = registry.candidateCompanies.map((company, index) =>
      index === 0
        ? ({ ...company, targetStatus: NO_LINK_STATUS, sources: [source] } as unknown as CandidateCompany)
        : company
    );
    const surfaces = registry.expectedOfficialSurfaces.filter(
      (surface) => surface.companyId !== companies[0]!.id
    );

    expect(registry.validateStrictCompanyRegistry(companies, surfaces, registry.excludedCompanies)).toContain(
      "NO_LINK_COMPANY_HAS_SOURCE"
    );
  });

  it("rejects an exact no-link company that carries an expected surface", () => {
    const companies = registry.candidateCompanies.map((company, index) =>
      index === 0
        ? ({ ...company, targetStatus: NO_LINK_STATUS, sources: [] } as unknown as CandidateCompany)
        : company
    );

    expect(
      registry.validateStrictCompanyRegistry(companies, registry.expectedOfficialSurfaces, registry.excludedCompanies)
    ).toContain("NO_LINK_COMPANY_HAS_SURFACE");
  });

  it("represents two linked social sources and surfaces without a cardinality error", () => {
    const built = requireRegistryBuilder()(makeSyntheticSeeds({ secondSourceForFirstLinked: true }));
    const first = built.companies[0]!;

    expect(first.sources).toHaveLength(2);
    expect(built.surfaces.filter((surface) => surface.companyId === first.id && surface.kind === "SOCIAL"))
      .toHaveLength(2);
    expect(registry.validateStrictCompanyRegistry(built.companies, built.surfaces, [])).toEqual([]);
  });

  it("keeps Sandoz and Otsuka as blocking evidence gaps with their public URLs", () => {
    const byId = new Map(registry.candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-sandoz-china")).toMatchObject({
      targetStatus: "BLOCKED_EVIDENCE_GAP",
      sources: [{
        officialEntryUrl: "https://www.sandoz.com/careers/job-search/",
        officialChainEvidenceUrl: "https://www.sandoz.com/careers/job-search/"
      }]
    });
    expect(byId.get("company-otsuka-china")).toMatchObject({
      targetStatus: "BLOCKED_EVIDENCE_GAP",
      sources: [{
        officialEntryUrl: "https://chinaotsuka.com.cn/class/26",
        officialChainEvidenceUrl: "https://chinaotsuka.com.cn/class/26"
      }]
    });
  });

  it("derives launchability from 58 audited linked sources while current unresolved registry remains blocked", () => {
    const built = requireRegistryBuilder()(makeSyntheticSeeds());
    const readySurfaces = built.surfaces.map(fullyResolveSurface);
    const readyStats = registry.getCandidatePoolStats(built.companies, readySurfaces);
    const currentStats = registry.getCandidatePoolStats(
      registry.candidateCompanies,
      registry.expectedOfficialSurfaces
    );

    expect(readyStats.socialSources).toBe(58);
    expect(readyStats.verifiedScrapableCompanies).toBe(58);
    expect(readyStats.canLaunchP0).toBe(true);
    expect(currentStats.canLaunchP0).toBe(false);
  });

  it.each([
    ["source entry", (built: BuiltRegistry) => {
      const { officialEntryUrl: _entry, ...source } = built.companies[0]!.sources[0]!;
      built.companies[0]!.sources[0] = source;
    }],
    ["source chain", (built: BuiltRegistry) => {
      const { officialChainEvidenceUrl: _chain, ...source } = built.companies[0]!.sources[0]!;
      built.companies[0]!.sources[0] = source;
    }],
    ["surface entry", (built: BuiltRegistry) => {
      const { officialEntryUrl: _entry, ...surface } = built.surfaces[0]!;
      built.surfaces[0] = surface;
    }],
    ["surface chain", (built: BuiltRegistry) => {
      built.surfaces[0] = { ...built.surfaces[0]!, officialChainEvidenceUrls: [] };
    }]
  ] as const)("keeps launchability false when required %s evidence is missing", (_label, removeEvidence) => {
    const built = requireRegistryBuilder()(makeSyntheticSeeds());
    built.surfaces = built.surfaces.map(fullyResolveSurface);
    removeEvidence(built);

    expect(registry.getCandidatePoolStats(built.companies, built.surfaces).canLaunchP0).toBe(false);
  });

  it("rejects explicit socialSources combined with legacy official-entry evidence", () => {
    const seeds = makeSyntheticSeeds();
    seeds[59] = {
      ...seeds[59]!,
      socialSources: [],
      socialEntryUrl: "https://careers.example.com/conflicting-entry",
      officialChainEvidenceUrl: "https://company-60.example.com/careers"
    };

    expect(() => requireRegistryBuilder()(seeds)).toThrowError(
      "CONFLICTING_SOCIAL_SOURCE_FIELDS:company-synthetic-60"
    );
  });
});
