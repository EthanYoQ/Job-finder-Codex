import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { htmlTableAdapter } from "../../src/crawler/adapters/htmlTable";
import { buildDiscoverySourcePlanCandidates, getPlanBySourceId } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/crawler/fixtures/static-official-sources"
);

const cases = [
  {
    sourceId: "source-apeloa-social",
    fixture: "apeloa.html",
    expectedTitles: ["质量体系专员", "医学事务专员"],
    excludedTitle: "校园培训生"
  },
  {
    sourceId: "source-huahai-social",
    fixture: "huahai.html",
    expectedTitles: ["注册事务专员", "生产技术员"],
    excludedTitle: undefined
  },
  {
    sourceId: "source-otsuka-china-social-2",
    fixture: "otsuka-group.html",
    expectedTitles: ["临床运营专员", "供应链专员"],
    excludedTitle: undefined
  },
  {
    sourceId: "source-grand-pharma-social",
    fixture: "grand.html",
    expectedTitles: ["药物警戒专员", "市场准入专员"],
    excludedTitle: "校园培训生"
  }
] as const;

describe("sanitized static official source fixtures", () => {
  const plans = buildDiscoverySourcePlanCandidates(candidateCompanies);

  it.each(cases)("extracts only the social partition for $sourceId", ({ sourceId, fixture, expectedTitles, excludedTitle }) => {
    const plan = getPlanBySourceId(plans, sourceId);
    expect(plan?.adapterId).toBe("html-table");
    if (!plan || plan.adapterId !== "html-table") throw new Error(`missing HTML plan for ${sourceId}`);

    const result = htmlTableAdapter.extract({
      company: plan.company,
      source: plan.source,
      capturedAt: "2026-07-08T00:00:00.000Z",
      html: readFileSync(resolve(fixtureDirectory, fixture), "utf8"),
      table: plan.table
    });

    expect(result.status).toBe("SUCCESS");
    if (result.status !== "SUCCESS") throw new Error(result.failureReason);
    expect(result.jobs.map((job) => job.officialTitle)).toEqual(expectedTitles);
    expect(result.jobs.map((job) => job.sourceJobId)).toEqual(
      expectedTitles.map(() => expect.stringMatching(/^html:sha256:[0-9a-f]{64}$/))
    );
    expect(result.jobs.every((job) => job.officialUrl === plan.source.officialEntryUrl)).toBe(true);
    expect(new Set(result.jobs.map((job) => job.sourceJobId)).size).toBe(expectedTitles.length);
    if (excludedTitle) expect(result.jobs.map((job) => job.officialTitle)).not.toContain(excludedTitle);
  });

  it("keeps the Otsuka subsidiary source without an executable plan", () => {
    expect(getPlanBySourceId(plans, "source-otsuka-china-social")).toBeUndefined();
  });
});
