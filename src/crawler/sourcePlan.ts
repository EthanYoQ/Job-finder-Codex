import type { CandidateCompany, CandidateRecruitmentSource } from "../data/companyRegistry";
import type { HtmlTableConfig, OfficialJsonConfig } from "./adapters/types";
import type { HotjobWecruitFetchConfig } from "./hotjobWecruitSourceFetch";
import type { HotjobLegacyFetchConfig } from "./hotjobLegacySourceFetch";
import type { OfficialJsonFetchConfig } from "./officialJsonSourceFetch";
import type { WorkdayFetchConfig } from "./workdaySourceFetch";

export type CrawlAdapterId = "official-json" | "html-table";

type PlannedCompany = Pick<CandidateCompany, "id" | "officialChineseName">;
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
>;

export type SourceCrawlPlan =
  | {
      adapterId: "official-json";
      company: PlannedCompany;
      source: PlannedSource;
      json: OfficialJsonConfig;
      officialJsonFetch?: OfficialJsonFetchConfig;
      workday?: WorkdayFetchConfig;
      hotjob?: HotjobWecruitFetchConfig;
      hotjobLegacy?: HotjobLegacyFetchConfig;
    }
  | {
      adapterId: "html-table";
      company: PlannedCompany;
      source: PlannedSource;
      table: HtmlTableConfig;
    };

type RepresentativeSourceConfig =
  | {
      adapterId: "official-json";
      json: OfficialJsonConfig;
      officialJsonFetch?: OfficialJsonFetchConfig;
      workday?: WorkdayFetchConfig;
      hotjob?: HotjobWecruitFetchConfig;
      hotjobLegacy?: HotjobLegacyFetchConfig;
    }
  | {
      adapterId: "html-table";
      table: HtmlTableConfig;
    };

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

const REPRESENTATIVE_CONFIGS: Record<string, RepresentativeSourceConfig> = {
  "source-astrazeneca-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "#search-results-list li",
      fields: {
        officialTitle: { selector: "a.search-results-link h2" },
        officialUrl: { selector: "a.search-results-link", attribute: "href" },
        locationRaw: { selector: "span.job-location" }
      }
    }
  },
  "source-novartis-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "table.views-table tbody tr",
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
      fields: {
        officialTitle: { selector: "td:nth-child(1) a" },
        officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
        locationRaw: { selector: "td:nth-child(4) a" }
      }
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
  "source-roche-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "roche",
      site: "roche-ext",
      searchText: "China",
      pageSize: 20,
      maxPages: 5
    }
  },
  "source-msd-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "msd",
      site: "SearchJobs",
      searchText: "China",
      pageSize: 20,
      maxPages: 5
    }
  },
  "source-bms-china-social": {
    adapterId: "official-json",
    json: WORKDAY_JSON_CONFIG,
    workday: {
      tenant: "bristolmyerssquibb",
      site: "BMS",
      searchText: "China",
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
  "source-hengrui-social": {
    adapterId: "official-json",
    json: MOKA_JSON_CONFIG
  },
  "source-bayer-healthcare-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "#searchresults tbody tr",
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
      rowSelector: "#search-results-list li",
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
        officialTitle: { selector: ".font-bold.text-black.text-xl" },
        officialUrl: { value: "https://cn.zailaboratory.com/jobs/" },
        locationRaw: { selector: ".font-normal.mt-2" }
      }
    }
  },
  "source-kelun-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".jobsTable tr:not(.title)",
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
      rowSelector: ".jobsTable tr:not(.title)",
      fields: {
        officialTitle: { selector: "td:nth-child(1) a" },
        officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
        locationRaw: { selector: "td:nth-child(3)" }
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
      fields: {
        officialTitle: { selector: "td:nth-child(1) a" },
        officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
        locationRaw: { selector: "td:nth-child(3)" }
      }
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
    adapterId: "html-table",
    table: {
      rowSelector: ".recJob_list li",
      fields: {
        officialTitle: { selector: "a.recJob_name span:nth-child(1)" },
        officialUrl: { selector: "a.recJob_name", attribute: "href" },
        locationRaw: { selector: "a.recJob_name span:nth-child(2)" }
      }
    }
  },
  "source-akeso-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "a.job-card",
      fields: {
        sourceJobId: { selector: ":scope", attribute: "data-content-id" },
        officialTitle: { selector: "h3" },
        officialUrl: { selector: ":scope", attribute: "href" },
        locationRaw: { selector: ":scope", attribute: "data-location" }
      }
    }
  },
  "source-sanofi-china-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".job-list li",
      fields: {
        sourceJobId: { selector: "a", attribute: "data-job-id" },
        officialTitle: { selector: "span.job-title" },
        officialUrl: { selector: "a", attribute: "href" },
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
      detailBaseUrl: "https://careers.emdgroup.com/us/en/job"
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
  "source-sinocelltech-social": {
    adapterId: "official-json",
    json: HOTJOB_WECRUIT_JSON_CONFIG,
    hotjobLegacy: {
      listUrl: "https://www.hotjob.cn/wt/SCT/web/mode400/position/list",
      suitePath: "wt/SCT",
      pageSize: 20,
      maxPages: 10
    }
  },
  "source-grand-pharma-china-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".job-card",
      fields: {
        sourceJobId: { selector: ".job-title" },
        officialTitle: { selector: ".job-title" },
        officialUrl: { value: "https://job.grandpharma.cn/" },
        locationRaw: { selector: ".job-meta span:nth-child(1)" }
      }
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
  "source-puluo-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".join2 .table99.name",
      fields: {
        sourceJobId: { selector: "> div:nth-child(1) p" },
        officialTitle: { selector: "> div:nth-child(1) p" },
        officialUrl: { value: "https://www.apeloa.com/join.html" },
        locationRaw: { selector: "> div:nth-child(4) p" }
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
      fields: {
        sourceJobId: { selector: "td:nth-child(1)" },
        officialTitle: { selector: "td:nth-child(1)" },
        officialUrl: { value: "https://www.huahaipharm.com/zpgw.html" },
        locationRaw: { selector: "td:nth-child(2)" }
      }
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
    adapterId: "html-table",
    table: {
      rowSelector: '.list-data:contains("Beijing")',
      fields: {
        sourceJobId: { selector: "h4 a", attribute: "href" },
        officialTitle: { selector: ".job-title" },
        officialUrl: { selector: "h4 a", attribute: "href" },
        locationRaw: { selector: ".job-location" }
      }
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
  }
};

export function buildSourceCrawlPlans(companies: readonly CandidateCompany[]): SourceCrawlPlan[] {
  return companies.flatMap((company) =>
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
      if (!config) {
        return [];
      }

      const plannedCompany: PlannedCompany = {
        id: company.id,
        officialChineseName: company.officialChineseName
      };
      const plannedSource: PlannedSource = {
        id: source.id,
        companyId: source.companyId,
        kind: source.kind,
        atsKind: source.atsKind,
        status: source.status,
        officialEntryUrl: source.officialEntryUrl,
        officialChainEvidenceUrl: source.officialChainEvidenceUrl
      };

      const plan: SourceCrawlPlan =
        config.adapterId === "official-json"
          ? {
              adapterId: "official-json",
              company: plannedCompany,
              source: plannedSource,
              json: config.json,
              ...(config.officialJsonFetch ? { officialJsonFetch: config.officialJsonFetch } : {}),
              ...(config.workday ? { workday: config.workday } : {}),
              ...(config.hotjob ? { hotjob: config.hotjob } : {}),
              ...(config.hotjobLegacy ? { hotjobLegacy: config.hotjobLegacy } : {})
            }
          : {
              adapterId: "html-table",
              company: plannedCompany,
              source: plannedSource,
              table: config.table
            };

      return [plan];
    })
  );
}

export function getPlanBySourceId(
  plans: readonly SourceCrawlPlan[],
  sourceId: string
): SourceCrawlPlan | undefined {
  return plans.find((plan) => plan.source.id === sourceId);
}
