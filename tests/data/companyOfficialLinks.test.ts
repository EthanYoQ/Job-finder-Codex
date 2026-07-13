import { describe, expect, it } from "vitest";
import * as registry from "../../src/data/companyRegistry";
import type {
  CandidateCompany,
  ExpectedOfficialRecruitmentSurface
} from "../../src/data/companyRegistry";
import { confirmedCompanyRosterV3Members } from "../../src/data/confirmedCompanyRosterV3";
import { USER_AUTHORIZED_PHASE1_EXCLUSION } from "../../src/data/phase1ScopePolicy";

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
  targetStatus?: "ACTIVE" | typeof NO_LINK_STATUS | typeof USER_AUTHORIZED_PHASE1_EXCLUSION;
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
    const member = confirmedCompanyRosterV3Members[index]!;
    const authorizedExclusion = member.id === "company-humanwell" || member.id === "company-north-china-pharma";
    const companyNumber = index + 1;
    const source = (suffix: string): SyntheticSocialSourceSeed => ({
      status: "VERIFIED_SCRAPABLE",
      atsKind: "OFFICIAL_JSON",
      socialEntryUrl: `https://careers.example.com/company-${companyNumber}/${suffix}`,
      officialChainEvidenceUrl: `https://company-${companyNumber}.example.com/careers/${suffix}`
    });

    return {
      id: member.id,
      officialChineseName: `合成药企${companyNumber}`,
      pinyinName: `synthetic-${companyNumber}`,
      category: member.category,
      targetStatus: authorizedExclusion ? USER_AUTHORIZED_PHASE1_EXCLUSION : "ACTIVE",
      officialWebsiteUrl: `https://company-${companyNumber}.example.com/`,
      ...(authorizedExclusion
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
  it("validates a 30+30 roster with two exact authorized exclusions and 58 linked companies", () => {
    const built = requireRegistryBuilder()(makeSyntheticSeeds());

    expect(built.companies).toHaveLength(60);
    expect(built.companies.filter((company) => company.category === "FOREIGN_PHARMA")).toHaveLength(30);
    expect(built.companies.filter((company) => company.category === "DOMESTIC_PHARMA")).toHaveLength(30);
    expect(built.companies.filter((company) => company.targetStatus === USER_AUTHORIZED_PHASE1_EXCLUSION)).toHaveLength(2);
    expect(
      built.companies
        .filter((company) => company.targetStatus === USER_AUTHORIZED_PHASE1_EXCLUSION)
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

  it("keeps Sandoz blocked while preserving separate pending and verified Otsuka official sources", () => {
    const byId = new Map(registry.candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-sandoz-china")).toMatchObject({
      targetStatus: "BLOCKED_EVIDENCE_GAP",
      sources: [{
        officialEntryUrl: "https://www.sandoz.com/careers/job-search/",
        officialChainEvidenceUrl: "https://www.sandoz.com/careers/job-search/"
      }]
    });
    expect(byId.get("company-otsuka-china")).toMatchObject({
      targetStatus: "ACTIVE",
      sources: [
        {
          id: "source-otsuka-china-social",
          status: "ENTRY_FOUND_PENDING_ADAPTER",
          officialEntryUrl: "https://chinaotsuka.com.cn/class/26",
          officialChainEvidenceUrl: "https://www.otsuka.com.cn/otsuka-in-china/index.html"
        },
        {
          id: "source-otsuka-china-social-2",
          status: "VERIFIED_SCRAPABLE",
          officialEntryUrl: "https://www.otsuka.com.cn/join-us/index.html",
          officialChainEvidenceUrl: "https://www.otsuka.com.cn/join-us/index.html"
        }
      ]
    });
  });

  it("projects the fresh source bindings into official recruitment surfaces", () => {
    const socialSurfaceFor = (companyId: string) =>
      registry.expectedOfficialSurfaces.find(
        (surface) => surface.companyId === companyId && surface.kind === "SOCIAL"
      );

    expect(socialSurfaceFor("company-hengrui")).toMatchObject({
      officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
      officialChainEvidenceUrls: ["https://www.hengrui.com/development/joinUs.html"]
    });
    expect(
      registry.expectedOfficialSurfaces.find(
        (surface) => surface.companyId === "company-hengrui" && surface.kind === "CAMPUS"
      )
    ).toMatchObject({
      officialEntryUrl: "https://app.mokahr.com/m/campus-recruitment/hengrui/145997",
      officialChainEvidenceUrls: ["https://www.hengrui.com/development/joinUs.html"]
    });
    expect(socialSurfaceFor("company-ucb-china")?.officialEntryUrl).toBe(
      "https://careers.ucb.com/global/en/search-results?qcountry=China"
    );
    expect(socialSurfaceFor("company-tianjin-pharma")).toMatchObject({
      officialEntryUrl: "https://tjph.zhiye.com/social/jobs",
      officialChainEvidenceUrls: ["https://www.pharm.com.cn/"]
    });
    expect(socialSurfaceFor("company-xinhua-pharma")).toMatchObject({
      officialEntryUrl: "https://www.xhzy.com/SHZP/index.html",
      officialChainEvidenceUrls: ["https://www.xhzy.com/SHZP/index.html"]
    });
    expect(
      registry.expectedOfficialSurfaces.find(
        (surface) => surface.companyId === "company-apeloa" && surface.kind === "CAMPUS"
      )
    ).toMatchObject({ officialEntryUrl: "https://www.apeloa.com/join.html" });
    expect(socialSurfaceFor("company-grand-pharma")).toMatchObject({
      officialEntryUrl: "https://job.grandpharma.cn/",
      officialChainEvidenceUrls: ["https://job.grandpharma.cn/"]
    });
    expect(
      registry.expectedOfficialSurfaces.find(
        (surface) => surface.companyId === "company-grand-pharma" && surface.kind === "CAMPUS"
      )
    ).toMatchObject({ officialEntryUrl: "https://job.grandpharma.cn/schooldetail.html" });

    const surfaceUrls = registry.expectedOfficialSurfaces.flatMap((surface) => [
      surface.officialEntryUrl,
      ...surface.officialChainEvidenceUrls
    ]);
    expect(surfaceUrls).not.toContain("https://careers.ucb.com/global/en/search-results?keywords=China");
    expect(surfaceUrls).not.toContain("https://www.hengrui.com/development/recruit.html");
    expect(surfaceUrls).not.toContain("https://tjph1.zhiye.com/social/jobs");
    expect(surfaceUrls).not.toContain("https://www.pharm.com.cn/career/join.html");
    expect(surfaceUrls).not.toContain("https://www.xhzy.com/XYZP/index.html");
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
      "CONFLICTING_SOCIAL_SOURCE_FIELDS:company-yangzijiang"
    );
  });

  it.each(["socialSources", "legacy source fields"] as const)(
    "fails closed when an authorized exclusion supplies %s",
    (kind) => {
      const seeds = makeSyntheticSeeds();
      const index = seeds.findIndex(({ id }) => id === "company-humanwell");
      const source = {
        status: "VERIFIED_SCRAPABLE" as const,
        atsKind: "OFFICIAL_JSON" as const,
        socialEntryUrl: "https://careers.example.com/humanwell/jobs",
        officialChainEvidenceUrl: "https://careers.example.com/humanwell"
      };
      seeds[index] = kind === "socialSources"
        ? { ...seeds[index]!, socialSources: [source] }
        : { ...seeds[index]!, ...source };

      expect(() => requireRegistryBuilder()(seeds)).toThrow(/humanwell|source/i);
    }
  );

  it.each([
    ["unauthorized third exclusion", (seeds: SyntheticCandidateSeed[]) => {
      seeds[0] = { ...seeds[0]!, targetStatus: USER_AUTHORIZED_PHASE1_EXCLUSION, socialSources: [] };
    }],
    ["missing authorized ID", (seeds: SyntheticCandidateSeed[]) => {
      seeds.splice(seeds.findIndex(({ id }) => id === "company-humanwell"), 1);
    }],
    ["unmarked authorized ID", (seeds: SyntheticCandidateSeed[]) => {
      const index = seeds.findIndex(({ id }) => id === "company-humanwell");
      seeds[index] = { ...seeds[index]!, targetStatus: "ACTIVE", socialSources: [] };
    }]
  ] as const)("public registry builder rejects %s", (_label, mutate) => {
    const seeds = makeSyntheticSeeds();
    mutate(seeds);
    expect(() => requireRegistryBuilder()(seeds)).toThrow(/authorized|humanwell/i);
  });
});
