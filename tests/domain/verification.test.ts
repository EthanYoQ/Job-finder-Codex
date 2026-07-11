import { describe, expect, it } from "vitest";
import "../../src/domain/company";
import type { Company, CrawlObservation, RecruitmentSource } from "../../src/domain/company";
import {
  canLaunchP0,
  countVerifiedCompanies,
  isVerifiedScrapable
} from "../../src/domain/verification";

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
  return {
    id: `company-${index}`,
    officialChineseName: `测试药企${index}`,
    officialWebsiteUrl: `https://example-${index}.com`,
    pinyinName: `ce shi yao qi ${index}`,
    category: "FOREIGN_PHARMA",
      targetStatus: "ACTIVE",
    sources: [
      createSource({
        id: `source-${index}`,
        companyId: `company-${index}`,
        status: "VERIFIED_SCRAPABLE",
        ...sourceOverrides
      })
    ]
  };
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

  it("blocks P0 launch until all 60 confirmed companies are verified scrapable", () => {
    const companies: Company[] = Array.from({ length: 60 }, (_, index) =>
      createCompany(index)
    );
    const observationsBySource = Object.fromEntries(
      companies.map((company, index) => {
        const sourceId = company.sources[0]!.id;
        return [sourceId, index < 59 ? createVerifiedObservationPair(sourceId) : []];
      })
    );

    expect(countVerifiedCompanies(companies, observationsBySource)).toBe(59);
    expect(canLaunchP0(companies, observationsBySource)).toBe(false);
  });

  it("allows launch only when all 60 confirmed companies have verified completeness evidence", () => {
    const companies: Company[] = Array.from({ length: 60 }, (_, index) =>
      createCompany(index, {
        status: "VERIFIED_SCRAPABLE"
      })
    );
    const observationsBySource = Object.fromEntries(
      companies.map((company) => {
        const sourceId = company.sources[0]!.id;
        return [sourceId, createVerifiedObservationPair(sourceId)];
      })
    );

    expect(countVerifiedCompanies(companies, observationsBySource)).toBe(60);
    expect(canLaunchP0(companies, observationsBySource)).toBe(true);
  });

  it("blocks launch when the candidate pool is not exactly 60 companies", () => {
    const companies: Company[] = Array.from({ length: 61 }, (_, index) =>
      createCompany(index, {
        status: "VERIFIED_SCRAPABLE"
      })
    );
    const observationsBySource = Object.fromEntries(
      companies.map((company) => {
        const sourceId = company.sources[0]!.id;
        return [sourceId, createVerifiedObservationPair(sourceId)];
      })
    );

    expect(countVerifiedCompanies(companies, observationsBySource)).toBe(61);
    expect(canLaunchP0(companies, observationsBySource)).toBe(false);
  });

  it("excludes campus-only sources from the verified company count", () => {
    const socialCompany = createCompany(1);
    const campusCompany = createCompany(2, {
      kind: "CAMPUS"
    });
    const observationsBySource = {
      [socialCompany.sources[0]!.id]: createVerifiedObservationPair(
        socialCompany.sources[0]!.id
      ),
      [campusCompany.sources[0]!.id]: createVerifiedObservationPair(
        campusCompany.sources[0]!.id
      )
    };

    expect(countVerifiedCompanies([socialCompany, campusCompany], observationsBySource)).toBe(1);
  });
});
