import type { CandidateCompany, CandidateRecruitmentSource } from "../data/companyRegistry";
import type { HtmlTableConfig, OfficialJsonConfig } from "./adapters/types";

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
  "source-cspc-social": {
    adapterId: "official-json",
    json: {
      jobsPath: "result.list",
      fields: {
        sourceJobId: "jobCode",
        officialTitle: "jobName",
        officialUrl: "applyUrl",
        locationRaw: "workPlace",
        cities: "cityList",
        category: "positionType"
      }
    }
  },
  "source-beigene-social": {
    adapterId: "official-json",
    json: MOKA_JSON_CONFIG
  },
  "source-hengrui-social": {
    adapterId: "official-json",
    json: MOKA_JSON_CONFIG
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
              json: config.json
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
