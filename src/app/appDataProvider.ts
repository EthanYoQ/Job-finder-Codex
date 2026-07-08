import { companies as demoCompanies } from "./jobData";
import { filterJobs, sortCompanies, type SortMode } from "./jobSearch";

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

const DEMO_WEBSITES: Record<string, string> = {
  astrazeneca: "https://www.astrazeneca.com.cn/",
  beigene: "https://www.beigene.com.cn/",
  pfizer: "https://www.pfizer.com.cn/",
  novartis: "https://www.novartis.com.cn/",
  innovent: "https://cn.innoventbio.com/"
};

const DEMO_DOCUMENTS: Record<"privacy" | "terms", StaticDocumentResult> = {
  privacy: {
    slug: "privacy",
    title: "隐私说明",
    body: [
      "本服务在用户明确同意前，不提供职位搜索、反馈提交或推荐公司等交互能力。",
      "我们仅在反滥用、限流和运维所必需的范围内记录请求元数据。",
      "如涉及跨境数据流转、用工合规或个人信息处理，跨境合规事项仍需法律复核。"
    ].join("\n")
  },
  terms: {
    slug: "terms",
    title: "使用条款",
    body: [
      "本服务仅用于求职信息查询与纠错反馈，不构成对招聘信息真实性或适用性的担保。",
      "未经书面许可，禁止抓取、批量复制、转售或商业化复用本服务数据。",
      "触发异常流量、自动化批量访问或规避风控的请求可能被限流或 challenge。"
    ].join("\n")
  }
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
      return DEMO_DOCUMENTS[slug];
    }
  };
}
