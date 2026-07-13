import { describe, expect, it } from "vitest";
import {
  buildDiscoverySourcePlanCandidates,
  buildSourceCrawlPlans,
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  validateExecutablePlanChannelBinding
} from "../../src/crawler/sourcePlan";
import {
  candidateCompanies,
  expectedOfficialSurfaces,
  type CandidateCompany
} from "../../src/data/companyRegistry";
import { AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS } from "../../src/data/phase1ScopePolicy";

const plannedMainListSourceIds = new Set([
  "source-3sbio-social",
  "source-amgen-china-social",
  "source-abbvie-china-social",
  "source-astellas-china-social",
  "source-astrazeneca-social",
  "source-bayer-healthcare-social",
  "source-biogen-china-social",
  "source-boehringer-ingelheim-china-social",
  "source-bms-china-social",
  "source-cr-pharma-social",
  "source-cspc-social",
  "source-csl-china-social",
  "source-cttq-social",
  "source-daiichi-sankyo-china-social",
  "source-dongyangguang-social",
  "source-fosun-pharma-social",
  "source-gilead-china-social",
  "source-grifols-china-social",
  "source-gsk-china-social",
  "source-hansoh-social",
  "source-hengrui-social",
  "source-jimin-kexin-social",
  "source-johnson-innovative-medicine-social",
  "source-kelun-social",
  "source-lilly-china-social",
  "source-lunan-social",
  "source-merck-china-social",
  "source-msd-china-social",
  "source-nhu-social",
  "source-novartis-social",
  "source-novo-nordisk-china-social",
  "source-organon-china-social",
  "source-pfizer-china-social",
  "source-qilu-social",
  "source-roche-china-social",
  "source-sanofi-china-social",
  "source-servier-china-social",
  "source-takeda-china-social",
  "source-teva-china-social",
  "source-tianjin-pharma-social",
  "source-tongrentang-social",
  "source-ucb-china-social",
  "source-united-lab-social",
  "source-viatris-social",
  "source-xiuzheng-social",
  "source-yangzijiang-social"
]);

const excludedSourceIds = [
  "source-abbott-china-social",
  "source-agilent-china-social",
  "source-edwards-china-social",
  "source-gehc-china-social",
  "source-haleon-china-social",
  "source-kenvue-china-social",
  "source-medtronic-china-social",
  "source-stryker-china-social",
  "source-thermo-fisher-china-social"
];

describe("source crawl planning", () => {
  it("promotes the current research candidates into channel-bound staged plans without weakening strict plans", () => {
    const discovery = buildDiscoverySourcePlanCandidates(candidateCompanies);
    const staged = buildStagedSourceCrawlPlans(candidateCompanies);

    expect(staged.map((plan) => plan.source.id)).toEqual(discovery.map((plan) => plan.source.id));
    expect(buildSourceCrawlPlans(candidateCompanies)).toEqual([]);
    for (const plan of staged) {
      expect(plan).toHaveProperty("executionAuthority", "STAGED");
      expect(() => validateExecutablePlanChannelBinding(plan)).not.toThrow();
    }
    for (const plan of discovery) expect(() => validateExecutablePlanChannelBinding(plan)).toThrow();
  });

  it("fails staged planning closed for source-owner drift and both authorized exclusions", () => {
    const company = candidateCompanies.find((item) => item.id === "company-astrazeneca")!;
    const source = company.sources[0]!;
    const wrongOwner = {
      ...company,
      sources: [{ ...source, companyId: "company-abbvie-china" }]
    };
    expect(buildStagedSourceCrawlPlans([wrongOwner])).toEqual([]);

    const outOfRosterCompany = {
      ...company,
      id: "company-not-in-confirmed-roster",
      sources: [{ ...source, companyId: "company-not-in-confirmed-roster" }]
    };
    const outOfRosterSurface = {
      ...expectedOfficialSurfaces.find((surface) => surface.surfaceId === source.surfaceId)!,
      companyId: outOfRosterCompany.id
    };
    expect(buildStagedSourceCrawlPlans([outOfRosterCompany], [outOfRosterSurface])).toEqual([]);

    for (const excludedCompanyId of AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS) {
      const excludedCompany = {
        ...company,
        id: excludedCompanyId,
        targetStatus: "USER_AUTHORIZED_PHASE1_EXCLUSION" as const,
        sources: [{ ...source, companyId: excludedCompanyId }]
      };
      const excludedSurface = {
        ...expectedOfficialSurfaces.find((surface) => surface.surfaceId === source.surfaceId)!,
        companyId: excludedCompanyId
      };
      expect(buildStagedSourceCrawlPlans([excludedCompany], [excludedSurface])).toEqual([]);
      expect(buildSourceCrawlPlans([excludedCompany], [excludedSurface])).toEqual([]);
    }
  });

  it("rejects a configured source transplanted consistently to another canonical company", () => {
    const sourceCompany = candidateCompanies.find((item) => item.id === "company-astrazeneca")!;
    const targetCompany = candidateCompanies.find((item) => item.id === "company-abbvie-china")!;
    const source = sourceCompany.sources[0]!;
    const canonicalSurface = expectedOfficialSurfaces.find((surface) => surface.surfaceId === source.surfaceId)!;
    const transplantedCompany = {
      ...targetCompany,
      sources: [{ ...source, companyId: targetCompany.id }]
    };
    const transplantedSurface = { ...canonicalSurface, companyId: targetCompany.id };

    expect(buildStagedSourceCrawlPlans([transplantedCompany], [transplantedSurface])).toEqual([]);
  });

  it("binds staged company, source, and surface authority fields to the canonical registry", () => {
    const company = candidateCompanies.find((item) => item.id === "company-astrazeneca")!;
    const source = company.sources[0]!;
    const surface = expectedOfficialSurfaces.find((item) => item.surfaceId === source.surfaceId)!;

    expect(buildStagedSourceCrawlPlans([{ ...company, officialChineseName: "caller supplied name" }])).toEqual([]);

    const changedSurfaceId = `${source.surfaceId}-caller`;
    expect(buildStagedSourceCrawlPlans(
      [{ ...company, sources: [{ ...source, surfaceId: changedSurfaceId }] }],
      [{ ...surface, surfaceId: changedSurfaceId }]
    )).toEqual([]);

    const changedEntry = "https://example.com/caller-entry";
    expect(buildStagedSourceCrawlPlans(
      [{ ...company, sources: [{ ...source, officialEntryUrl: changedEntry }] }],
      [{ ...surface, officialEntryUrl: changedEntry }]
    )).toEqual([]);

    const changedChain = "https://example.com/caller-chain";
    expect(buildStagedSourceCrawlPlans(
      [{ ...company, sources: [{ ...source, officialChainEvidenceUrl: changedChain }] }],
      [{ ...surface, officialChainEvidenceUrls: [changedChain] }]
    )).toEqual([]);

    expect(buildStagedSourceCrawlPlans(
      [{ ...company, sources: [{ ...source, atsKind: "SUCCESSFACTORS" as const }] }],
      [{ ...surface, atsKind: "SUCCESSFACTORS" as const }]
    )).toEqual([]);
  });

  it("quarantines J&J from formal plans even when a caller labels searchText and six facets independently verified", () => {
    const company = candidateCompanies.find((item) => item.id === "company-johnson-innovative-medicine")!;
    const source = company.sources[0]!;
    const fakeHash = "a".repeat(64);
    const surface = {
      surfaceId: source.surfaceId!, companyId: company.id, kind: "SOCIAL" as const,
      legalEntityScope: [{ status: "RESOLVED" as const, value: "Johnson & Johnson China", evidenceArtifactSha256: fakeHash }],
      businessUnitScope: [{ status: "RESOLVED" as const, value: "Innovative Medicine", evidenceArtifactSha256: fakeHash }],
      brandScope: [{ status: "RESOLVED" as const, value: "Johnson & Johnson", evidenceArtifactSha256: fakeHash }],
      channels: [{ channelId: `source:${source.id}:default`, kind: "SOCIAL" as const, status: "EXPECTED" as const }],
      chinaScope: { status: "RESOLVED" as const, geography: "MAINLAND_CHINA" as const, evidenceArtifactSha256: fakeHash },
      fullReleaseScopeEvidence: {
        status: "INDEPENDENTLY_SIGNED", officialUnfilteredPopulationSha256: "1".repeat(64),
        mainlandChinaGeographyFilterSha256: "2".repeat(64), businessUnitBoundarySha256: "3".repeat(64),
        exactChannelFacetUnionSha256: "4".repeat(64), archivedJobIdSetReconciliationSha256: "5".repeat(64),
        reviewerArtifactSha256: "6".repeat(64), reviewerSignatureSha256: "7".repeat(64)
      },
      officialEntryUrl: source.officialEntryUrl!, officialChainEvidenceUrls: [source.officialChainEvidenceUrl!],
      atsKind: source.atsKind, adapterId: "official-json" as const, status: "INCLUDED" as const,
      includeReason: "caller claims the finite search configuration is complete",
      oracleStatus: "INDEPENDENTLY_VERIFIED" as const
    };

    const clonedCompany = { ...company, sources: [{ ...source }] };
    expect(buildSourceCrawlPlans([clonedCompany], [surface as never])).toEqual([]);
    const renamedSource = { ...source, id: `${source.id}-clone`, surfaceId: `${source.surfaceId}-clone` };
    const renamedCompany = { ...company, id: `${company.id}-clone`, sources: [{ ...renamedSource, companyId: `${company.id}-clone` }] };
    const renamedSurface = { ...surface, surfaceId: renamedSource.surfaceId, companyId: renamedCompany.id };
    expect(buildSourceCrawlPlans([renamedCompany], [renamedSurface as never])).toEqual([]);
    expect(getPlanBySourceId(buildDiscoverySourcePlanCandidates([company], [surface as never]), source.id)).toBeDefined();
  });

  it("creates crawl plans only for confirmed 60-list social sources with official-chain evidence", () => {
    const plans = buildDiscoverySourcePlanCandidates(candidateCompanies);

    expect(new Set(plans.map((plan) => plan.source.id))).toEqual(plannedMainListSourceIds);
    expect(plans.every((plan) => plan.source.kind === "SOCIAL")).toBe(true);
    expect(plans.every((plan) => plan.source.status === "VERIFIED_SCRAPABLE")).toBe(true);
    expect(plans.every((plan) => plan.source.officialEntryUrl)).toBe(true);
    expect(plans.every((plan) => plan.source.officialChainEvidenceUrl)).toBe(true);
  });

  it("does not plan excluded legacy device, life-science, or consumer-health sources", () => {
    const plans = buildDiscoverySourcePlanCandidates(candidateCompanies);
    const plannedSourceIds = new Set(plans.map((plan) => plan.source.id));

    for (const sourceId of excludedSourceIds) {
      expect(plannedSourceIds.has(sourceId)).toBe(false);
    }
  });

  it("does not plan pending or unverified sources even when URLs are present", () => {
    const pendingConfiguredCompany: CandidateCompany = {
      id: "company-astrazeneca",
      officialChineseName: "阿斯利康中国",
      pinyinName: "asili-kang",
      category: "FOREIGN_PHARMA",
      targetStatus: "ACTIVE",
      sources: [
        {
          id: "source-astrazeneca-social",
          surfaceId: "surface-astrazeneca-social",
          companyId: "company-astrazeneca",
          kind: "SOCIAL",
          atsKind: "OFFICIAL_HTML",
          status: "ENTRY_FOUND_PENDING_ADAPTER",
          officialEntryUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c",
          officialChainEvidenceUrl: "https://careers.astrazeneca.com/china"
        }
      ]
    };

    const plans = buildSourceCrawlPlans([pendingConfiguredCompany]);

    expect(getPlanBySourceId(plans, "source-astrazeneca-social")).toBeUndefined();
  });

  it("keeps core adapter assignments for representative 60-list sources", () => {
    const plans = buildDiscoverySourcePlanCandidates(candidateCompanies);

    expect(getPlanBySourceId(plans, "source-astrazeneca-social")).toMatchObject({
      adapterId: "html-table",
      table: {
        rowSelector: "#search-results-list li",
        pagination: {
          totalPagesSelector: "#search-results",
          totalPagesAttribute: "data-total-pages",
          pageSearchParam: "p",
          maxPages: 25,
          expectedJobCountSelector: "#search-results",
          expectedJobCountAttribute: "data-total-job-results"
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-astellas-china-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.astellas.com/en/careers/china-recruitment",
        officialChainEvidenceUrl: "https://www.astellas.com/en/careers/china-recruitment"
      },
      table: {
        rowSelector: "a[href$='.pdf'][href*='/global/zh/']",
        fields: {
          officialTitle: { selector: ":scope" },
          officialUrl: { selector: ":scope", attribute: "href" },
          locationRaw: { value: "中国" }
        },
        pagination: {
          expectedJobCountSelector: "a[href$='.pdf'][href*='/global/zh/']"
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-johnson-innovative-medicine-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://jj.wd5.myworkdayjobs.com/JJ"
      },
      workday: {
        tenant: "jj",
        site: "JJ",
        searchText: "China",
        appliedFacets: {
          jobFamilyGroup: expect.arrayContaining([
            "604dc786859810010c32535ce4950000",
            "604dc786859810010c3230da4ca90000"
          ])
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-abbvie-china-social")).toMatchObject({
      adapterId: "html-table",
      table: {
        rowSelector: ".attrax-vacancy-tile",
        pagination: {
          totalPagesSelector: ".attrax-pagination__results-of--2",
          totalPagesPattern: "(\\d+)",
          pageSearchParam: "page",
          expectedJobCountSelector: ".attrax-pagination__total-results",
          expectedJobCountPattern: "(\\d+)"
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-hengrui-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "MOKA",
        officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
        officialChainEvidenceUrl: "https://www.hengrui.com/development/joinUs.html"
      },
      moka: {
        expectedOrgId: "hengrui",
        expectedSiteId: "145996",
        expectedMode: "social",
        campaignUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996",
        hydrateMissingLocationsFromDetail: true
      }
    });
    expect(getPlanBySourceId(plans, "source-jimin-kexin-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "MOKA",
        officialEntryUrl: "https://app.mokahr.com/social-recruitment/jemincare/78315#/jobs",
        officialChainEvidenceUrl: "https://www.jemincare.com/"
      },
      moka: {
        expectedOrgId: "jemincare",
        expectedSiteId: "78315",
        expectedMode: "social",
        campaignUrl: "https://app.mokahr.com/social-recruitment/jemincare/78315",
        hydrateMissingLocationsFromDetail: true
      }
    });
    const hengruiPlan = getPlanBySourceId(plans, "source-hengrui-social");
    expect(hengruiPlan?.adapterId).toBe("official-json");
    if (!hengruiPlan || hengruiPlan.adapterId !== "official-json") {
      throw new Error("Expected Hengrui to use the official JSON Moka plan");
    }
    expect(hengruiPlan.moka?.campaignUrl).not.toContain("145997");
    expect(getPlanBySourceId(plans, "source-xiuzheng-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: "https://www.xiuzheng.com/#/recruit",
        officialChainEvidenceUrl: "https://www.xiuzheng.com/"
      },
      officialJsonFetch: {
        kind: "xiuzheng-job-list",
        endpointUrl: "https://www.xiuzheng.com/front/human-resource/job-list"
      }
    });
    expect(getPlanBySourceId(plans, "source-tongrentang-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.tongrentang.com/newsList/54/1.html"
      },
      table: {
        rowSelector: "a[href*='/menu54/newsDetail/']:contains('招聘')",
        pagination: {
          totalPagesPattern: "共\\s*(\\d+)\\s*页",
          pageUrlTemplate: "https://www.tongrentang.com/newsList/54/{page}.html",
          maxPages: 10
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-msd-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY"
      },
      workday: {
        tenant: "msd",
        site: "SearchJobs"
      }
    });
    expect(getPlanBySourceId(plans, "source-roche-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: "https://careers.roche.com/cn/zh/search-results",
        officialChainEvidenceUrl: "https://careers.roche.com/cn/zh/china-mainland"
      },
      officialJsonFetch: {
        kind: "phenom",
        detailBaseUrl: "https://careers.roche.com/cn/zh/job",
        allowedApplyOrigins: ["https://roche.wd3.myworkdayjobs.com"],
        facetScope: {
          countryIncludeDescriptor: "中国大陆",
          categoryExcludeDescriptors: ["实习 & 发展项目"]
        },
        pageSize: 50,
        maxPages: 10
      }
    });
    expect(getPlanBySourceId(plans, "source-roche-china-social")).not.toHaveProperty("workday");
    expect(getPlanBySourceId(plans, "source-biogen-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://biibhr.wd3.myworkdayjobs.com/external"
      },
      workday: {
        tenant: "biibhr",
        site: "external",
        searchText: "China"
      }
    });
    const workdaySocialBoundaries = new Map([
      ["source-johnson-innovative-medicine-social", ["Fixed Term Employee (Non-Intern) (Fixed Term)", "Regular"]],
      ["source-msd-china-social", ["Regular"]],
      ["source-pfizer-china-social", ["Regular"]],
      ["source-bms-china-social", ["Fixed Term (Fixed Term)", "Permanent"]],
      ["source-amgen-china-social", ["Regular"]],
      ["source-gilead-china-social", ["Regular"]],
      ["source-biogen-china-social", ["Regular"]]
    ] as const);
    for (const [sourceId, allowedDescriptors] of workdaySocialBoundaries) {
      expect(getPlanBySourceId(plans, sourceId)).toMatchObject({
        workday: {
          facetDescriptorBoundary: {
            facetParameter: "workerSubType",
            allowedDescriptors
          }
        }
      });
    }
    expect(getPlanBySourceId(plans, "source-merck-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON"
      },
      officialJsonFetch: {
        kind: "phenom",
        facetScope: {
          countryIncludeDescriptor: "China",
          exclusionFacet: {
            field: "jobLevelId",
            descriptors: ["A - Current Student", "B - Recent University Graduate(<1 year of experience)"]
          }
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-gsk-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: "https://jobs.gsk.com/cn/zh/search-results?keywords=China"
      },
      officialJsonFetch: {
        kind: "phenom",
        countryFilter: "China",
        pageSize: 50,
        allowedApplyOrigins: ["https://gsk.wd5.myworkdayjobs.com"]
      }
    });
    expect(getPlanBySourceId(plans, "source-lilly-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: "https://careers.lilly.com/us/en/search-results?keywords=China",
        officialChainEvidenceUrl: "https://careers.lilly.com/global/zh/china"
      },
      officialJsonFetch: {
        kind: "phenom",
        countryFilter: "China",
        pageSize: 50,
        maxPages: 10,
        allowedApplyOrigins: ["https://lilly.wd115.myworkdayjobs.com"]
      }
    });
    expect(getPlanBySourceId(plans, "source-organon-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: "https://jobs.organon.com/cn/zh/search-results?keywords=China"
      },
      officialJsonFetch: {
        kind: "phenom",
        countryFilter: "China",
        pageSize: 50,
        allowedApplyOrigins: ["https://organon.wd5.myworkdayjobs.com"]
      }
    });
    expect(getPlanBySourceId(plans, "source-ucb-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: "https://careers.ucb.com/global/en/search-results?qcountry=China"
      },
      officialJsonFetch: {
        kind: "phenom",
        facetScope: {
          countryIncludeDescriptor: "China",
          exclusionFacet: {
            field: "category",
            descriptors: ["Internships & Junior Positions"]
          }
        },
        allowOmittedOffsetForSinglePage: true,
        pageSize: 50
      }
    });

    expect(getPlanBySourceId(plans, "source-hengrui-social")?.source).toMatchObject({
      officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
      officialChainEvidenceUrl: "https://www.hengrui.com/development/joinUs.html"
    });
    expect(getPlanBySourceId(plans, "source-tianjin-pharma-social")?.source).toMatchObject({
      officialEntryUrl: "https://tjph.zhiye.com/social/jobs",
      officialChainEvidenceUrl: "https://www.pharm.com.cn/"
    });

    const plannedUrls = plans.flatMap((plan) => [
      plan.source.officialEntryUrl,
      plan.source.officialChainEvidenceUrl
    ]);
    expect(plannedUrls).not.toContain("https://careers.ucb.com/global/en/search-results?keywords=China");
    expect(plannedUrls).not.toContain("https://www.hengrui.com/development/recruit.html");
    expect(plannedUrls).not.toContain("https://tjph1.zhiye.com/social/jobs");
    expect(plannedUrls).not.toContain("https://www.pharm.com.cn/career/join.html");
    expect(plannedUrls).not.toContain("https://www.xhzy.com/XYZP/index.html");
    expect(getPlanBySourceId(plans, "source-qilu-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "BEISEN_ZHIYE",
        officialEntryUrl: "https://qilu-pharma.zhiye.com/social/jobs",
        officialChainEvidenceUrl: "https://www.qilu-pharma.com/JobPosting_list.html"
      },
      officialJsonFetch: {
        kind: "beisen-zhiye-2022",
        category: "1",
        pageSize: 100,
        maxPages: 5,
        detailPath: "social/detail"
      }
    });
    expect(getPlanBySourceId(plans, "source-3sbio-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "BEISEN_ZHIYE",
        officialEntryUrl: "https://3sbio.zhiye.com/social/jobs"
      },
      officialJsonFetch: {
        kind: "beisen-zhiye-2022",
        category: "1",
        pageSize: 100,
        maxPages: 5,
        detailPath: "social/detail"
      }
    });
    expect(getPlanBySourceId(plans, "source-cr-pharma-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "HOTJOB_WECRUIT",
        officialEntryUrl: "https://crc.wintalent.cn/wt/crpharma/web/index/social",
        officialChainEvidenceUrl: "https://www.crpharm.com/"
      },
      hotjobLegacy: {
        listUrl:
          "https://crc.wintalent.cn/wt/crpharma/web/json/position/list?operational=4319f781ebd22dcdc82a3d63a839b4e4480b851dc2aa80a7c13a4e46157692d92f30c07cd9fb7ca40e2238cb94dd7768650b5b2b62309867f9fbd8b3d7c3e118&positionType=0&comPart=&sicCorpCode=&brandCode=1&releaseTime=0&trademark=0&useForm=&recruitType=2&projectId=&lanType=1&positionName=&workPlace=&keyWord=&xuanJiangStr=&site=",
        suitePath: "wt/crpharma",
        paginationMode: "query-page",
        pageSize: 10,
        maxPages: 5
      }
    });
    expect(getPlanBySourceId(plans, "source-cspc-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl:
          "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/0beb3022-3214-4333-a2e7-20786c4916d5/officeWebsite.mob",
        officialChainEvidenceUrl: "https://www.cspc.cn/hr/index.html"
      },
      officialJsonFetch: {
        kind: "redsea-zp-channel",
        rootId: "cspc",
        channelQrIds: [
          "0beb3022-3214-4333-a2e7-20786c4916d5",
          "623d3b53-0d75-4649-8d4c-df366532fb58"
        ]
      }
    });
    expect(getPlanBySourceId(plans, "source-nhu-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "BEISEN_ZHIYE",
        officialEntryUrl: "https://xinhecheng1.zhiye.com/social/jobs",
        officialChainEvidenceUrl: "https://www.cnhu.com/careers/zh-cn"
      },
      officialJsonFetch: {
        kind: "beisen-zhiye-2022",
        category: "1",
        pageSize: 100,
        maxPages: 5,
        detailPath: "social/detail"
      }
    });
    expect(getPlanBySourceId(plans, "source-yangzijiang-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "BEISEN_ZHIYE",
        officialEntryUrl: "https://yangzijiang.zhiye.com/social/jobs",
        officialChainEvidenceUrl: "https://www.yangzijiang.com/Career"
      },
      officialJsonFetch: {
        kind: "beisen-zhiye-2022",
        category: "1",
        pageSize: 100,
        maxPages: 5,
        detailPath: "social/detail",
        defaultLocationRaw: "未披露"
      }
    });
    expect(getPlanBySourceId(plans, "source-viatris-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl:
          "https://careersite.tupu360.com/Viatris/position/index?recruitmentType=SOCIALRECRUITMENT",
        officialChainEvidenceUrl: "https://viatris.cn/careers"
      },
      table: {
        rowSelector: ".position-list-body .position-item",
        pagination: {
          ajaxMode: "tupu360",
          pageSearchParamMode: "offset",
          pageSize: 10,
          maxPages: 60
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-servier-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "MOKA",
        officialEntryUrl: "https://www.servier.com.cn/social-recruitment/shiweiya/47734"
      },
      moka: {
        expectedOrgId: "shiweiya",
        expectedSiteId: "47734",
        expectedMode: "social",
        campaignUrl: "https://app.mokahr.com/social-recruitment/shiweiya/47734",
        hydrateMissingLocationsFromDetail: true
      }
    });
    expect(getPlanBySourceId(plans, "source-takeda-china-social")).toMatchObject({
      adapterId: "html-table",
      table: {
        rowSelector: "#search-results-list li:has(button.js-save-job-btn)",
        pagination: {
          totalPagesSelector: "#search-results",
          totalPagesAttribute: "data-total-pages",
          expectedJobCountSelector: "#search-results",
          expectedJobCountAttribute: "data-total-job-results",
          ajaxMode: "talentbrew",
          talentbrewScope: {
            requiredActiveFacet: { id: "1814991", facetType: 2, descriptor: "China" },
            allowedPartitions: [
              { channelId: "career-commercial", id: "Commercial", facetType: 5,
                fieldName: "custom_fields.CategoryField", descriptor: "Commercial" },
              { channelId: "career-corporate-functions", id: "Corporate Functions", facetType: 5,
                fieldName: "custom_fields.CategoryField", descriptor: "Corporate Functions" },
              { channelId: "career-data-digital-technology", id: "Data, Digital & Technology", facetType: 5,
                fieldName: "custom_fields.CategoryField", descriptor: "Data, Digital & Technology" },
              { channelId: "career-manufacturing-supply", id: "Manufacturing & Supply", facetType: 5,
                fieldName: "custom_fields.CategoryField", descriptor: "Manufacturing & Supply" },
              { channelId: "career-quality", id: "Quality", facetType: 5,
                fieldName: "custom_fields.CategoryField", descriptor: "Quality" },
              { channelId: "career-research-development", id: "Research & Development", facetType: 5,
                fieldName: "custom_fields.CategoryField", descriptor: "Research & Development" }
            ]
          }
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-sanofi-china-social")).toMatchObject({
      adapterId: "html-table",
      table: { rowSelector: "#search-results-list li:has(button.js-save-job-btn)", pagination: { ajaxMode: "talentbrew", talentbrewScope: {
        requiredActiveFacet: { id: "1814991", facetType: 2, descriptor: "China" },
        allowedPartitions: [
          { channelId: "employment-fixed-term", id: "Fixed Term (Fixed Term)", facetType: 5,
            fieldName: "job_type", descriptor: "Fixed Term (Fixed Term)" },
          { channelId: "employment-regular", id: "Regular", facetType: 5,
            fieldName: "job_type", descriptor: "Regular" }
        ]
      } } }
    });
    expect(getPlanBySourceId(plans, "source-fosun-pharma-social")).toMatchObject({
      adapterId: "html-table",
      table: {
        pagination: {
          totalPagesSelector: "a[href*='PageIndex=']",
          totalPagesAttribute: "href",
          totalPagesPattern: "PageIndex=(\\d+)",
          totalPagesMode: "max",
          pageSearchParam: "PageIndex",
          maxPages: 20
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-kelun-social")).toMatchObject({
      adapterId: "html-table",
      table: {
        pagination: {
          totalPagesMode: "max",
          pageSearchParam: "PageIndex",
          maxPages: 20
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-boehringer-ingelheim-china-social")).toMatchObject({
      adapterId: "html-table",
      table: {
        pagination: {
          pageSearchParam: "startrow",
          pageSearchParamMode: "offset",
          pageSize: 25,
          expectedJobCountSelector: "#tile-search-results-label",
          expectedJobCountPattern: "of\\s+(\\d+)\\s+Jobs"
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-hansoh-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "BEISEN_ZHIYE",
        officialEntryUrl: "https://hspharm.zhiye.com/social",
        officialChainEvidenceUrl: "https://www.hansoh.cn/job/career-development.htm"
      },
      table: {
        pagination: {
          totalPagesMode: "max",
          pageSearchParam: "PageIndex",
          expectedJobCountPattern: "共\\s*(\\d+)\\s*条记录"
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-cttq-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "BEISEN_ZHIYE",
        officialEntryUrl: "https://cttq.zhiye.com/social/jobs",
        officialChainEvidenceUrl:
          "https://www.cttq.com/personnel/xiao-yuan-zhao-pin-list-0.htm"
      },
      officialJsonFetch: {
        kind: "beisen-zhiye-2022",
        category: "1",
        pageSize: 100,
        maxPages: 10,
        detailPath: "social/detail"
      }
    });
    expect(getPlanBySourceId(plans, "source-dongyangguang-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "BEISEN_ZHIYE",
        officialEntryUrl: "https://hec.zhiye.com/Social/jobs",
        officialChainEvidenceUrl: "https://www.hec.cn/"
      },
      officialJsonFetch: {
        kind: "beisen-zhiye-2022",
        category: "1",
        pageSize: 100,
        maxPages: 5,
        detailPath: "Social/detail"
      }
    });
    for (const candidatePlan of plans) {
      const config = candidatePlan.adapterId === "official-json"
        ? candidatePlan.officialJsonFetch
        : undefined;
      if (config?.kind === "beisen-zhiye-2022") {
        expect(config).toMatchObject({
          geographyScope: "DOMESTIC_OFFICIAL_TENANT"
        });
      }
    }
    expect(getPlanBySourceId(plans, "source-daiichi-sankyo-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: "https://daiichisankyo.cnstaff.com/recruit",
        officialChainEvidenceUrl: "https://www.daiichisankyo.com.cn/"
      },
      officialJsonFetch: {
        kind: "cnstaff",
        pageSize: 15,
        maxPages: 10
      }
    });
    expect(getPlanBySourceId(plans, "source-teva-china-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.careers.teva/careers?location=China",
        officialChainEvidenceUrl: "https://www.careers.teva/careers?location=China"
      },
      table: {
        pagination: {
          expectedJobCountSelector: "body",
          expectedJobCountPattern: "\"count\"\\s*:\\s*(\\d+)"
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-grifols-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: "https://grifols.jobs/locations/chn/jobs/",
        officialChainEvidenceUrl: "https://www.zh.grifolscn.com.cn/zh/careers"
      },
      officialJsonFetch: {
        kind: "jobsyn-solr",
        endpointUrl: "https://prod-search-api.jobsyn.org/api/v1/solr/search",
        siteOrigin: "grifols.jobs",
        location: "chn",
        pageSize: 9,
        maxPages: 5
      }
    });
    expect(getPlanBySourceId(plans, "source-csl-china-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://jobs.csl.com/en/jobs?filterrific%5Bwith_location3%5D=china",
        officialChainEvidenceUrl: "https://www.csl.com/careers"
      },
      table: {
        rowSelector: "a[href^='https://jobs.csl.com/en/jobs/']",
        pagination: {
          expectedJobCountSelector: "body",
          expectedJobCountPattern: "Showing\\s+\\d+\\s+to\\s+\\d+\\s+of\\s+(\\d+)\\s+results",
          pageSize: 25,
          maxPages: 5
        }
      }
    });
    expect(getPlanBySourceId(plans, "source-lunan-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: "https://hcm.lunan.com.cn/recruit",
        officialChainEvidenceUrl: "https://hcm.lunan.com.cn/recruit"
      },
      officialJsonFetch: {
        kind: "hcm-cloud",
        pageSize: 20,
        maxPages: 5,
        defaultLocationRaw: "未披露"
      }
    });
  });
});
