import { companies, type CompanyResult, type JobResult } from "./jobData";

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
        const cityMatches = job.city === city || job.city === "全国" || job.city === "中国";
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
    return sorted.sort(
      (left, right) =>
        right.jobs.length - left.jobs.length ||
        left.pinyin.localeCompare(right.pinyin, "zh-CN")
    );
  }

  if (sortMode === "LATEST") {
    return sorted.sort((left, right) => {
      const leftHasNew = left.jobs.some((job) => job.isNew) ? 1 : 0;
      const rightHasNew = right.jobs.some((job) => job.isNew) ? 1 : 0;

      return rightHasNew - leftHasNew || left.pinyin.localeCompare(right.pinyin, "zh-CN");
    });
  }

  return sorted.sort((left, right) => left.pinyin.localeCompare(right.pinyin, "zh-CN"));
}
