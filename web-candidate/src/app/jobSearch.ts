import { companies, type CompanyResult, type JobResult } from "./jobData";
import { SearchRequestSchema } from "../domain/search";
import { classifyJob, matchesJobCategory } from "../domain/jobClassification";

export { companies, type CompanyResult, type JobResult } from "./jobData";

export interface SearchFilters {
  city: string;
  keyword: string;
  categories: string[];
  onlyNew: boolean;
}

export type SortMode = "PINYIN_ASC" | "LATEST" | "JOB_COUNT_DESC";

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function matchesKeyword(companyName: string, job: JobResult, keyword: string): boolean {
  if (!keyword) {
    return true;
  }

  return (
    normalized(job.title).includes(keyword) ||
    normalized(job.officialTitle ?? "").includes(keyword) ||
    normalized(companyName).includes(keyword) ||
    normalized(job.category).includes(keyword) ||
    normalized(job.subcategory ?? "").includes(keyword)
  );
}

function compareByPinyin(left: CompanyResult, right: CompanyResult): number {
  return left.pinyin.localeCompare(right.pinyin, "zh-CN");
}

function latestPublishedAt(jobs: JobResult[]): string {
  return jobs.reduce(
    (latest, job) => (job.officialPublishedAt > latest ? job.officialPublishedAt : latest),
    ""
  );
}

export function filterJobs(filters: SearchFilters): CompanyResult[] {
  const city = filters.city.trim();
  if (!city) {
    return [];
  }

  SearchRequestSchema.parse({ city });

  const keyword = normalized(filters.keyword);

  return companies
    .map((company) => ({
      ...company,
      jobs: company.jobs.map((job) => ({
        ...job,
        ...classifyJob({ officialTitle: job.officialTitle ?? job.title, category: job.category })
      })).filter((job) => {
        const cityMatches = job.city === city || job.city === "全国" || job.city === "中国";
        const categoryMatches = matchesJobCategory(job, filters.categories);
        const newMatches = !filters.onlyNew || job.isNew;

        return cityMatches && categoryMatches && newMatches && matchesKeyword(company.companyName, job, keyword);
      })
    }))
    .filter((company) => company.jobs.length > 0);
}

export function sortCompanies(
  companyResults: CompanyResult[],
  sortMode: SortMode
): CompanyResult[] {
  const sorted = [...companyResults];

  if (sortMode === "JOB_COUNT_DESC") {
    return sorted.sort((left, right) => right.jobs.length - left.jobs.length || compareByPinyin(left, right));
  }

  if (sortMode === "LATEST") {
    return sorted.sort((left, right) => {
      const leftLatestPublishedAt = latestPublishedAt(left.jobs);
      const rightLatestPublishedAt = latestPublishedAt(right.jobs);

      return (
        rightLatestPublishedAt.localeCompare(leftLatestPublishedAt, "zh-CN") ||
        compareByPinyin(left, right)
      );
    });
  }

  return sorted.sort(compareByPinyin);
}
