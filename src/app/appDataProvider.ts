import { companies as demoCompanies } from "./jobData";
import { filterJobs, sortCompanies, type SortMode } from "./jobSearch";
import { getStaticDocument } from "../server/staticDocuments";

export interface SearchRequest {
  city: string;
  keyword: string;
  categories: string[];
  sort: SortMode;
  onlyNew: boolean;
}

export interface SearchJob {
  id: string;
  title: string;
  officialTitle: string;
  officialPublishedAt: string | null;
  city: string;
  category: string;
  isNew: boolean;
  officialUrl: string;
}

export interface SearchCompany {
  id: string;
  companyName: string;
  pinyin: string;
  jobs: SearchJob[];
}

export interface SearchResult {
  companies: SearchCompany[];
  totalJobs: number;
  lastUpdatedAt: string | null;
}

export interface CoverageRequest {
  keyword: string;
  offset?: number;
  limit?: number;
}

export interface CoverageCompany {
  id: string;
  companyName: string;
  officialWebsiteUrl: string;
}

export interface CoverageResult {
  companies: CoverageCompany[];
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface FeedbackRequest {
  issueType: string;
  description: string;
  contact?: string;
  companyId?: string;
  jobId?: string;
}

export interface RecommendedCompanyRequest {
  companyName: string;
  officialWebsiteUrl: string;
}

export interface FeedbackReceipt {
  id: string;
  status: "OPEN";
}

export interface StaticDocumentResult {
  slug: "privacy" | "terms";
  title: string;
  body: string;
}

export interface AppDataProvider {
  searchJobs(request: SearchRequest): Promise<SearchResult>;
  listCoverage(request: CoverageRequest): Promise<CoverageResult>;
  submitFeedback(request: FeedbackRequest): Promise<FeedbackReceipt>;
  recommendCompany(request: RecommendedCompanyRequest): Promise<FeedbackReceipt>;
  getDocument(slug: "privacy" | "terms"): Promise<StaticDocumentResult>;
}

type ServerSortMode = "COMPANY_PINYIN_ASC" | "LATEST_POSTED" | "MATCHING_JOB_COUNT_DESC";

const DEMO_WEBSITES: Record<string, string> = {
  astrazeneca: "https://www.astrazeneca.com.cn/",
  beigene: "https://www.beigene.com.cn/",
  pfizer: "https://www.pfizer.com.cn/",
  novartis: "https://www.novartis.com.cn/",
  innovent: "https://cn.innoventbio.com/"
};

function latestPublishedAt(companies: SearchCompany[]): string | null {
  const timestamps = companies
    .flatMap((company) => company.jobs)
    .map((job) => job.officialPublishedAt)
    .filter((value): value is string => value !== null);

  if (timestamps.length === 0) {
    return null;
  }

  return timestamps.sort((left, right) => right.localeCompare(left, "zh-CN"))[0] ?? null;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

export function createDemoAppDataProvider(): AppDataProvider {
  return {
    async searchJobs(request) {
      const filtered = filterJobs({
        city: request.city,
        keyword: request.keyword,
        categories: request.categories,
        onlyNew: request.onlyNew
      });

      const sorted = sortCompanies(filtered, request.sort).map((company) => ({
        id: company.id,
        companyName: company.companyName,
        pinyin: company.pinyin,
        jobs: company.jobs.map((job) => ({
          id: job.id,
          title: job.title,
          officialTitle: job.officialTitle ?? job.title,
          officialPublishedAt: job.officialPublishedAt,
          city: job.city,
          category: job.category,
          isNew: job.isNew,
          officialUrl: job.officialUrl
        }))
      }));

      return {
        companies: sorted,
        totalJobs: sorted.reduce((sum, company) => sum + company.jobs.length, 0),
        lastUpdatedAt: latestPublishedAt(sorted)
      };
    },
    async listCoverage(request) {
      const keyword = normalize(request.keyword);
      const offset = request.offset ?? 0;
      const limit = request.limit ?? 50;
      const companies = demoCompanies
        .map((company) => ({
          id: company.id,
          companyName: company.companyName,
          officialWebsiteUrl: DEMO_WEBSITES[company.id] ?? company.jobs[0]?.officialUrl ?? ""
        }))
        .filter((company) => company.officialWebsiteUrl !== "")
        .filter((company) => {
          if (keyword === "") {
            return true;
          }

          return normalize(company.companyName).includes(keyword);
        });

      return {
        companies: companies.slice(offset, offset + limit),
        offset,
        limit,
        hasMore: offset + limit < companies.length
      };
    },
    async submitFeedback() {
      return {
        id: "demo-feedback-receipt",
        status: "OPEN"
      };
    },
    async recommendCompany() {
      return {
        id: "demo-recommendation-receipt",
        status: "OPEN"
      };
    },
    async getDocument(slug) {
      return getStaticDocument(slug);
    }
  };
}

export function createHttpAppDataProvider(baseUrl = ""): AppDataProvider {
  return {
    async searchJobs(request) {
      const params = new URLSearchParams({
        city: request.city,
        sort: toServerSort(request.sort),
        limit: "50",
        offset: "0"
      });

      if (request.keyword.trim() !== "") {
        params.set("keyword", request.keyword.trim());
      }

      for (const category of request.categories) {
        params.append("categories", toServerCategory(category));
      }

      if (request.onlyNew) {
        params.set("newWithinDays", "7");
      }

      const response = await fetch(`${baseUrl}/api/search?${params.toString()}`, {
        headers: { "x-job-search-consent": "accepted" }
      });

      return readJson<SearchResult>(response);
    },
    async listCoverage(request) {
      const params = new URLSearchParams({
        keyword: request.keyword,
        offset: String(request.offset ?? 0),
        limit: String(request.limit ?? 50)
      });
      const response = await fetch(`${baseUrl}/api/coverage?${params.toString()}`, {
        headers: { "x-job-search-consent": "accepted" }
      });

      return readJson<CoverageResult>(response);
    },
    async submitFeedback(request) {
      const isPrivacyRequest = request.issueType === "PRIVACY_EXPORT" || request.issueType === "PRIVACY_DELETE";
      const response = await fetch(`${baseUrl}/api/feedback`, {
        method: "POST",
        headers: isPrivacyRequest
          ? { "content-type": "application/json" }
          : { "content-type": "application/json", "x-job-search-consent": "accepted" },
        body: JSON.stringify(request)
      });

      return readJson<FeedbackReceipt>(response);
    },
    async recommendCompany(request) {
      const response = await fetch(`${baseUrl}/api/recommend-company`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-job-search-consent": "accepted"
        },
        body: JSON.stringify(request)
      });

      return readJson<FeedbackReceipt>(response);
    },
    async getDocument(slug) {
      const response = await fetch(`${baseUrl}/${slug}`);
      const body = await readText(response);

      return {
        slug,
        title: slug === "privacy" ? "隐私说明" : "使用条款",
        body
      };
    }
  };
}

function toServerSort(sort: SortMode): ServerSortMode {
  if (sort === "LATEST") {
    return "LATEST_POSTED";
  }

  if (sort === "JOB_COUNT_DESC") {
    return "MATCHING_JOB_COUNT_DESC";
  }

  return "COMPANY_PINYIN_ASC";
}

function toServerCategory(category: string): string {
  if (category === "市场准入") {
    return "市场准入/政府事务";
  }

  return category;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

async function readText(response: Response): Promise<string> {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.text();
}
