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

const REPRESENTATIVE_CONFIGS: Record<string, RepresentativeSourceConfig> = {
  "source-astrazeneca-social": {
    adapterId: "official-json",
    json: {
      jobsPath: "data.jobs",
      fields: {
        sourceJobId: "id",
        officialTitle: "title",
        auxiliaryChineseTitle: "titleCn",
        officialUrl: "url",
        locationRaw: "location",
        cities: "cities",
        category: "category",
        officialPublishedAt: "publishedAt"
      }
    }
  },
  "source-novartis-social": {
    adapterId: "html-table",
    table: {
      rowSelector: "table[data-testid='jobs'] tbody tr",
      fields: {
        sourceJobId: { selector: "[data-field='id']" },
        officialTitle: { selector: "[data-field='title']" },
        officialUrl: { selector: "[data-field='title'] a", attribute: "href" },
        locationRaw: { selector: "[data-field='city']" },
        category: { selector: "[data-field='category']" }
      }
    }
  },
  "source-fosun-pharma-social": {
    adapterId: "html-table",
    table: {
      rowSelector: ".job-table tbody tr",
      fields: {
        sourceJobId: { selector: ".job-id" },
        officialTitle: { selector: ".job-title" },
        officialUrl: { selector: ".job-title a", attribute: "href" },
        locationRaw: { selector: ".job-city" },
        category: { selector: ".job-category" }
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
  }
};

export function buildSourceCrawlPlans(companies: readonly CandidateCompany[]): SourceCrawlPlan[] {
  return companies.flatMap((company) =>
    company.sources.flatMap((source): SourceCrawlPlan[] => {
      if (source.kind !== "SOCIAL" || !source.officialEntryUrl || !source.officialChainEvidenceUrl) {
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
