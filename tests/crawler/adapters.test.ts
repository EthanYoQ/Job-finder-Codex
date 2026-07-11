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
  it("does not promote an explicit manual-review status when output equals the official total", () => {
    const result = officialJsonAdapter.extract({
      ...ASTRAZENECA_METADATA,
      capturedAt,
      payload: { jobs: [{ title: "Medical Lead", url: "https://example.com/jobs/1", location: "Shanghai" }] },
      json: {
        jobsPath: "jobs",
        fields: { officialTitle: "title", officialUrl: "url", locationRaw: "location" }
      },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 1,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://example.com/api",
        completenessBlockerReason: "Adapter accounting is pending"
      }
    });

    expect(result.observation.completenessStatus).toBe("NEEDS_MANUAL_COMPLETENESS_REVIEW");
    expect(result.observation.completenessBlockerReason).toBe("Adapter accounting is pending");
  });

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

  it("normalizes CSPC official HTML rows using title job codes as stable IDs", () => {
    const result = htmlTableAdapter.extract({
      company: CSPC_METADATA.company,
      source: {
        ...CSPC_METADATA.source,
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.e-cspc.com/hr/social.html",
        officialChainEvidenceUrl: "https://www.cspc.cn/hr/index.html"
      },
      capturedAt,
      completeness: {
        completenessStatus: "VERIFIED",
        completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL",
        completenessEvidenceUrl: "https://www.e-cspc.com/hr/social.html",
        totalPages: 1,
        pagesVisited: 1
      },
      html: `
        <ul id="workUl">
          <li>
            <h2 class="fnt_20">政策法规专员（2020年社会招聘）(J12369) (未申请)</h2>
            <h3><span>工作地点： 河北省-石家庄市</span></h3>
          </li>
          <li>
            <h2 class="fnt_20">销售代表-药品事业部(重庆)(J12273) (未申请)</h2>
            <h3><span>工作地点： 重庆市</span></h3>
          </li>
        </ul>
      `,
      table: {
        rowSelector: "#workUl li",
        fields: {
          sourceJobId: { selector: "h2", pattern: "\\((J\\d+)\\)" },
          officialTitle: { selector: "h2", pattern: "^(.+?)\\(J\\d+\\)" },
          officialUrl: { value: "https://www.e-cspc.com/hr/social.html" },
          locationRaw: {
            selector: "h3 span:contains('工作地点')",
            pattern: "工作地点：\\s*(.+)"
          }
        }
      }
    });

    const jobs = expectSuccessfulJobs(result);
    expect(jobs.map((job) => job.sourceJobId)).toEqual(["J12369", "J12273"]);
    expect(jobs.map((job) => job.officialTitle)).toEqual([
      "政策法规专员（2020年社会招聘）",
      "销售代表-药品事业部(重庆)"
    ]);
    expect(jobs.every((job) => job.officialUrl === "https://www.e-cspc.com/hr/social.html")).toBe(true);
  });

  it("does not invent official completeness from a configured HTML expected count", () => {
    const result = htmlTableAdapter.extract({
      ...ASTRAZENECA_METADATA,
      capturedAt,
      html: `
        <section id="search-results" data-total-job-results="283">
          <ul id="search-results-list">
            <li>
              <a class="search-results-link" href="/jobs/1"><h2>IT Quality Manager</h2></a>
              <span class="job-location">上海</span>
            </li>
            <li>
              <a class="search-results-link" href="/jobs/2"><h2>MR-LC-北京</h2></a>
              <span class="job-location">北京</span>
            </li>
          </ul>
        </section>
      `,
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
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.observation.expectedJobCount).toBeUndefined();
    expect(result.observation.completenessStatus).toBeUndefined();
    expect(result.observation.completenessEvidenceKind).toBeUndefined();
    expect(result.observation.completenessEvidenceUrl).toBeUndefined();
    expect(result.observation.completenessBlockerReason).toBeUndefined();
  });

  it("keeps CSL multi-location rows when the official job id repeats", () => {
    const result = htmlTableAdapter.extract({
      company: {
        id: "company-csl",
        officialChineseName: "CSL"
      },
      source: {
        id: "source-csl-china-social",
        companyId: "company-csl",
        kind: "SOCIAL",
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://jobs.csl.com/en/jobs?filterrific%5Bwith_location3%5D=china",
        officialChainEvidenceUrl: "https://www.csl.com/careers",
        status: "VERIFIED_SCRAPABLE"
      },
      capturedAt,
      html: `
        <ul>
          <li>
            <a href="https://jobs.csl.com/en/jobs/china-ra-manager-en-r-279336-behring-beijing">
              <p class="text-18">China RA manager</p>
              <p>Full Time</p>
              <p>Research Development & Sciences</p>
              <p>Global & Regional Regulatory Affairs</p>
              <p>CSL Behring</p>
              <p><svg aria-hidden="true"></svg>Beijing, Beijing, China</p>
              <p>R-279336</p>
            </a>
          </li>
          <li>
            <a href="https://jobs.csl.com/en/jobs/china-ra-manager-en-r-279336-behring">
              <p class="text-18">China RA manager</p>
              <p>Full Time</p>
              <p>Research Development & Sciences</p>
              <p>Global & Regional Regulatory Affairs</p>
              <p>CSL Behring</p>
              <p><svg aria-hidden="true"></svg>Shanghai, Shang Hai Shi, China</p>
              <p>R-279336</p>
            </a>
          </li>
          <li>
            <a href="https://jobs.csl.com/en/jobs/senior-director-regional-ecosystem-lead-shanghai-en-r-269798">
              <p class="text-18">Senior Director, Regional Ecosystem Lead, Shanghai</p>
              <p>Full Time</p>
              <p>Research Development & Sciences</p>
              <p>Discovery & Product Development</p>
              <p>CSL Behring</p>
              <p><svg aria-hidden="true"></svg>Shanghai, Shanghai, China</p>
              <p>R-269798</p>
            </a>
          </li>
        </ul>
      `,
      table: {
        rowSelector: "a[href^='https://jobs.csl.com/en/jobs/']",
        fields: {
          sourceJobId: { selector: ":scope", attribute: "href" },
          officialTitle: { selector: "p.text-18" },
          officialUrl: { selector: ":scope", attribute: "href" },
          locationRaw: { selector: "p:has(svg[aria-hidden='true'])" }
        }
      },
      completeness: {
        completenessStatus: "VERIFIED",
        expectedJobCount: 3,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://jobs.csl.com/en/jobs?filterrific%5Bwith_location3%5D=china"
      }
    });

    const jobs = expectSuccessfulJobs(result);
    expect(jobs).toHaveLength(3);
    expect(jobs.map((job) => job.locationRaw).sort()).toEqual([
      "Beijing, Beijing, China",
      "Shanghai, Shang Hai Shi, China",
      "Shanghai, Shanghai, China"
    ]);
    expect(result.observation.completenessStatus).toBe("NEEDS_MANUAL_COMPLETENESS_REVIEW");
    expect(result.observation.expectedJobCount).toBeUndefined();
  });

  it("counts unique jobs when official HTML pagination repeats rows", () => {
    const result = htmlTableAdapter.extract({
      ...NOVARTIS_METADATA,
      capturedAt,
      html: `
        <table>
          <tbody>
            <tr>
              <td class="title"><a href="/jobs/1">Medical Science Liaison</a></td>
              <td class="location">上海</td>
            </tr>
            <tr>
              <td class="title"><a href="/jobs/1">Medical Science Liaison</a></td>
              <td class="location">上海</td>
            </tr>
            <tr>
              <td class="title"><a href="/jobs/2">Brand Manager</a></td>
              <td class="location">北京</td>
            </tr>
          </tbody>
        </table>
      `,
      table: {
        rowSelector: "tbody tr",
        fields: {
          officialTitle: { selector: ".title a" },
          officialUrl: { selector: ".title a", attribute: "href" },
          locationRaw: { selector: ".location" }
        }
      },
      completeness: {
        completenessStatus: "VERIFIED",
        expectedJobCount: 2,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://prod1.novartis.com/careers/career-search/tag/LOC_CN",
        totalPages: 2,
        pagesVisited: 2
      }
    });

    const jobs = expectSuccessfulJobs(result);
    expect(jobs).toHaveLength(2);
    expect(result.observation.structuredJobCount).toBe(2);
    expect(result.observation.completenessStatus).toBe("NEEDS_MANUAL_COMPLETENESS_REVIEW");
  });

  it("downgrades fetch completeness when JSON normalization drops official-counted rows", () => {
    const result = officialJsonAdapter.extract({
      ...ASTRAZENECA_METADATA,
      capturedAt,
      payload: {
        data: {
          jobs: [
            {
              id: "job-1",
              title: "Medical Advisor",
              url: "https://careers.example/jobs/1",
              location: "上海"
            },
            {
              id: "job-2",
              title: "Incomplete Row",
              url: "https://careers.example/jobs/2"
            }
          ]
        }
      },
      json: {
        jobsPath: "data.jobs",
        fields: {
          sourceJobId: "id",
          officialTitle: "title",
          officialUrl: "url",
          locationRaw: "location"
        }
      },
      completeness: {
        completenessStatus: "VERIFIED",
        expectedJobCount: 2,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://careers.example/search",
        totalPages: 1,
        pageSize: 20,
        pagesVisited: 1
      }
    });

    const jobs = expectSuccessfulJobs(result);
    expect(jobs).toHaveLength(1);
    expect(result.observation.expectedJobCount).toBeUndefined();
    expect(result.observation.completenessStatus).toBe("INCOMPLETE");
    expect(result.observation.completenessBlockerReason).toContain(
      "Structured 1 jobs after adapter normalization"
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

  it("extracts a URL from a component attribute with a configured pattern", () => {
    const result = htmlTableAdapter.extract({
      company: {
        id: "company-zaiding",
        officialChineseName: "再鼎医药（上海）有限公司"
      },
      source: {
        id: "source-zaiding-social",
        companyId: "company-zaiding",
        kind: "SOCIAL",
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://cn.zailaboratory.com/jobs/",
        officialChainEvidenceUrl: "https://cn.zailaboratory.com/careers/",
        status: "VERIFIED_SCRAPABLE"
      },
      capturedAt,
      html: `
        <div class="jobs">
          <div class="job-card">
            <div class="job-title">(Senior) Product Manager</div>
            <div class="job-location">上海</div>
            <zai-button :link="{ url: 'https://cn.zailaboratory.com/jobs/3406916/', title: '了解更多' }"></zai-button>
          </div>
        </div>
      `,
      table: {
        rowSelector: ".job-card",
        fields: {
          sourceJobId: {
            selector: "zai-button",
            attribute: ":link",
            pattern: "jobs/(\\d+)/"
          },
          officialTitle: { selector: ".job-title" },
          officialUrl: {
            selector: "zai-button",
            attribute: ":link",
            pattern: "url:\\s*'([^']+)'"
          },
          locationRaw: { selector: ".job-location" }
        }
      }
    });

    const [job] = expectSuccessfulJobs(result);
    expect(job?.sourceJobId).toBe("3406916");
    expect(job?.officialUrl).toBe("https://cn.zailaboratory.com/jobs/3406916/");
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

  it("rejects caller-only completeness for an empty JSON payload", () => {
    const result = officialJsonAdapter.extract({
      ...ASTRAZENECA_METADATA,
      capturedAt,
      payload: { data: { jobs: [] } },
      completeness: {
        completenessStatus: "VERIFIED",
        expectedJobCount: 0,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://example.com/no-results",
        pagesVisited: 1
      },
      json: {
        jobsPath: "data.jobs",
        fields: {
          officialTitle: "title",
          officialUrl: "url",
          locationRaw: "location"
        }
      }
    });

    expect(result.status).toBe("FAILED");
    expect(result.jobs).toEqual([]);
    expect(result.observation).toMatchObject({
      successful: false,
      structuredJobCount: 0,
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      stableRequiredFields: []
    });
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

  it("rejects caller-only completeness for an empty HTML table", () => {
    const result = htmlTableAdapter.extract({
      ...NOVARTIS_METADATA,
      capturedAt,
      html: "<table><tbody></tbody></table>",
      completeness: {
        completenessStatus: "VERIFIED",
        expectedJobCount: 0,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://example.com/no-results",
        pagesVisited: 1
      },
      table: {
        rowSelector: "tbody tr",
        fields: {
          officialTitle: { selector: "[data-field='title']" },
          officialUrl: { selector: "[data-field='title'] a", attribute: "href" },
          locationRaw: { selector: "[data-field='city']" }
        }
      }
    });

    expect(result.status).toBe("FAILED");
    expect(result.jobs).toEqual([]);
    expect(result.observation).toMatchObject({
      successful: false,
      structuredJobCount: 0,
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      stableRequiredFields: []
    });
  });
});
