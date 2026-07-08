import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { htmlTableAdapter } from "../../src/crawler/adapters/htmlTable";
import { officialJsonAdapter } from "../../src/crawler/adapters/officialJson";
import type {
  CrawlAdapterCompany,
  CrawlAdapterResult,
  CrawlAdapterSource
} from "../../src/crawler/adapters/types";
import {
  NormalizedJobRecordSchema,
  hasRequiredJobFields,
  type NormalizedJobRecord
} from "../../src/crawler/normalizedJob";

const capturedAt = "2026-07-08T00:00:00.000Z";
const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/crawler/fixtures"
);

interface FixtureMetadata {
  company: CrawlAdapterCompany;
  source: CrawlAdapterSource;
}

const ASTRAZENECA_METADATA = {
  company: {
    id: "company-astrazeneca",
    officialChineseName: "阿斯利康制药有限公司"
  },
  source: {
    id: "source-astrazeneca-social",
    companyId: "company-astrazeneca",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    officialEntryUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c",
    officialChainEvidenceUrl: "https://www.astrazeneca.cn/careers",
    status: "VERIFIED_SCRAPABLE"
  }
} as const satisfies FixtureMetadata;

const CSPC_METADATA = {
  company: {
    id: "company-cspc",
    officialChineseName: "石药控股集团有限公司"
  },
  source: {
    id: "source-cspc-social",
    companyId: "company-cspc",
    kind: "SOCIAL",
    atsKind: "REDSEA",
    officialEntryUrl: "https://www.e-cspc.com/hr/",
    officialChainEvidenceUrl: "https://www.e-cspc.com/hr/",
    status: "VERIFIED_SCRAPABLE"
  }
} as const satisfies FixtureMetadata;

const FOSUN_PHARMA_METADATA = {
  company: {
    id: "company-fosun-pharma",
    officialChineseName: "上海复星医药（集团）股份有限公司"
  },
  source: {
    id: "source-fosun-pharma-social",
    companyId: "company-fosun-pharma",
    kind: "SOCIAL",
    atsKind: "BEISEN_ZHIYE",
    officialEntryUrl: "https://fosunpharma.zhiye.com/social",
    officialChainEvidenceUrl: "https://www.fosunpharma.com/careers",
    status: "VERIFIED_SCRAPABLE"
  }
} as const satisfies FixtureMetadata;

const NOVARTIS_METADATA = {
  company: {
    id: "company-novartis",
    officialChineseName: "北京诺华制药有限公司"
  },
  source: {
    id: "source-novartis-social",
    companyId: "company-novartis",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_HTML",
    officialEntryUrl: "https://prod1.novartis.com/careers/career-search/tag/LOC_CN",
    officialChainEvidenceUrl: "https://prod1.novartis.com/careers/career-search/tag/LOC_CN",
    status: "VERIFIED_SCRAPABLE"
  }
} as const satisfies FixtureMetadata;

function readFixture(path: string): string {
  return readFileSync(resolve(fixtureDirectory, path), "utf8");
}

function readJsonFixture(path: string): unknown {
  return JSON.parse(readFixture(path));
}

function expectSuccessfulJobs(result: CrawlAdapterResult): NormalizedJobRecord[] {
  expect(result.status).toBe("SUCCESS");
  if (result.status !== "SUCCESS") {
    throw new Error(result.failureReason);
  }

  for (const record of result.jobs) {
    expect(hasRequiredJobFields(record)).toBe(true);
    expect(() => NormalizedJobRecordSchema.parse(record)).not.toThrow();
  }

  return result.jobs;
}

function expectFailedResult(result: CrawlAdapterResult, failureReason: string): void {
  expect(result.status).toBe("FAILED");
  if (result.status !== "FAILED") {
    throw new Error("Expected failed adapter result");
  }

  expect(result.jobs).toEqual([]);
  expect(result.failureReason).toBe(failureReason);
  expect(result.observation.failureReason).toBe(failureReason);
  expect(result.observation.successful).toBe(false);
  expect(result.observation.structuredJobCount).toBe(0);
  expect(result.observation.stableRequiredFields).toEqual([]);
}

function assertAdapterTypeBoundaries(): void {
  // @ts-expect-error official JSON extraction requires payload and json config.
  officialJsonAdapter.extract({ ...ASTRAZENECA_METADATA, capturedAt });

  // @ts-expect-error HTML table extraction requires html and table config.
  htmlTableAdapter.extract({ ...NOVARTIS_METADATA, capturedAt });
}

void assertAdapterTypeBoundaries;

describe("crawler source adapters", () => {
  it("normalizes at least one Beijing job from an official JSON fixture", () => {
    const result = officialJsonAdapter.extract({
      ...ASTRAZENECA_METADATA,
      capturedAt,
      payload: readJsonFixture("astrazeneca-official-json.json"),
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
    });

    const jobs = expectSuccessfulJobs(result);
    expect(jobs.some((record) => record.cities.includes("北京"))).toBe(true);
    expect(jobs[0]?.sourceKind).toBe("SOCIAL");
  });

  it("normalizes title, city, category, and official URL from an HTML table fixture", () => {
    const result = htmlTableAdapter.extract({
      ...NOVARTIS_METADATA,
      capturedAt,
      html: readFixture("novartis-table.html"),
      table: {
        rowSelector: "table.views-table tbody tr",
        fields: {
          sourceJobId: { selector: "td.views-field-field-job-title a", attribute: "href" },
          officialTitle: { selector: "td.views-field-field-job-title a" },
          officialUrl: { selector: "td.views-field-field-job-title a", attribute: "href" },
          locationRaw: { selector: "td.views-field-field-job-work-location" },
          category: { selector: "td.views-field-field-job-functional-area" }
        }
      }
    });

    const [job] = expectSuccessfulJobs(result);
    expect(job?.officialTitle).toBe("Medical Science Liaison");
    expect(job?.cities).toEqual(["上海"]);
    expect(job?.category).toBe("其他");
    expect(job?.officialUrl).toBe(
      "https://www.novartis.com/careers/careers/job/job-cn-medical-science-liaison"
    );
  });

  it("maps multiple rows from a Zhiye-like table into normalized records", () => {
    const result = htmlTableAdapter.extract({
      ...FOSUN_PHARMA_METADATA,
      capturedAt,
      html: readFixture("zhiyelike-table.html"),
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
    });

    const jobs = expectSuccessfulJobs(result);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((record) => record.officialTitle)).toEqual([
      "Senior BD Manager",
      "Clinical Project Specialist"
    ]);
    expect(jobs.map((record) => record.sourceKind)).toEqual(["SOCIAL", "SOCIAL"]);
  });

  it("reads row-level attributes when a field selector uses :scope", () => {
    const result = htmlTableAdapter.extract({
      company: {
        id: "company-akeso",
        officialChineseName: "中山康方生物医药有限公司"
      },
      source: {
        id: "source-akeso-social",
        companyId: "company-akeso",
        kind: "SOCIAL",
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.akesobio.com/cn/career/social-recruitment/",
        officialChainEvidenceUrl: "https://www.akesobio.com/cn/career/",
        status: "VERIFIED_SCRAPABLE"
      },
      capturedAt,
      html: `
        <div class="jobs">
          <a
            class="job-card"
            href="/cn/career/social-recruitment/detail-1"
            data-content-id="AKESO-001"
            data-location="广州"
          >
            <h3>医学信息沟通专员</h3>
          </a>
        </div>
      `,
      table: {
        rowSelector: "a.job-card",
        fields: {
          sourceJobId: { selector: ":scope", attribute: "data-content-id" },
          officialTitle: { selector: "h3" },
          officialUrl: { selector: ":scope", attribute: "href" },
          locationRaw: { selector: ":scope", attribute: "data-location" }
        }
      }
    });

    const [job] = expectSuccessfulJobs(result);
    expect(job?.sourceJobId).toBe("AKESO-001");
    expect(job?.officialTitle).toBe("医学信息沟通专员");
    expect(job?.officialUrl).toBe(
      "https://www.akesobio.com/cn/career/social-recruitment/detail-1"
    );
    expect(job?.cities).toEqual(["广州"]);
  });

  it("uses a static field value for official URL while preserving per-row ids", () => {
    const result = htmlTableAdapter.extract({
      company: {
        id: "company-grand-pharma-china",
        officialChineseName: "远大医药（中国）有限公司"
      },
      source: {
        id: "source-grand-pharma-china-social",
        companyId: "company-grand-pharma-china",
        kind: "SOCIAL",
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://job.grandpharma.cn/",
        officialChainEvidenceUrl: "https://job.grandpharma.cn/",
        status: "VERIFIED_SCRAPABLE"
      },
      capturedAt,
      html: `
        <div class="jobs">
          <div class="job-card">
            <div class="job-title">医学经理</div>
            <div class="job-meta"><span>武汉</span></div>
          </div>
          <div class="job-card">
            <div class="job-title">招商主管</div>
            <div class="job-meta"><span>上海</span></div>
          </div>
        </div>
      `,
      table: {
        rowSelector: ".job-card",
        fields: {
          sourceJobId: { selector: ".job-title" },
          officialTitle: { selector: ".job-title" },
          officialUrl: { value: "https://official.example/jobs" },
          locationRaw: { selector: ".job-meta span:nth-child(1)" }
        }
      }
    });

    const jobs = expectSuccessfulJobs(result);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.sourceJobId)).toEqual(["医学经理", "招商主管"]);
    expect(new Set(jobs.map((job) => job.sourceJobId)).size).toBe(2);
    expect(jobs.map((job) => job.officialUrl)).toEqual([
      "https://official.example/jobs",
      "https://official.example/jobs"
    ]);
  });

  it("normalizes Redsea-style network JSON even when DOM content is empty", () => {
    const result = officialJsonAdapter.extract({
      ...CSPC_METADATA,
      capturedAt,
      payload: readJsonFixture("redsea-json.json"),
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
    });

    const [job] = expectSuccessfulJobs(result);
    expect(job?.officialTitle).toBe("质量保证专员");
    expect(job?.category).toBe("质量");
    expect(job?.officialUrl).toBe("https://www.e-cspc.com/hr/job/CSPC-001");
  });

  it("returns the external failure contract when JSON payload has no normalized jobs", () => {
    const result = officialJsonAdapter.extract({
      ...ASTRAZENECA_METADATA,
      capturedAt,
      payload: { data: { jobs: [] } },
      json: {
        jobsPath: "data.jobs",
        fields: {
          officialTitle: "title",
          officialUrl: "url",
          locationRaw: "location"
        }
      }
    });

    expectFailedResult(result, "No normalized jobs found in JSON payload");
  });

  it("returns the external failure contract when HTML table has no normalized jobs", () => {
    const result = htmlTableAdapter.extract({
      ...NOVARTIS_METADATA,
      capturedAt,
      html: "<table><tbody></tbody></table>",
      table: {
        rowSelector: "tbody tr",
        fields: {
          officialTitle: { selector: "[data-field='title']" },
          officialUrl: { selector: "[data-field='title'] a", attribute: "href" },
          locationRaw: { selector: "[data-field='city']" }
        }
      }
    });

    expectFailedResult(result, "No normalized jobs found in HTML table");
  });
});
