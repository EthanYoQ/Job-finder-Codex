import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runSourceCrawl, type SourceFetchFunction } from "../../src/crawler/runSourceCrawl";
import { buildSourceCrawlPlans, getPlanBySourceId, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const capturedAt = "2026-07-08T00:00:00.000Z";
const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/crawler/fixtures"
);
const plans = buildSourceCrawlPlans(candidateCompanies);

function readFixture(path: string): string {
  return readFileSync(resolve(fixtureDirectory, path), "utf8");
}

function readJsonFixture(path: string): unknown {
  return JSON.parse(readFixture(path));
}

function planFor(sourceId: string): SourceCrawlPlan {
  const plan = getPlanBySourceId(plans, sourceId);

  if (!plan) {
    throw new Error(`Missing source crawl plan for ${sourceId}`);
  }

  return plan;
}

describe("runSourceCrawl", () => {
  it("uses the official JSON adapter and returns normalized jobs", async () => {
    const plan = planFor("source-astrazeneca-social");
    const fetch: SourceFetchFunction = async (receivedPlan) => {
      expect(receivedPlan).toBe(plan);
      return {
        ok: true,
        capturedAt,
        payload: readJsonFixture("astrazeneca-official-json.json")
      };
    };

    const result = await runSourceCrawl(plan, { fetch });

    expect(result.status).toBe("SUCCESS");
    if (result.status !== "SUCCESS") {
      throw new Error(result.failureReason);
    }

    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]?.officialTitle).toBe("Regional Sales Manager (Beijing)");
    expect(result.jobs[0]?.isBaseline).toBe(true);
    expect(result.observation.id).toBe(`${plan.source.id}:official-json:${capturedAt}`);
    expect(result.observation.structuredJobCount).toBe(2);
  });

  it("uses the HTML table adapter and returns normalized jobs", async () => {
    const plan = planFor("source-novartis-social");
    const fetch: SourceFetchFunction = async (receivedPlan) => {
      expect(receivedPlan).toBe(plan);
      return {
        ok: true,
        capturedAt,
        html: readFixture("novartis-table.html")
      };
    };

    const result = await runSourceCrawl(plan, { fetch });

    expect(result.status).toBe("SUCCESS");
    if (result.status !== "SUCCESS") {
      throw new Error(result.failureReason);
    }

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.officialTitle).toBe("Medical Science Liaison");
    expect(result.jobs[0]?.cities).toEqual(["上海"]);
    expect(result.observation.id).toBe(`${plan.source.id}:html-table:${capturedAt}`);
    expect(result.observation.structuredJobCount).toBe(1);
  });

  it("returns a failed observation for failed fetches without adapter execution", async () => {
    const plan = planFor("source-astrazeneca-social");
    const fetchFailure = "temporary upstream 503";
    const fetch: SourceFetchFunction = async () => ({
      ok: false,
      capturedAt,
      failureReason: fetchFailure
    });

    const result = await runSourceCrawl(plan, { fetch });

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") {
      throw new Error("Expected failed fetch result");
    }

    expect(result.jobs).toEqual([]);
    expect(result.failureReason).toBe(fetchFailure);
    expect(result.observation).toMatchObject({
      id: `${plan.source.id}:fetch:${capturedAt}`,
      sourceId: plan.source.id,
      successful: false,
      stableRequiredFields: [],
      structuredJobCount: 0,
      failureReason: fetchFailure
    });
    expect(result.observation.crawledAt.toISOString()).toBe(capturedAt);
  });

  it("passes non-baseline crawl state through to normalized jobs", async () => {
    const plan = planFor("source-novartis-social");
    const fetch: SourceFetchFunction = async () => ({
      ok: true,
      capturedAt,
      html: readFixture("novartis-table.html")
    });

    const result = await runSourceCrawl(plan, { fetch, isBaseline: false });

    expect(result.status).toBe("SUCCESS");
    if (result.status !== "SUCCESS") {
      throw new Error(result.failureReason);
    }

    expect(result.jobs).not.toHaveLength(0);
    expect(result.jobs.every((job) => job.isBaseline === false)).toBe(true);
  });
});
