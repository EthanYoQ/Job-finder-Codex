import { createHash } from "node:crypto";
import {
  candidateCompanies,
  expectedOfficialSurfaces,
  hasUnresolvedSurfaceScope,
  type CandidateCompany,
  type CandidateRecruitmentSource,
  type ExpectedOfficialRecruitmentSurface,
  type ExpectedRecruitmentChannel
} from "../data/companyRegistry";
import {
  isUserAuthorizedPhase1Exclusion,
  USER_AUTHORIZED_PHASE1_EXCLUSION
} from "../data/phase1ScopePolicy";
import type { HtmlTableConfig, OfficialJsonConfig } from "./adapters/types";
import type { HotjobWecruitFetchConfig } from "./hotjobWecruitSourceFetch";
import type { HotjobLegacyFetchConfig } from "./hotjobLegacySourceFetch";
import type { OfficialJsonFetchConfig } from "./officialJsonSourceFetch";
import type { WorkdayFetchConfig } from "./workdaySourceFetch";

export type CrawlAdapterId = "official-json" | "html-table";

export type ExecutableExpectedChannel = Pick<ExpectedRecruitmentChannel, "channelId" | "kind">;
type SourcePlanPolicy = "DISCOVERY" | "STAGED" | "FULL_RELEASE";

export interface MokaFetchConfig {
  expectedOrgId: string;
  expectedSiteId: string;
  expectedMode: "social";
  campaignUrl: string;
  allowedEntryRedirect?: {
    origin: string;
    pathname: string;
  };
  hydrateMissingLocationsFromDetail?: boolean;
}

type PlannedCompany = Pick<CandidateCompany, "id" | "officialChineseName"> & { category?: CandidateCompany["category"] };
type PlannedSource = Required<
  Pick<
    CandidateRecruitmentSource,
    | "id"
    | "companyId"
    | "kind"
    | "atsKind"
    | "status"
    | "officialEntryUrl"
    | "officialChainEvidenceUrl"
  >
> & { surfaceId?: string };

export type SourceCrawlPlan = (
  | {
      adapterId: "official-json";
      company: PlannedCompany;
      source: PlannedSource;
      json: OfficialJsonConfig;
      officialJsonFetch?: OfficialJsonFetchConfig;
      workday?: WorkdayFetchConfig;
      hotjob?: HotjobWecruitFetchConfig;
      hotjobLegacy?: HotjobLegacyFetchConfig;
      moka?: MokaFetchConfig;
    }
  | {
      adapterId: "html-table";
      company: PlannedCompany;
      source: PlannedSource;
      table: HtmlTableConfig;
    }) & {
      executionAuthority?: "STAGED";
      expectedChannels?: readonly ExecutableExpectedChannel[];
      expectedChannelSetHash?: string;
    };

type RepresentativeSourceConfig = {
  formalEligibility?: "QUARANTINED_PENDING_TRUSTED_ORACLE";
} & (
  | {
      adapterId: "official-json";
      json: OfficialJsonConfig;
      officialJsonFetch?: OfficialJsonFetchConfig;
      workday?: WorkdayFetchConfig;
      hotjob?: HotjobWecruitFetchConfig;
      hotjobLegacy?: HotjobLegacyFetchConfig;
      moka?: MokaFetchConfig;
    }
  | {
      adapterId: "html-table";
      table: HtmlTableConfig;
    }
);

const MOKA_JSON_CONFIG: OfficialJsonConfig = {
  jobsPath: "data.jobs",
  fields: {
    sourceJobId: "id",
    officialTitle: "title",
    officialUrl: "officialUrl",
    locationRaw: "locationRaw",
    cities: "cities"
  },
  defaultCategory: "其他"
};

const WORKDAY_JSON_CONFIG: OfficialJsonConfig = {
  jobsPath: "jobPostings",
  fields: {
    sourceJobId: "sourceJobId",
    officialTitle: "title",
    officialUrl: "officialUrl",
    locationRaw: "locationRaw",
    cities: "cities"
  },
  defaultCategory: "其他"
};

const HOTJOB_WECRUIT_JSON_CONFIG: OfficialJsonConfig = {
  jobsPath: "jobs",
  fields: {
    sourceJobId: "sourceJobId",
    officialTitle: "title",
    officialUrl: "officialUrl",
    locationRaw: "locationRaw"
  },
  defaultCategory: "其他"
};

const OFFICIAL_API_JSON_CONFIG: OfficialJsonConfig = {
  jobsPath: "jobs",
  fields: {
    sourceJobId: "sourceJobId",
    officialTitle: "title",
    officialUrl: "officialUrl",
    locationRaw: "locationRaw",
    cities: "cities"
  },
  defaultCategory: "其他"
};

const CHROME_LIKE_HTML_REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
} satisfies Record<string, string>;

const JNJ_INNOVATIVE_MEDICINE_JOB_FAMILY_GROUPS = [
  "604dc786859810010c32535ce4950000", // Pharmaceutical Sales
  "604dc786859810010c3230da4ca90000", // Market Access
  "604dc786859810010c3241cd1fbe0000", // Medical Affairs Group
  "604dc786859810010c31feafcd920000", // Discovery & Pre-Clinical/Clinical Development
  "604dc786859810010c3277a8e7e80000", // R&D Operations
  "604dc786859810010c3292e41b5d0000" // Regulatory Affairs Group
] as const;

const REPRESENTATIVE_CONFIGS: Record<string, RepresentativeSourceConfig> = {
  "source-johnson-innovative-medicine-social": {
    formalEligibility: "QUARANTINED_PENDING_TRUSTED_ORACLE",
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "jj",
      site: "JJ",
      searchText: "China",
      appliedFacets: {
        jobFamilyGroup: JNJ_INNOVATIVE_MEDICINE_JOB_FAMILY_GROUPS
      },
      facetDescriptorBoundary: {
        facetParameter: "workerSubType",
        allowedDescriptors: ["Fixed Term Employee (Non-Intern) (Fixed Term)", "Regular"]
      },
      pageSize: 20,
      maxPages: 5
    }
  },
  "source-astellas-china-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "a[href$='.pdf'][href*='/global/zh/']",
      pagination: {
        totalPagesSelector: "body",
        totalPagesAttribute: "data-total-pages",
        pageSearchParam: "page",
        maxPages: 1,
        expectedJobCountSelector: "a[href$='.pdf'][href*='/global/zh/']"
      },
      fields: {
        sourceJobId: {
          selector: ":scope",
          attribute: "href",
          pattern: "/([^/]+)\\.pdf$"
        },
        officialTitle: { selector: ":scope" },
        officialUrl: { selector: ":scope", attribute: "href" },
        locationRaw: { value: "中国" }
      },
      defaultCategory: "其他",
      requestHeaders: CHROME_LIKE_HTML_REQUEST_HEADERS
    }
  },
  "source-otsuka-china-social-2": {
    adapterId: "html-table",
    table: {
      rowSelector: ".join-list > .join-item",
      staticPublicList: {
        containerSelector: ".join-list",
        nextControlSelector: ".join-list .pagination, .join-list a[rel='next'], .join-list [data-page]"
      },
      fields: {
        sourceJobIdParts: [
          { selector: ".table-td .career-title" },
          { selector: ".table-td .col2" }
        ],
        officialTitle: { selector: ".table-td .career-title" },
        officialUrl: { value: "https://www.otsuka.com.cn/join-us/index.html" },
        locationRaw: { selector: ".table-td .col2" }
      }
    }
  },
  "source-astrazeneca-social": {
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
      },
      fields: {
        officialTitle: { selector: "a.search-results-link h2" },
        officialUrl: { selector: "a.search-results-link", attribute: "href" },
        locationRaw: { selector: "span.job-location" }
      }
    }
  },
  "source-abbvie-china-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".attrax-vacancy-tile",
      pagination: {
        totalPagesSelector: ".attrax-pagination__results-of--2",
        totalPagesAttribute: "data-total-pages",
        totalPagesPattern: "(\\d+)",
        pageSearchParam: "page",
        maxPages: 10,
        expectedJobCountSelector: ".attrax-pagination__total-results",
        expectedJobCountPattern: "(\\d+)"
      },
      fields: {
        sourceJobId: {
          selector: ".attrax-vacancy-tile__title",
          attribute: "href",
          pattern: "jid-(\\d+)"
        },
        officialTitle: { selector: ".attrax-vacancy-tile__title" },
        officialUrl: {
          selector: ".attrax-vacancy-tile__title",
          attribute: "href"
        },
        locationRaw: {
          selector: ".attrax-vacancy-tile__location-freetext .attrax-vacancy-tile__item-value"
        }
      }
    }
  },
  "source-novartis-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "table.views-table tbody tr",
      pagination: {
        totalPagesSelector: ".pagination a[title*='out of']",
        totalPagesAttribute: "title",
        totalPagesPattern: "out of\\s+(\\d+)\\s+pages",
        pageSearchParam: "page",
        pageNumberOffset: -1,
        maxPages: 10
      },
      fields: {
        officialTitle: { selector: "td.views-field-field-job-title a" },
        officialUrl: {
          selector: "td.views-field-field-job-title a",
          attribute: "href"
        },
        locationRaw: { selector: "td.views-field-field-job-work-location" }
      }
    }
  },
  "source-fosun-pharma-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "table tr",
      pagination: {
        totalPagesSelector: "a[href*='PageIndex=']",
        totalPagesAttribute: "href",
        totalPagesPattern: "PageIndex=(\\d+)",
        totalPagesMode: "max",
        pageSearchParam: "PageIndex",
        maxPages: 20
      },
      fields: {
        officialTitle: { selector: "td:nth-child(1) a" },
        officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
        locationRaw: { selector: "td:nth-child(4) a" }
      }
    }
  },
  "source-qilu-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail"
    }
  },
  "source-cr-pharma-social": {
    adapterId: "official-json",
    json: HOTJOB_WECRUIT_JSON_CONFIG,
    hotjobLegacy: {
      listUrl:
        "https://crc.wintalent.cn/wt/crpharma/web/json/position/list?operational=4319f781ebd22dcdc82a3d63a839b4e4480b851dc2aa80a7c13a4e46157692d92f30c07cd9fb7ca40e2238cb94dd7768650b5b2b62309867f9fbd8b3d7c3e118&positionType=0&comPart=&sicCorpCode=&brandCode=1&releaseTime=0&trademark=0&useForm=&recruitType=2&projectId=&lanType=1&positionName=&workPlace=&keyWord=&xuanJiangStr=&site=",
      suitePath: "wt/crpharma",
      paginationMode: "query-page",
      pageSize: 10,
      maxPages: 5
    }
  },
  "source-beigene-social": {
    adapterId: "official-json",
    json: MOKA_JSON_CONFIG
  },
  "source-pfizer-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "pfizer",
      site: "PfizerCareers",
      appliedFacets: {
        Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"]
      },
      facetDescriptorBoundary: {
        facetParameter: "workerSubType",
        allowedDescriptors: ["Regular"]
      },
      pageSize: 20,
      maxPages: 10
    }
  },
  "source-haleon-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "gsknch",
      site: "GSKCareers",
      appliedFacets: {
        location: [
          "03fe97f04c9a01333d3739eea7577455",
          "03fe97f04c9a01ebc5af2deea7576a55",
          "15dc3becd679105e714122093995f79f",
          "b5196703399c0188e29d0aedaf53abef"
        ]
      },
      pageSize: 20,
      maxPages: 5,
      cityHints: {
        "SHANGHAI QIANTAN PLAZA": ["上海"],
        "Suzhou Plant Tech Industry Park": ["苏州"]
      }
    }
  },
  "source-gsk-china-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "phenom",
      detailBaseUrl: "https://jobs.gsk.com/cn/zh/job",
      countryFilter: "China",
      allowedApplyOrigins: ["https://gsk.wd5.myworkdayjobs.com"],
      pageSize: 50,
      maxPages: 3
    }
  },
  "source-roche-china-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
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
  },
  "source-msd-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "msd",
      site: "SearchJobs",
      searchText: "China",
      facetDescriptorBoundary: {
        facetParameter: "workerSubType",
        allowedDescriptors: ["Regular"]
      },
      pageSize: 20,
      maxPages: 10
    }
  },
  "source-bms-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "bristolmyerssquibb",
      site: "BMS",
      searchText: "China",
      facetDescriptorBoundary: {
        facetParameter: "workerSubType",
        allowedDescriptors: ["Fixed Term (Fixed Term)", "Permanent"]
      },
      pageSize: 20,
      maxPages: 5
    }
  },
  "source-gilead-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "gilead",
      site: "gileadcareers",
      searchText: "China",
      facetDescriptorBoundary: {
        facetParameter: "workerSubType",
        allowedDescriptors: ["Regular"]
      },
      pageSize: 20,
      maxPages: 3
    }
  },
  "source-agilent-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "agilent",
      site: "Agilent_Careers",
      searchText: "China",
      pageSize: 20,
      maxPages: 5
    }
  },
  "source-abbott-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "abbott",
      site: "abbottcareers",
      searchText: "China",
      pageSize: 20,
      maxPages: 5
    }
  },
  "source-stryker-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "stryker",
      site: "StrykerCareers",
      searchText: "China",
      pageSize: 20,
      maxPages: 5
    }
  },
  "source-gehc-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "gehc",
      site: "gehc_externalsite",
      searchText: "China",
      pageSize: 20,
      maxPages: 5
    }
  },
  "source-edwards-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "edwards",
      site: "edwardscareers",
      searchText: "China",
      pageSize: 20,
      maxPages: 5
    }
  },
  "source-medtronic-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "medtronic",
      site: "MedtronicCareers",
      searchText: "China",
      pageSize: 20,
      maxPages: 5
    }
  },
  "source-kenvue-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "kenvue",
      site: "kenvue",
      appliedFacets: {
        locationCountry: ["6cb77610a8a543aea2d6bc10457e35d4"]
      },
      pageSize: 20,
      maxPages: 2
    }
  },
  "source-amgen-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "amgen",
      site: "Careers",
      appliedFacets: {
        LocationCountry: ["6cb77610a8a543aea2d6bc10457e35d4"]
      },
      facetDescriptorBoundary: {
        facetParameter: "workerSubType",
        allowedDescriptors: ["Regular"]
      },
      pageSize: 20,
      maxPages: 3
    }
  },
  "source-biogen-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "biibhr",
      site: "external",
      searchText: "China",
      facetDescriptorBoundary: {
        facetParameter: "workerSubType",
        allowedDescriptors: ["Regular"]
      },
      pageSize: 20,
      maxPages: 3
    }
  },
  "source-simcere-social": {
    adapterId: "official-json",
    json: HOTJOB_WECRUIT_JSON_CONFIG,
    hotjob: {
      suiteKey: "SU61458d83bef57c54dcb4e43f",
      pageSize: 20,
      maxPages: 25
    }
  },
  "source-haisco-social": {
    adapterId: "official-json",
    json: HOTJOB_WECRUIT_JSON_CONFIG,
    hotjob: {
      suiteKey: "SU6663b85a1eb8051cd22556e3",
      pageSize: 20,
      maxPages: 10
    }
  },
  "source-cr-sanjiu-social": {
    adapterId: "official-json",
    json: HOTJOB_WECRUIT_JSON_CONFIG,
    hotjob: {
      suiteKey: "SU613834ecbef57c3b6383b50e",
      pageSize: 20,
      maxPages: 20
    }
  },
  "source-jichuan-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail"
    }
  },
  "source-cms-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail",
      defaultLocationRaw: "未披露"
    }
  },
  "source-kanghong-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail"
    }
  },
  "source-yiling-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail"
    }
  },
  "source-innocare-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail"
    }
  },
  "source-henlius-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail"
    }
  },
  "source-better-pharma-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail"
    }
  },
  "source-hengrui-social": {
    adapterId: "official-json",
    json: MOKA_JSON_CONFIG,
    moka: {
      expectedOrgId: "hengrui",
      expectedSiteId: "145996",
      expectedMode: "social",
      campaignUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996",
      hydrateMissingLocationsFromDetail: true
    }
  },
  "source-jimin-kexin-social": {
    adapterId: "official-json",
    json: MOKA_JSON_CONFIG,
    moka: {
      expectedOrgId: "jemincare",
      expectedSiteId: "78315",
      expectedMode: "social",
      campaignUrl: "https://app.mokahr.com/social-recruitment/jemincare/78315",
      hydrateMissingLocationsFromDetail: true
    }
  },
  "source-united-lab-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail"
    }
  },
  "source-3sbio-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail"
    }
  },
  "source-tianjin-pharma-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail"
    }
  },
  "source-cttq-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 10,
      detailPath: "social/detail"
    }
  },
  "source-bayer-healthcare-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "#searchresults tbody tr",
      pagination: {
        totalPagesSelector: ".pagination-current",
        totalPagesAttribute: "max",
        pageSearchParam: "page",
        maxPages: 1,
        expectedJobCountSelector: ".paginationLabel",
        expectedJobCountPattern: "\\/\\s*(\\d+)"
      },
      fields: {
        officialTitle: { selector: ".jobTitle.hidden-phone a.jobTitle-link" },
        officialUrl: {
          selector: ".jobTitle.hidden-phone a.jobTitle-link",
          attribute: "href"
        },
        locationRaw: { selector: "td.colLocation" }
      }
    }
  },
  "source-takeda-china-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "#search-results-list li:has(button.js-save-job-btn)",
      pagination: {
        totalPagesSelector: "#search-results",
        totalPagesAttribute: "data-total-pages",
        pageSearchParam: "page",
        maxPages: 30,
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
      },
      fields: {
        sourceJobId: { selector: "button.js-save-job-btn", attribute: "data-job-id" },
        officialTitle: { selector: "h2.title" },
        officialUrl: { selector: "a[href*='/job/']", attribute: "href" },
        locationRaw: { selector: ".location" }
      }
    }
  },
  "source-zaiding-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".space-y-2 > .bg-white",
      fields: {
        sourceJobId: {
          selector: "zai-button",
          attribute: ":link",
          pattern: "jobs/(\\d+)/"
        },
        officialTitle: { selector: ".font-bold.text-black.text-xl" },
        officialUrl: {
          selector: "zai-button",
          attribute: ":link",
          pattern: "url:\\s*'([^']+)'"
        },
        locationRaw: { selector: ".font-normal.mt-2" }
      }
    }
  },
  "source-kelun-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".jobsTable tr:not(.title)",
      pagination: {
        totalPagesSelector: "a[href*='PageIndex=']",
        totalPagesAttribute: "href",
        totalPagesPattern: "PageIndex=(\\d+)",
        totalPagesMode: "max",
        pageSearchParam: "PageIndex",
        maxPages: 20
      },
      fields: {
        officialTitle: { selector: "td:nth-child(1) a" },
        officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
        locationRaw: { selector: "td:nth-child(5)" }
      }
    }
  },
  "source-beta-pharma-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "tr.showjob",
      pagination: {
        totalPagesSelector: "body",
        totalPagesAttribute: "data-total-pages",
        totalPagesPattern: "当前第\\d+\\/(\\d+)页",
        pageSearchParam: "page",
        pageUrlTemplate: "https://www.bettapharma.com/Jobs/index/page/{page}",
        maxPages: 5,
        expectedJobCountSelector: "body",
        expectedJobCountPattern: "共\\s*(\\d+)\\s*条记录"
      },
      fields: {
        sourceJobId: { selector: "td:nth-child(1) .tdb" },
        officialTitle: { selector: "td:nth-child(1) .tdb" },
        officialUrl: { value: "https://www.bettapharma.com/Jobs/" },
        locationRaw: { selector: "td:nth-child(5)" }
      }
    }
  },
  "source-allist-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".jobsTable tr:not(.title)",
      fields: {
        officialTitle: { selector: "td:nth-child(1) a" },
        officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
        locationRaw: { selector: "td:nth-child(3)" }
      }
    }
  },
  "source-hansoh-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".jobsTable tr:not(.title)",
      pagination: {
        totalPagesSelector: "a[href*='PageIndex=']",
        totalPagesAttribute: "href",
        totalPagesPattern: "PageIndex=(\\d+)",
        totalPagesMode: "max",
        pageSearchParam: "PageIndex",
        maxPages: 60,
        expectedJobCountSelector: "body",
        expectedJobCountPattern: "共\\s*(\\d+)\\s*条记录"
      },
      fields: {
        officialTitle: { selector: "td:nth-child(1) a" },
        officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
        locationRaw: { selector: "td:nth-child(3)" }
      }
    }
  },
  "source-nhu-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail"
    }
  },
  "source-yangzijiang-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail",
      defaultLocationRaw: "未披露"
    }
  },
  "source-viatris-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".position-list-body .position-item",
      pagination: {
        totalPagesSelector: "#pageTurnUl li:first-child",
        totalPagesAttribute: "data-total-pages",
        pageSearchParam: "offset",
        pageSearchParamMode: "offset",
        pageSize: 10,
        maxPages: 60,
        ajaxMode: "tupu360"
      },
      fields: {
        sourceJobId: {
          selector: ".e-title a",
          attribute: "href",
          pattern: "positionId=([^&]+)"
        },
        officialTitle: { selector: ".e-title a" },
        officialUrl: { selector: ".e-title a", attribute: "href" },
        locationRaw: { selector: ".e-city" }
      }
    }
  },
  "source-servier-china-social": {
    adapterId: "official-json",
    json: MOKA_JSON_CONFIG,
    moka: {
      expectedOrgId: "shiweiya",
      expectedSiteId: "47734",
      expectedMode: "social",
      campaignUrl: "https://app.mokahr.com/social-recruitment/shiweiya/47734",
      allowedEntryRedirect: {
        origin: "https://app.mokahr.com",
        pathname: "/social-recruitment/shiweiya/47734"
      },
      hydrateMissingLocationsFromDetail: true
    }
  },
  "source-kelun-biotech-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "tr:has(.jname a)",
      fields: {
        officialTitle: { selector: ".jname a" },
        officialUrl: { selector: ".jname a", attribute: "href" },
        locationRaw: { selector: ".jcity", attribute: "title" }
      }
    }
  },
  "source-kpc-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".JobList-J1 li:not(.first)",
      fields: {
        officialTitle: { selector: "._t1" },
        officialUrl: { selector: "a", attribute: "href" },
        locationRaw: { selector: "._t4" }
      }
    }
  },
  "source-mabwell-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail"
    }
  },
  "source-akeso-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "a.job-card",
      fields: {
        officialTitle: { selector: "h3" },
        officialUrl: { selector: ":scope", attribute: "href" },
        locationRaw: { selector: ":scope", attribute: "data-location" }
      }
    }
  },
  "source-sanofi-china-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "#search-results-list li:has(button.js-save-job-btn)",
      pagination: {
        totalPagesSelector: "#search-results",
        totalPagesAttribute: "data-total-pages",
        pageSearchParam: "page",
        pageUrlTemplate: "https://jobs.sanofi.com/en/location/china-jobs/2649/1814991/2/{page}",
        maxPages: 25,
        expectedJobCountSelector: "#search-results",
        expectedJobCountAttribute: "data-total-job-results",
        ajaxMode: "talentbrew",
        talentbrewScope: {
          requiredActiveFacet: { id: "1814991", facetType: 2, descriptor: "China" },
          allowedPartitions: [
            { channelId: "employment-fixed-term", id: "Fixed Term (Fixed Term)", facetType: 5,
              fieldName: "job_type", descriptor: "Fixed Term (Fixed Term)" },
            { channelId: "employment-regular", id: "Regular", facetType: 5,
              fieldName: "job_type", descriptor: "Regular" }
          ]
        }
      },
      fields: {
        sourceJobId: { selector: "button.js-save-job-btn", attribute: "data-job-id" },
        officialTitle: { selector: "h2" },
        officialUrl: { selector: "a[href*='/job/']", attribute: "href" },
        locationRaw: { selector: "span.job-location" }
      }
    }
  },
  "source-cstone-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "li.wow.slideInUp",
      fields: {
        sourceJobId: { selector: "a", attribute: "href" },
        officialTitle: { selector: ".txt em" },
        officialUrl: { selector: "a", attribute: "href" },
        locationRaw: { selector: ".txt span:nth-of-type(2)" }
      }
    }
  },
  "source-rcbio-social": {
    adapterId: "official-json",
    json: MOKA_JSON_CONFIG
  },
  "source-innovent-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "innovent",
      endpointUrl: "https://www.innoventbio.com/api/jobs?limit=200"
    }
  },
  "source-daiichi-sankyo-china-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "cnstaff",
      pageSize: 15,
      maxPages: 10
    }
  },
  "source-teva-china-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".position, .job-card, [data-testid='job-card']",
      pagination: {
        totalPagesSelector: "body",
        totalPagesAttribute: "data-total-pages",
        pageSearchParam: "location",
        maxPages: 1,
        expectedJobCountSelector: "body",
        expectedJobCountPattern: "\"count\"\\s*:\\s*(\\d+)"
      },
      fields: {
        sourceJobId: { selector: "a", attribute: "href" },
        officialTitle: { selector: "a" },
        officialUrl: { selector: "a", attribute: "href" },
        locationRaw: { value: "China" }
      }
    }
  },
  "source-grifols-china-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "jobsyn-solr",
      endpointUrl: "https://prod-search-api.jobsyn.org/api/v1/solr/search",
      siteOrigin: "grifols.jobs",
      location: "chn",
      pageSize: 9,
      maxPages: 5,
      detailBaseUrl: "https://grifols.jobs"
    }
  },
  "source-csl-china-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "a[href^='https://jobs.csl.com/en/jobs/']",
      pagination: {
        totalPagesSelector: "body",
        totalPagesAttribute: "data-total-pages",
        pageSearchParam: "page",
        pageSize: 25,
        maxPages: 5,
        expectedJobCountSelector: "body",
        expectedJobCountPattern: "Showing\\s+\\d+\\s+to\\s+\\d+\\s+of\\s+(\\d+)\\s+results"
      },
      fields: {
        sourceJobId: {
          selector: ":scope",
          attribute: "href"
        },
        officialTitle: { selector: "p.text-18" },
        officialUrl: { selector: ":scope", attribute: "href" },
        locationRaw: { selector: "p:has(svg[aria-hidden='true'])" }
      }
    }
  },
  "source-sandoz-china-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "sandoz-jsonapi",
      endpointUrl: "https://sandoz-com.cms.sandoz.com/jsonapi/views/job_search/job_search",
      countryTermName: "LOC_CN",
      pageSize: 10,
      maxPages: 50,
      detailBaseUrl: "https://www.sandoz.com"
    }
  },
  "source-lilly-china-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "phenom",
      detailBaseUrl: "https://careers.lilly.com/us/en/job",
      countryFilter: "China",
      allowedApplyOrigins: ["https://lilly.wd115.myworkdayjobs.com"],
      pageSize: 50,
      maxPages: 10
    }
  },
  "source-cspc-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "redsea-zp-channel",
      rootId: "cspc",
      channelQrIds: [
        "0beb3022-3214-4333-a2e7-20786c4916d5",
        "623d3b53-0d75-4649-8d4c-df366532fb58"
      ]
    }
  },
  "source-novo-nordisk-china-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "novo-nordisk",
      endpointUrl:
        "https://www.novonordisk.com/bin/nncorp/careersearch?keyword=&country=China%20Mainland&category=&locale=en"
    }
  },
  "source-boehringer-ingelheim-china-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "#job-tile-list li.job-tile",
      pagination: {
        totalPagesSelector: "#tile-search-results-label",
        totalPagesAttribute: "data-total-pages",
        pageSearchParam: "startrow",
        pageSearchParamMode: "offset",
        pageSize: 25,
        maxPages: 10,
        expectedJobCountSelector: "#tile-search-results-label",
        expectedJobCountPattern: "of\\s+(\\d+)\\s+Jobs"
      },
      fields: {
        officialTitle: { selector: ".jobTitle-link" },
        officialUrl: { selector: ".jobTitle-link", attribute: "href" },
        locationRaw: { selector: '.section-field.location div[id$="-value"]' }
      }
    }
  },
  "source-merck-china-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "phenom",
      detailBaseUrl: "https://careers.emdgroup.com/us/en/job",
      facetScope: {
        countryIncludeDescriptor: "China",
        exclusionFacet: {
          field: "jobLevelId",
          descriptors: [
            "A - Current Student",
            "B - Recent University Graduate(<1 year of experience)"
          ]
        }
      },
      pageSize: 50,
      maxPages: 10
    }
  },
  "source-organon-china-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "phenom",
      detailBaseUrl: "https://jobs.organon.com/cn/zh/job",
      countryFilter: "China",
      allowedApplyOrigins: ["https://organon.wd5.myworkdayjobs.com"],
      pageSize: 50,
      maxPages: 5
    }
  },
  "source-ucb-china-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "phenom",
      detailBaseUrl: "https://careers.ucb.com/global/en/job",
      facetScope: {
        countryIncludeDescriptor: "China",
        exclusionFacet: {
          field: "category",
          descriptors: ["Internships & Junior Positions"]
        }
      },
      allowOmittedOffsetForSinglePage: true,
      pageSize: 50,
      maxPages: 5
    }
  },
  "source-thermo-fisher-china-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "phenom",
      detailBaseUrl: "https://jobs.thermofisher.com/global/en/job"
    }
  },
  "source-jacobio-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".job-list",
      pagination: {
        totalPagesSelector: ".title-region h3",
        totalPagesAttribute: "data-total-pages",
        pageSearchParam: "page",
        maxPages: 1,
        expectedJobCountSelector: ".title-region h3",
        expectedJobCountPattern: "目前共有\\s*(\\d+)\\s*个招聘职位"
      },
      fields: {
        sourceJobId: {
          selector: "h2 a",
          attribute: "href",
          pattern: "/career/(\\d+)"
        },
        officialTitle: { selector: "h2 a" },
        officialUrl: { selector: "h2 a", attribute: "href" },
        locationRaw: { value: "中国" }
      },
      defaultCategory: "其他",
      requestHeaders: CHROME_LIKE_HTML_REQUEST_HEADERS
    }
  },
  "source-grand-pharma-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".job-card:has(a[href='#login'])",
      staticPublicList: {
        containerSelector: ".job-list",
        nextControlSelector: ".job-list .pagination, .job-list a[rel='next'], .job-list [data-page]",
        excludedPartitionSelectors: [".job-card:has(a[href='schooldetail.html'])"]
      },
      fields: {
        sourceJobIdParts: [
          { selector: ".job-title" },
          { selector: ".job-meta span:nth-child(1)" }
        ],
        officialTitle: { selector: ".job-title" },
        officialUrl: { value: "https://job.grandpharma.cn/" },
        locationRaw: { selector: ".job-meta span:nth-child(1)" }
      }
    }
  },
  "source-xiuzheng-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "xiuzheng-job-list",
      endpointUrl: "https://www.xiuzheng.com/front/human-resource/job-list",
      detailBaseUrl: "https://www.xiuzheng.com/#/recruitDetail",
      pageSize: 10,
      maxPages: 5
    }
  },
  "source-joincare-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".job_item",
      fields: {
        sourceJobId: { selector: ".e_text-16" },
        officialTitle: { selector: ".e_text-16" },
        officialUrl: { value: "https://www.joincare.com/Social_recruitment.html" },
        locationRaw: { selector: ".cbox-13-2" }
      }
    }
  },
  "source-apeloa-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".join2 .tab-content > .main:first-child > .ev",
      staticPublicList: {
        containerSelector: ".join2 .tab-content > .main:first-child",
        nextControlSelector: ".join2 .pagination, .join2 a[rel='next'], .join2 [data-page]",
        excludedPartitionSelectors: [".join2 .tab-content > .main:nth-child(2)"]
      },
      fields: {
        sourceJobIdParts: [
          { selector: ".table99.name > div:nth-child(1) > p" },
          { selector: ".table99.name > div:nth-child(4) > p" },
          { selector: ".down .mailto:first-of-type p" }
        ],
        officialTitle: { selector: ".table99.name > div:nth-child(1) > p" },
        officialUrl: { value: "https://www.apeloa.com/join.html" },
        locationRaw: { selector: ".table99.name > div:nth-child(4) > p" }
      }
    }
  },
  "source-hisun-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".job_list li",
      fields: {
        sourceJobId: { selector: "a", attribute: "id" },
        officialTitle: { selector: ".job_name" },
        officialUrl: { value: "https://www.hisunpharm.com/main/recruit-list.thtml?cId=10982" },
        locationRaw: { selector: ".job_place" }
      }
    }
  },
  "source-huahai-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "tr.tr_title",
      staticPublicList: {
        containerSelector: "table:has(tr.tr_title)",
        nextControlSelector: "table:has(tr.tr_title) .pagination, table:has(tr.tr_title) a[rel='next'], table:has(tr.tr_title) [data-page]"
      },
      fields: {
        sourceJobIdParts: [
          { selector: "td:nth-child(1)" },
          { selector: "td:nth-child(2)" },
          { selector: "td:nth-child(5)" }
        ],
        officialTitle: { selector: "td:nth-child(1)" },
        officialUrl: { value: "https://www.huahaipharm.com/zpgw.html" },
        locationRaw: { selector: "td:nth-child(2)" }
      }
    }
  },
  "source-tongrentang-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "a[href*='/menu54/newsDetail/']:contains('招聘')",
      pagination: {
        totalPagesSelector: "body",
        totalPagesAttribute: "data-total-pages",
        totalPagesPattern: "共\\s*(\\d+)\\s*页",
        pageSearchParam: "page",
        pageUrlTemplate: "https://www.tongrentang.com/newsList/54/{page}.html",
        maxPages: 10
      },
      fields: {
        sourceJobId: {
          selector: ":scope",
          attribute: "href",
          pattern: "newsDetail/([^./]+)"
        },
        officialTitle: { selector: ":scope" },
        officialUrl: { selector: ":scope", attribute: "href" },
        locationRaw: { value: "未披露" }
      }
    }
  },
  "source-lunan-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "hcm-cloud",
      pageSize: 20,
      maxPages: 5,
      defaultLocationRaw: "未披露"
    }
  },
  "source-alphamab-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".s_job > ul > li",
      fields: {
        sourceJobId: { selector: ".title h2" },
        officialTitle: { selector: ".title h2" },
        officialUrl: { value: "https://www.alphamabonc.com/career/job.html" },
        locationRaw: { selector: ".title h3" }
      }
    }
  },
  "source-ascentage-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "social/detail"
    }
  },
  "source-nhwa-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "._jt",
      fields: {
        sourceJobId: { selector: ".job_name" },
        officialTitle: { selector: ".job_name" },
        officialUrl: { value: "https://www.nhwa-group.com/job/ren-cai-zhao-pin-list-0.htm" },
        locationRaw: { selector: ".job_add" }
      }
    }
  },
  "source-dongyangguang-social": {
    adapterId: "official-json",
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      category: "1",
      pageSize: 100,
      maxPages: 5,
      detailPath: "Social/detail"
    }
  }
};

export function buildSourceCrawlPlans(
  companies: readonly CandidateCompany[],
  surfaces: readonly ExpectedOfficialRecruitmentSurface[] = expectedOfficialSurfaces
): SourceCrawlPlan[] {
  return buildPlans(companies, surfaces, "FULL_RELEASE");
}

export function buildStagedSourceCrawlPlans(
  companies: readonly CandidateCompany[],
  surfaces: readonly ExpectedOfficialRecruitmentSurface[] = expectedOfficialSurfaces
): SourceCrawlPlan[] {
  return buildPlans(companies, surfaces, "STAGED");
}

export function buildDiscoverySourcePlanCandidates(
  companies: readonly CandidateCompany[],
  surfaces: readonly ExpectedOfficialRecruitmentSurface[] = expectedOfficialSurfaces
): SourceCrawlPlan[] {
  return buildPlans(companies, surfaces, "DISCOVERY");
}

function buildPlans(
  companies: readonly CandidateCompany[],
  surfaces: readonly ExpectedOfficialRecruitmentSurface[],
  policy: SourcePlanPolicy
): SourceCrawlPlan[] {
  const fullRelease = policy === "FULL_RELEASE";
  const oracleBySurfaceId = new Map(surfaces.map((surface) => [surface.surfaceId, surface]));
  return companies.flatMap((company) =>
    isUserAuthorizedPhase1Exclusion(company.id) || company.targetStatus === USER_AUTHORIZED_PHASE1_EXCLUSION
      ? []
      :
    company.sources.flatMap((source): SourceCrawlPlan[] => {
      if (
        source.kind !== "SOCIAL" ||
        source.status !== "VERIFIED_SCRAPABLE" ||
        !source.officialEntryUrl ||
        !source.officialChainEvidenceUrl
      ) {
        return [];
      }

      const config = REPRESENTATIVE_CONFIGS[source.id];
      const surface = source.surfaceId ? oracleBySurfaceId.get(source.surfaceId) : undefined;
      if (
        !config ||
        (policy === "STAGED" && !hasCanonicalStagedAuthority(company, source, surface)) ||
        (fullRelease && config.formalEligibility === "QUARANTINED_PENDING_TRUSTED_ORACLE") ||
        !surface ||
        surface.companyId !== company.id ||
        surface.kind !== "SOCIAL" ||
        surface.status !== "INCLUDED" ||
        (fullRelease && surface.oracleStatus !== "INDEPENDENTLY_VERIFIED") ||
        (fullRelease && hasUnresolvedSurfaceScope(surface)) ||
        surface.officialEntryUrl !== source.officialEntryUrl ||
        !surface.officialChainEvidenceUrls.includes(source.officialChainEvidenceUrl) ||
        surface.adapterId !== config.adapterId
      ) {
        return [];
      }

      const plannedCompany: PlannedCompany = {
        id: company.id,
        officialChineseName: company.officialChineseName,
        category: company.category
      };
      const plannedSource: PlannedSource = {
        id: source.id,
        ...(source.surfaceId ? { surfaceId: source.surfaceId } : {}),
        companyId: source.companyId,
        kind: source.kind,
        atsKind: source.atsKind,
        status: source.status,
        officialEntryUrl: source.officialEntryUrl,
        officialChainEvidenceUrl: source.officialChainEvidenceUrl
      };

      let expectedChannels: ExecutableExpectedChannel[];
      try {
        expectedChannels = canonicalExpectedChannels(
          surface.channels
            .filter((channel) => channel.status === "EXPECTED")
            .map(({ channelId, kind }) => ({ channelId, kind }))
        );
      } catch {
        return [];
      }
      if (policy === "STAGED" && expectedChannels.length === 0) {
        try {
          expectedChannels = stagedConfiguredExpectedChannels(config, source.id);
        } catch {
          return [];
        }
      }
      if (fullRelease &&
          (!hasExactAdapterChannelCoverage(config, source.id, expectedChannels) || expectedChannels.length === 0)) {
        return [];
      }
      if (policy === "STAGED" &&
          (!hasExactStagedAdapterChannelCoverage(config, source.id, expectedChannels) || expectedChannels.length === 0)) {
        return [];
      }
      const channelBinding = policy === "STAGED"
        ? {
            executionAuthority: "STAGED" as const,
            expectedChannels,
            expectedChannelSetHash: expectedChannelSetHash(expectedChannels)
          }
        : fullRelease
          ? { expectedChannels, expectedChannelSetHash: expectedChannelSetHash(expectedChannels) }
          : {};

      const plan: SourceCrawlPlan =
        config.adapterId === "official-json"
          ? {
              adapterId: "official-json",
              company: plannedCompany,
              source: plannedSource,
              ...channelBinding,
              json: config.json,
              ...(config.officialJsonFetch ? { officialJsonFetch: config.officialJsonFetch } : {}),
              ...(config.workday ? { workday: config.workday } : {}),
              ...(config.hotjob ? { hotjob: config.hotjob } : {}),
              ...(config.hotjobLegacy ? { hotjobLegacy: config.hotjobLegacy } : {}),
              ...(config.moka ? { moka: config.moka } : {})
            }
          : {
              adapterId: "html-table",
              company: plannedCompany,
              source: plannedSource,
              ...channelBinding,
              table: config.table
            };

      if (policy === "STAGED") {
        try {
          validateExecutablePlanChannelBinding(plan);
        } catch {
          return [];
        }
      }
      return [plan];
    })
  );
}

export function canonicalExpectedChannels(
  channels: readonly ExecutableExpectedChannel[]
): ExecutableExpectedChannel[] {
  const canonical = channels.map((channel) => ({ channelId: channel.channelId, kind: channel.kind }));
  if (canonical.some((channel) => !channel.channelId.trim())) throw new Error("Expected channel id must be nonblank");
  if (new Set(canonical.map((channel) => channel.channelId)).size !== canonical.length) {
    throw new Error("Duplicate expected channel id");
  }
  return canonical.sort((left, right) =>
    compareUtf8(left.channelId, right.channelId) || compareUtf8(left.kind, right.kind)
  );
}

export function expectedChannelSetHash(channels: readonly ExecutableExpectedChannel[]): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalExpectedChannels(channels)), "utf8")
    .digest("hex");
}

function configuredChannelIds(config: RepresentativeSourceConfig, sourceId: string): string[] {
  if (
    config.adapterId === "official-json" &&
    config.officialJsonFetch?.kind === "redsea-zp-channel"
  ) {
    return [...config.officialJsonFetch.channelQrIds];
  }
  return [`source:${sourceId}:default`];
}

function stagedConfiguredChannelIds(config: RepresentativeSourceConfig, sourceId: string): string[] {
  if (config.adapterId === "html-table" && config.table.pagination?.talentbrewScope) {
    return config.table.pagination.talentbrewScope.allowedPartitions.map(({ channelId }) => channelId);
  }
  return configuredChannelIds(config, sourceId);
}

function stagedConfiguredExpectedChannels(
  config: RepresentativeSourceConfig,
  sourceId: string
): ExecutableExpectedChannel[] {
  return canonicalExpectedChannels(
    stagedConfiguredChannelIds(config, sourceId).map((channelId) => ({ channelId, kind: "SOCIAL" }))
  );
}

function hasExactAdapterChannelCoverage(
  config: RepresentativeSourceConfig,
  sourceId: string,
  channels: readonly ExecutableExpectedChannel[]
): boolean {
  try {
    const expectedIds = canonicalExpectedChannels(channels).map((channel) => channel.channelId);
    const configuredIds = configuredChannelIds(config, sourceId).sort(compareUtf8);
    return new Set(configuredIds).size === configuredIds.length &&
      JSON.stringify(expectedIds) === JSON.stringify(configuredIds);
  } catch {
    return false;
  }
}

function hasExactStagedAdapterChannelCoverage(
  config: RepresentativeSourceConfig,
  sourceId: string,
  channels: readonly ExecutableExpectedChannel[]
): boolean {
  try {
    if (channels.some((channel) => channel.kind !== "SOCIAL")) return false;
    const expectedIds = canonicalExpectedChannels(channels).map((channel) => channel.channelId);
    const configuredIds = stagedConfiguredChannelIds(config, sourceId).sort(compareUtf8);
    return new Set(configuredIds).size === configuredIds.length &&
      JSON.stringify(expectedIds) === JSON.stringify(configuredIds);
  } catch {
    return false;
  }
}

export function validateExecutablePlanChannelBinding(plan: SourceCrawlPlan): void {
  if (!plan.expectedChannels || !plan.expectedChannelSetHash) {
    throw new Error("Executable source plan channel binding is required");
  }
  const canonical = canonicalExpectedChannels(plan.expectedChannels);
  if (JSON.stringify(canonical) !== JSON.stringify(plan.expectedChannels)) {
    throw new Error("Executable source plan channels must be canonical");
  }
  if (expectedChannelSetHash(canonical) !== plan.expectedChannelSetHash) {
    throw new Error("Executable source plan channel hash mismatch");
  }
  const staged = plan.executionAuthority === "STAGED";
  if (staged && !hasCanonicalStagedPlanAuthority(plan)) {
    throw new Error("Staged source plan does not match canonical registry authority");
  }
  const expectedAdapter = staged && plan.source.atsKind === "BEISEN_ZHIYE"
    ? plan.adapterId
    : plan.source.atsKind === "OFFICIAL_HTML" || plan.source.atsKind === "SUCCESSFACTORS"
      ? "html-table"
      : plan.source.atsKind === "UNKNOWN" || plan.source.atsKind === "BROWSER_FALLBACK"
        ? undefined
        : "official-json";
  if (!expectedAdapter || expectedAdapter !== plan.adapterId) {
    throw new Error("Executable source plan adapter does not match ATS kind");
  }
  const config: RepresentativeSourceConfig = plan.adapterId === "official-json"
    ? {
        adapterId: "official-json", json: plan.json,
        ...(plan.officialJsonFetch ? { officialJsonFetch: plan.officialJsonFetch } : {}),
        ...(plan.workday ? { workday: plan.workday } : {}),
        ...(plan.hotjob ? { hotjob: plan.hotjob } : {}),
        ...(plan.hotjobLegacy ? { hotjobLegacy: plan.hotjobLegacy } : {})
      }
    : { adapterId: "html-table", table: plan.table };
  const exactCoverage = staged
    ? hasExactStagedAdapterChannelCoverage(config, plan.source.id, canonical)
    : hasExactAdapterChannelCoverage(config, plan.source.id, canonical);
  if (!exactCoverage) {
    throw new Error("Executable source plan channels are not fully covered by adapter config");
  }
}

export interface SourcePlanCoverage {
  unexpectedPlanSourceIds: string[];
  missingEligibleSurfaceIds: string[];
  blockedExpectedSurfaceIds: string[];
}

export function getSourcePlanCoverage(
  companies: readonly CandidateCompany[],
  plans: readonly SourceCrawlPlan[]
): SourcePlanCoverage {
  const companyIds = new Set(companies.map((company) => company.id));
  const surfaces = expectedOfficialSurfaces.filter((surface) => companyIds.has(surface.companyId));
  const eligible = surfaces.filter(
    (surface) =>
      surface.kind === "SOCIAL" &&
      surface.status === "INCLUDED" &&
      surface.oracleStatus === "INDEPENDENTLY_VERIFIED" &&
      !hasUnresolvedSurfaceScope(surface) &&
      Boolean(surface.officialEntryUrl) &&
      surface.officialChainEvidenceUrls.length > 0 &&
      Boolean(surface.adapterId)
  );
  const plannedSurfaceIds = new Set(plans.map((plan) => plan.source.surfaceId).filter(Boolean));
  const eligibleIds = new Set(eligible.map((surface) => surface.surfaceId));
  return {
    unexpectedPlanSourceIds: plans
      .filter((plan) => !plan.source.surfaceId || !eligibleIds.has(plan.source.surfaceId))
      .map((plan) => plan.source.id)
      .sort(compareUtf8),
    missingEligibleSurfaceIds: eligible
      .filter((surface) => !plannedSurfaceIds.has(surface.surfaceId))
      .map((surface) => surface.surfaceId)
      .sort(compareUtf8),
    blockedExpectedSurfaceIds: surfaces
      .filter((surface) => surface.kind === "SOCIAL" && !eligibleIds.has(surface.surfaceId))
      .map((surface) => surface.surfaceId)
      .sort(compareUtf8)
  };
}

function canonicalPlanValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalPlanValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareUtf8(left, right))
        .map(([key, item]) => [key, canonicalPlanValue(item)])
    );
  }
  return value;
}

export function sourcePlanConfigSha256(plan: SourceCrawlPlan): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalPlanValue(plan)), "utf8")
    .digest("hex");
}

export function activeSourcePlanSha256(plans: readonly SourceCrawlPlan[]): string {
  const ordered = [...plans].sort((left, right) => compareUtf8(left.source.id, right.source.id));
  return createHash("sha256")
    .update(JSON.stringify(canonicalPlanValue(ordered)), "utf8")
    .digest("hex");
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function hasCanonicalStagedAuthority(
  company: CandidateCompany,
  source: CandidateRecruitmentSource,
  surface: ExpectedOfficialRecruitmentSurface | undefined
): boolean {
  const canonicalCompany = candidateCompanies.find((candidate) => candidate.id === company.id);
  const canonicalSource = canonicalCompany?.sources.find((candidate) => candidate.id === source.id);
  const canonicalSurface = canonicalSource?.surfaceId
    ? expectedOfficialSurfaces.find((candidate) => candidate.surfaceId === canonicalSource.surfaceId)
    : undefined;
  return Boolean(
    canonicalCompany && canonicalSource && canonicalSurface && surface &&
    company.officialChineseName === canonicalCompany.officialChineseName &&
    company.pinyinName === canonicalCompany.pinyinName &&
    company.category === canonicalCompany.category &&
    company.targetStatus === canonicalCompany.targetStatus &&
    company.officialWebsiteUrl === canonicalCompany.officialWebsiteUrl &&
    hasCanonicalSourceAuthority(source, canonicalSource) &&
    surface.surfaceId === canonicalSurface.surfaceId &&
    surface.companyId === canonicalSurface.companyId &&
    surface.kind === canonicalSurface.kind &&
    surface.officialEntryUrl === canonicalSurface.officialEntryUrl &&
    JSON.stringify(surface.officialChainEvidenceUrls) === JSON.stringify(canonicalSurface.officialChainEvidenceUrls) &&
    surface.atsKind === canonicalSurface.atsKind &&
    surface.adapterId === canonicalSurface.adapterId &&
    surface.status === canonicalSurface.status
  );
}

function hasCanonicalStagedPlanAuthority(plan: SourceCrawlPlan): boolean {
  const canonicalCompany = candidateCompanies.find((candidate) => candidate.id === plan.company.id);
  const canonicalSource = canonicalCompany?.sources.find((candidate) => candidate.id === plan.source.id);
  return Boolean(
    canonicalCompany && canonicalSource &&
    plan.company.officialChineseName === canonicalCompany.officialChineseName &&
    plan.company.category === canonicalCompany.category &&
    hasCanonicalPlannedSourceAuthority(plan.source, canonicalSource)
  );
}

function hasCanonicalPlannedSourceAuthority(
  source: PlannedSource,
  canonicalSource: CandidateRecruitmentSource
): boolean {
  return source.id === canonicalSource.id &&
    source.surfaceId === canonicalSource.surfaceId &&
    source.companyId === canonicalSource.companyId &&
    source.kind === canonicalSource.kind &&
    source.atsKind === canonicalSource.atsKind &&
    source.status === canonicalSource.status &&
    source.officialEntryUrl === canonicalSource.officialEntryUrl &&
    source.officialChainEvidenceUrl === canonicalSource.officialChainEvidenceUrl;
}

function hasCanonicalSourceAuthority(
  source: CandidateRecruitmentSource,
  canonicalSource: CandidateRecruitmentSource
): boolean {
  return source.id === canonicalSource.id &&
    source.surfaceId === canonicalSource.surfaceId &&
    source.companyId === canonicalSource.companyId &&
    source.kind === canonicalSource.kind &&
    source.atsKind === canonicalSource.atsKind &&
    source.status === canonicalSource.status &&
    source.officialEntryUrl === canonicalSource.officialEntryUrl &&
    source.officialChainEvidenceUrl === canonicalSource.officialChainEvidenceUrl &&
    source.campusEntryUrl === canonicalSource.campusEntryUrl;
}

export function getPlanBySourceId(
  plans: readonly SourceCrawlPlan[],
  sourceId: string
): SourceCrawlPlan | undefined {
  return plans.find((plan) => plan.source.id === sourceId);
}
