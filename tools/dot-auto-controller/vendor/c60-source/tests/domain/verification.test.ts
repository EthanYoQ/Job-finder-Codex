import { describe, expect, it } from "vitest";
import "../../src/domain/company";
import type { Company, CrawlObservation, RecruitmentSource } from "../../src/domain/company";
import {
  canLaunchP0,
  countVerifiedCompanies,
  isVerifiedScrapable
} from "../../src/domain/verification";
import { confirmedCompanyRosterV3Members } from "../../src/data/confirmedCompanyRosterV3";

const requiredFields = ["company", "title", "officialUrl", "location"] as const;

function createObservation(
  sourceId: string,
  crawledAt: string,
  overrides: Partial<CrawlObservation> = {}
): CrawlObservation {
  return {
    id: `${sourceId}-${crawledAt}`,
    sourceId,
    crawledAt: new Date(crawledAt),
    successful: true,
    structuredJobCount: 12,
    completenessStatus: "VERIFIED",
    completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
    completenessEvidenceUrl: "https://example.com/jobs",
    stableRequiredFields: [...requiredFields],
    ...overrides
  };
}

function createSource(
  overrides: Partial<RecruitmentSource> = {}
): RecruitmentSource {
  return {
    id: "source-astrazeneca-social",
    companyId: "company-astrazeneca",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    officialEntryUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c",
    officialChainEvidenceUrl: "https://www.astrazeneca.cn/careers",
    status: "ENTRY_FOUND_PENDING_ADAPTER",
    ...overrides
  };
}

function createCompany(
  index: number,
  sourceOverrides: Partial<RecruitmentSource> = {}
): Company {
  const rosterMember = confirmedCompanyRosterV3Members[index];
  const authorizedExclusion = rosterMember?.id === "company-humanwell" ||
    rosterMember?.id === "company-north-china-pharma";
  return {
    id: rosterMember?.id ?? `company-extra-${index}`,
    officialChineseName: `测试药企${index}`,
    officialWebsiteUrl: `https://example-${index}.com`,
    pinyinName: `ce shi yao qi ${index}`,
    category: rosterMember?.category ?? "DOMESTIC_PHARMA",
    targetStatus: authorizedExclusion ? "USER_AUTHORIZED_PHASE1_EXCLUSION" : "ACTIVE",
    sources: authorizedExclusion ? [] : [
      createSource({
        id: `source-${index}`,
        companyId: rosterMember?.id ?? `company-extra-${index}`,
        status: "VERIFIED_SCRAPABLE",
        ...sourceOverrides
      })
    ]
  };
}

function configuredSourceIds(companies: readonly Company[]): Set<string> {
  return new Set(companies.flatMap((company) => company.sources.filter((source) => source.kind === "SOCIAL").map((source) => source.id)));
}

function createVerifiedObservationPair(sourceId: string): CrawlObservation[] {
  return [
    createObservation(sourceId, "2026-07-07T08:00:00Z", {
      id: `${sourceId}-crawl-1`
    }),
    createObservation(sourceId, "2026-07-07T20:00:00Z", {
      id: `${sourceId}-crawl-2`
    })
  ];
}

describe("company source domain", () => {
  it("represents a company with official social and campus source separation", () => {
    const socialSource: RecruitmentSource = {
      id: "source-hengrui-social",
      companyId: "company-hengrui",
      kind: "SOCIAL",
      atsKind: "MOKA",
      officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
      officialChainEvidenceUrl: "https://www.hengrui.com/careers",
      status: "VERIFIED_SCRAPABLE"
    };

    const company: Company = {
      id: "company-hengrui",
      officialChineseName: "江苏恒瑞医药股份有限公司",
      officialWebsiteUrl: "https://www.hengrui.com",
      pinyinName: "jiang su heng rui yi yao gu fen you xian gong si",
      category: "FOREIGN_PHARMA",
      targetStatus: "ACTIVE",
      sources: [socialSource]
    };

    expect(company.sources[0]?.kind).toBe("SOCIAL");
    expect(company.sources[0]?.status).toBe("VERIFIED_SCRAPABLE");
  });
});

describe("verified scrapable gate", () => {
  const source = createSource();

  it("rejects sources that have only one successful crawl", () => {
    const observations = [createObservation(source.id, "2026-07-07T08:00:00Z")];

    expect(isVerifiedScrapable(source, observations)).toBe(false);
  });

  it("rejects sources that still have pending adapter status even with two successful stable crawls", () => {
    const observations = createVerifiedObservationPair(source.id);

    expect(isVerifiedScrapable(source, observations)).toBe(false);
  });

  it("ignores observations from other sources when called directly", () => {
    const verifiedSource = createSource({
      status: "VERIFIED_SCRAPABLE"
    });
    const observations = [
      ...createVerifiedObservationPair("source-other"),
      createObservation(verifiedSource.id, "2026-07-07T20:00:00Z", {
        id: "crawl-verified-latest"
      })
    ];

    expect(isVerifiedScrapable(verifiedSource, observations)).toBe(false);
  });

  it("rejects sources when the latest crawl failed", () => {
    const verifiedSource = createSource({
      status: "VERIFIED_SCRAPABLE"
    });
    const observations = [
      createObservation(verifiedSource.id, "2026-07-07T08:00:00Z", {
        id: "crawl-1"
      }),
      createObservation(verifiedSource.id, "2026-07-07T20:00:00Z", {
        id: "crawl-2",
        successful: false,
        failureReason: "timeout"
      })
    ];

    expect(isVerifiedScrapable(verifiedSource, observations)).toBe(false);
  });

  it("rejects sources when the latest two crawls are not consecutive stable successes", () => {
    const verifiedSource = createSource({
      status: "VERIFIED_SCRAPABLE"
    });
    const observations = [
      createObservation(verifiedSource.id, "2026-07-07T08:00:00Z", {
        id: "crawl-1"
      }),
      createObservation(verifiedSource.id, "2026-07-07T12:00:00Z", {
        id: "crawl-2",
        successful: false,
        failureReason: "blocked"
      }),
      createObservation(verifiedSource.id, "2026-07-07T20:00:00Z", {
        id: "crawl-3"
      })
    ];

    expect(isVerifiedScrapable(verifiedSource, observations)).toBe(false);
  });

  it("accepts sources with the latest two successful stable crawls for that source", () => {
    const verifiedSource = createSource({
      status: "VERIFIED_SCRAPABLE"
    });
    const observations = [
      createObservation(verifiedSource.id, "2026-07-06T20:00:00Z", {
        id: "crawl-older",
        successful: false,
        failureReason: "older failure"
      }),
      ...createVerifiedObservationPair(verifiedSource.id)
    ];

    expect(isVerifiedScrapable(verifiedSource, observations)).toBe(true);
  });

  it("rejects successful crawls that do not include verified completeness evidence", () => {
    const verifiedSource = createSource({
      status: "VERIFIED_SCRAPABLE"
    });
    const olderObservation = createObservation(verifiedSource.id, "2026-07-07T08:00:00Z", {
      id: "crawl-1"
    });
    const newerObservation = createObservation(verifiedSource.id, "2026-07-07T20:00:00Z", {
      id: "crawl-2"
    });
    delete olderObservation.completenessStatus;
    delete newerObservation.completenessStatus;
    const observations = [olderObservation, newerObservation];

    expect(isVerifiedScrapable(verifiedSource, observations)).toBe(false);
  });

  it("rejects successful crawls when structured jobs are below the source-declared expected count", () => {
    const verifiedSource = createSource({
      status: "VERIFIED_SCRAPABLE"
    });
    const observations = [
      createObservation(verifiedSource.id, "2026-07-07T08:00:00Z", {
        id: "crawl-1",
        structuredJobCount: 15,
        expectedJobCount: 283
      }),
      createObservation(verifiedSource.id, "2026-07-07T20:00:00Z", {
        id: "crawl-2",
        structuredJobCount: 15,
        expectedJobCount: 283
      })
    ];

    expect(isVerifiedScrapable(verifiedSource, observations)).toBe(false);
  });

  it("accepts official zero-job observations when the latest two crawls have verified zero expected count", () => {
    const verifiedSource = createSource({
      status: "VERIFIED_SCRAPABLE"
    });
    const observations = [
      createObservation(verifiedSource.id, "2026-07-07T08:00:00Z", {
        id: "crawl-1",
        structuredJobCount: 0,
        expectedJobCount: 0,
        stableRequiredFields: []
      }),
      createObservation(verifiedSource.id, "2026-07-07T20:00:00Z", {
        id: "crawl-2",
        structuredJobCount: 0,
        expectedJobCount: 0,
        stableRequiredFields: []
      })
    ];

    expect(isVerifiedScrapable(verifiedSource, observations)).toBe(true);
  });

  it("accepts a lossless explicit transition from a positive official total to an official zero", () => {
    const verifiedSource = createSource({
      status: "VERIFIED_SCRAPABLE"
    });
    const observations = [
      createObservation(verifiedSource.id, "2026-07-07T08:00:00Z", {
        id: "crawl-positive",
        structuredJobCount: 2,
        expectedJobCount: 2
      }),
      createObservation(verifiedSource.id, "2026-07-07T20:00:00Z", {
        id: "crawl-zero",
        structuredJobCount: 0,
        expectedJobCount: 0,
        stableRequiredFields: []
      })
    ];

    expect(isVerifiedScrapable(verifiedSource, observations)).toBe(true);
  });

  it("rejects a latest pair containing a weak manual observation even when it claims verified status", () => {
    const verifiedSource = createSource({
      status: "VERIFIED_SCRAPABLE"
    });
    const observations = [
      createObservation(verifiedSource.id, "2026-07-07T08:00:00Z", {
        id: "crawl-official"
      }),
      createObservation(verifiedSource.id, "2026-07-07T20:00:00Z", {
        id: "crawl-weak-manual",
        completenessEvidenceKind: "WEAK_MANUAL_SAMPLE"
      })
    ];

    expect(isVerifiedScrapable(verifiedSource, observations)).toBe(false);
  });

  it("keeps two authorized exclusions outside verified completeness and launch blocking", () => {
    const companies: Company[] = Array.from({ length: 60 }, (_, index) => {
      return createCompany(index, { status: "VERIFIED_SCRAPABLE" });
    });
    const observationsBySource = Object.fromEntries(
      companies.flatMap((company) => {
        if (company.sources.length === 0) return [];
        const sourceId = company.sources[0]!.id;
        return [[sourceId, createVerifiedObservationPair(sourceId)]];
      })
    );

    expect(countVerifiedCompanies(companies, observationsBySource)).toBe(58);
    expect(canLaunchP0(companies, observationsBySource, configuredSourceIds(companies))).toBe(true);
  });

  it("fails closed when an authorized exclusion status drifts before verified counting", () => {
    const companies = Array.from({ length: 60 }, (_, index) =>
      createCompany(index, { status: "VERIFIED_SCRAPABLE" })
    );
    const excluded = companies.find(({ id }) => id === "company-humanwell")!;
    excluded.targetStatus = "ACTIVE";
    excluded.sources = [createSource({
      id: "source-humanwell-forged",
      companyId: excluded.id,
      status: "VERIFIED_SCRAPABLE"
    })];
    const observations = {
      "source-humanwell-forged": createVerifiedObservationPair("source-humanwell-forged")
    };

    expect(() => countVerifiedCompanies(companies, observations)).toThrow(/humanwell|authorized/i);
  });

  it("rejects an exact confirmed 30+30 caller roster when all no-link adjudications lack startup-v3 authority", () => {
    const companies = Array.from({ length: 60 }, (_, index) => ({
      ...createCompany(index),
      targetStatus: "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" as const,
      sources: []
    }));

    expect(canLaunchP0(companies, {}, new Set())).toBe(false);
  });

  it("blocks when one company has two expected social sources and only one is complete", () => {
    const companies = Array.from({ length: 60 }, (_, index) =>
      createCompany(index, { status: "VERIFIED_SCRAPABLE" })
    );
    const second = createSource({
      id: "source-0-secondary",
      companyId: companies[0]!.id,
      status: "VERIFIED_SCRAPABLE"
    });
    companies[0]!.sources.push(second);
    const observationsBySource = Object.fromEntries(companies.flatMap((company) =>
      company.sources.map((source) => [source.id, source.id === second.id ? [] : createVerifiedObservationPair(source.id)])));

    expect(canLaunchP0(companies, observationsBySource, configuredSourceIds(companies))).toBe(false);
  });

  it.each([
    ["evidence gap", (companies: Company[]) => { companies[0]!.targetStatus = "BLOCKED_EVIDENCE_GAP"; }],
    ["no-link with source", (companies: Company[]) => { companies[0]!.targetStatus = "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME"; }],
    ["active with zero social sources", (companies: Company[]) => { companies[0]!.sources = []; }],
    ["31/29 categories", (companies: Company[]) => { companies[30]!.category = "FOREIGN_PHARMA"; }],
    ["duplicate id", (companies: Company[]) => { companies[59]!.id = companies[0]!.id; }],
    ["missing roster member", (companies: Company[]) => { companies.pop(); }]
  ])("blocks %s without weakening another complete source", (_label, mutate) => {
    const companies = Array.from({ length: 60 }, (_, index) =>
      createCompany(index, { status: "VERIFIED_SCRAPABLE" })
    );
    mutate(companies);
    const observationsBySource = Object.fromEntries(companies.flatMap((company) =>
      company.sources.map((source) => [source.id, createVerifiedObservationPair(source.id)])));

    expect(canLaunchP0(companies, observationsBySource, configuredSourceIds(companies))).toBe(false);
  });

  it("blocks launch when the candidate pool is not exactly 60 companies", () => {
    const companies: Company[] = Array.from({ length: 61 }, (_, index) =>
      createCompany(index, {
        status: "VERIFIED_SCRAPABLE"
      })
    );
    const observationsBySource = Object.fromEntries(
      companies.flatMap((company) => {
        if (company.sources.length === 0) return [];
        const sourceId = company.sources[0]!.id;
        return [[sourceId, createVerifiedObservationPair(sourceId)]];
      })
    );

    expect(countVerifiedCompanies(companies, observationsBySource)).toBe(59);
    expect(canLaunchP0(companies, observationsBySource, configuredSourceIds(companies))).toBe(false);
  });

  it("rejects a unique same-category replacement outside confirmed V3", () => {
    const companies = Array.from({ length: 60 }, (_, index) => createCompany(index, { status: "VERIFIED_SCRAPABLE" }));
    companies[0] = { ...companies[0]!, id: "company-foreign-replacement",
      sources: companies[0]!.sources.map((source) => ({ ...source, companyId: "company-foreign-replacement" })) };
    const observations = Object.fromEntries(companies.flatMap((company) => company.sources.map((source) => [source.id, createVerifiedObservationPair(source.id)])));
    expect(canLaunchP0(companies, observations, configuredSourceIds(companies))).toBe(false);
  });

  it("requires an exact explicit configured source set with no omission or substitution", () => {
    const companies = Array.from({ length: 60 }, (_, index) => createCompany(index, { status: "VERIFIED_SCRAPABLE" }));
    const observations = Object.fromEntries(companies.flatMap((company) => company.sources.map((source) => [source.id, createVerifiedObservationPair(source.id)])));
    const exact = configuredSourceIds(companies);
    expect(canLaunchP0(companies, observations, exact)).toBe(true);
    expect(canLaunchP0(companies, observations, new Set([...exact].slice(1)))).toBe(false);
    expect(canLaunchP0(companies, observations, new Set([...exact, "source-substitute"]))).toBe(false);
  });

  it("excludes campus-only sources from the verified company count", () => {
    const companies = Array.from({ length: 60 }, (_, index) => createCompany(index));
    companies.forEach((company) => { company.sources = []; });
    const socialCompany = createCompany(1);
    const campusCompany = createCompany(2, { kind: "CAMPUS" });
    companies[1] = socialCompany;
    companies[2] = campusCompany;
    const observationsBySource = {
      [socialCompany.sources[0]!.id]: createVerifiedObservationPair(
        socialCompany.sources[0]!.id
      ),
      [campusCompany.sources[0]!.id]: createVerifiedObservationPair(
        campusCompany.sources[0]!.id
      )
    };

    expect(countVerifiedCompanies(companies, observationsBySource)).toBe(1);
  });
});
