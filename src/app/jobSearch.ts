import { companies, type CompanyResult, type JobResult } from "./jobData";
import { ALL_LOCATIONS } from "../domain/search";

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
    normalized(job.category).includes(keyword)
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

  const keyword = normalized(filters.keyword);
  const categories = new Set(filters.categories);

  return companies
    .map((company) => ({
      ...company,
      jobs: company.jobs.filter((job) => {
        const cityMatches = city === ALL_LOCATIONS || job.city === city || job.city === "全国" || job.city === "中国";
        const categoryMatches = categories.size === 0 || categories.has(job.category);
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
