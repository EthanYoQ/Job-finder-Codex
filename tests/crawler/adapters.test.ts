import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { htmlTableAdapter } from "../../src/crawler/adapters/htmlTable";
import { officialJsonAdapter } from "../../src/crawler/adapters/officialJson";
import type {
  CrawlAdapterInput,
  CrawlAdapterResult
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

function readFixture(path: string): string {
  return readFileSync(resolve(fixtureDirectory, path), "utf8");
}

function readJsonFixture(path: string): unknown {
  return JSON.parse(readFixture(path));
}

function metadataFor(companyId: string): Pick<CrawlAdapterInput, "company" | "source"> {
  const company = candidateCompanies.find((candidate) => candidate.id === companyId);
  if (!company) {
    throw new Error(`Missing fixture company ${companyId}`);
  }

  const source = company.sources.find((candidateSource) => candidateSource.kind === "SOCIAL");
  if (!source?.officialEntryUrl || !source.officialChainEvidenceUrl) {
    throw new Error(`Missing official social source metadata for ${companyId}`);
  }

  return {
    company: {
      id: company.id,
      officialChineseName: company.officialChineseName
    },
    source: {
      id: source.id,
      companyId: source.companyId,
      kind: source.kind,
      atsKind: source.atsKind,
      officialEntryUrl: source.officialEntryUrl,
      officialChainEvidenceUrl: source.officialChainEvidenceUrl,
      status: source.status
    }
  };
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

describe("crawler source adapters", () => {
  it("normalizes at least one Beijing job from an official JSON fixture", () => {
    const result = officialJsonAdapter.extract({
      ...metadataFor("company-astrazeneca"),
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
      ...metadataFor("company-novartis"),
      capturedAt,
      html: readFixture("novartis-table.html"),
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
    });

    const [job] = expectSuccessfulJobs(result);
    expect(job?.officialTitle).toBe("Medical Science Liaison");
    expect(job?.cities).toEqual(["上海"]);
    expect(job?.category).toBe("医学事务");
    expect(job?.officialUrl).toBe("https://prod1.novartis.com/careers/job/nov-cn-001");
  });

  it("maps multiple rows from a Zhiye-like table into normalized records", () => {
    const result = htmlTableAdapter.extract({
      ...metadataFor("company-fosun-pharma"),
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

  it("normalizes Redsea-style network JSON even when DOM content is empty", () => {
    const result = officialJsonAdapter.extract({
      ...metadataFor("company-cspc"),
      capturedAt,
      html: "",
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
});
