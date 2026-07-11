import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runSourceCrawl, type SourceFetchFunction } from "../../src/crawler/runSourceCrawl";
import { buildDiscoverySourcePlanCandidates, getPlanBySourceId, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const capturedAt = "2026-07-08T00:00:00.000Z";
const fixtureDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/crawler/fixtures"
);
const plans = buildDiscoverySourcePlanCandidates(candidateCompanies);

function readFixture(path: string): string {
  return readFileSync(resolve(fixtureDirectory, path), "utf8");
}

function planFor(sourceId: string): SourceCrawlPlan {
  const plan = getPlanBySourceId(plans, sourceId);

  if (!plan) {
    throw new Error(`Missing source crawl plan for ${sourceId}`);
  }

  return plan;
}

describe("runSourceCrawl", () => {
  const credentialPathCases = [
    ["plain", "/careers/apiKey=abc123"],
    ["percent", "/careers/clientSecret%3Dabc123"],
    ["double-percent", "/careers/token%253Dabc123"],
    ["fullwidth", "/careers/%EF%BD%81%EF%BD%95%EF%BD%94%EF%BD%88%EF%BC%9Dabc123"]
  ] as const;

  it.each(credentialPathCases)(
    "omits a failed-fetch entry URL with %s credential-shaped path metadata",
    async (_label, pathname) => {
      const base = planFor("source-astrazeneca-social");
      const rawEntry = `https://job-search.astrazeneca.cn${pathname}`;
      const plan = {
        ...base,
        source: { ...base.source, officialEntryUrl: rawEntry }
      } as SourceCrawlPlan;
      const result = await runSourceCrawl(plan, {
        fetch: async () => ({ ok: false, capturedAt, failureReason: "Official entry URL is invalid" })
      });
      expect(result.observation.completenessEvidenceUrl).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("abc123");
    }
  );

  it.each(credentialPathCases)(
    "omits a successful job chain URL with %s credential-shaped path metadata",
    async (_label, pathname) => {
      const base = planFor("source-novartis-social");
      const rawChain = `https://www.novartis.com${pathname}`;
      const plan = {
        ...base,
        source: { ...base.source, officialChainEvidenceUrl: rawChain }
      } as SourceCrawlPlan;
      const result = await runSourceCrawl(plan, {
        fetch: async () => ({ ok: true, capturedAt, html: readFixture("novartis-table.html") })
      });
      expect(result.status).toBe("SUCCESS");
      if (result.status !== "SUCCESS") throw new Error(result.failureReason);
      expect(result.jobs[0]?.evidence.officialChainEvidenceUrl).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("abc123");
    }
  );

  it("retains benign assignment-free path words such as Token Engineer and auth platform", async () => {
    const base = planFor("source-astrazeneca-social");
    const benignEntry = "https://job-search.astrazeneca.cn/careers/token-engineer/auth-platform";
    const plan = {
      ...base,
      source: { ...base.source, officialEntryUrl: benignEntry }
    } as SourceCrawlPlan;
    const result = await runSourceCrawl(plan, {
      fetch: async () => ({ ok: false, capturedAt, failureReason: "temporary upstream failure" })
    });
    expect(result.observation.completenessEvidenceUrl).toBe(benignEntry);
  });

  it("does not reintroduce entry credentials when a strict fetch fails before transport", async () => {
    const base = planFor("source-astrazeneca-social");
    const rawEntry = "https://user:placeholder@job-search.astrazeneca.cn/jobs?apiKey=abc123#secret";
    const plan = {
      ...base,
      source: { ...base.source, officialEntryUrl: rawEntry, officialChainEvidenceUrl: rawEntry }
    } as SourceCrawlPlan;
    const result = await runSourceCrawl(plan, {
      fetch: async () => ({ ok: false, capturedAt, failureReason: "Official entry URL is invalid" })
    });
    expect(result.status).toBe("FAILED");
    expect(result.observation.completenessEvidenceUrl).toBe(
      "https://job-search.astrazeneca.cn/jobs"
    );
    expect(JSON.stringify(result)).not.toMatch(/user|password|apiKey|abc123|secret/);
    expect(plan.source.officialEntryUrl).toBe(rawEntry);
  });

  it("removes raw query/hash from invalid-JSON failure observations", async () => {
    const base = planFor("source-astrazeneca-social");
    const rawEntry = "https://job-search.astrazeneca.cn/jobs?campaign=summer#social-jobs";
    const plan = {
      ...base,
      source: { ...base.source, officialEntryUrl: rawEntry }
    } as SourceCrawlPlan;
    const result = await runSourceCrawl(plan, {
      fetch: async () => ({ ok: false, capturedAt, failureReason: "Invalid JSON response" })
    });
    expect(result.observation.completenessEvidenceUrl).toBe(
      "https://job-search.astrazeneca.cn/jobs"
    );
    expect(JSON.stringify(result)).not.toContain("summer");
    expect(JSON.stringify(result)).not.toContain("social-jobs");
  });

  it("uses a safe source clone for successful adapter jobs and observations", async () => {
    const base = planFor("source-novartis-social");
    const rawEntry = `${base.source.officialEntryUrl}?campaign=summer#social-jobs`;
    const rawChain = `${base.source.officialChainEvidenceUrl}?ref=private#chain`;
    const plan = {
      ...base,
      source: {
        ...base.source,
        officialEntryUrl: rawEntry,
        officialChainEvidenceUrl: rawChain
      }
    } as SourceCrawlPlan;
    const result = await runSourceCrawl(plan, {
      fetch: async () => ({
        ok: true,
        capturedAt,
        html: readFixture("novartis-table.html"),
        completeness: {
          completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
          completenessEvidenceKind: "WEAK_MANUAL_SAMPLE",
          completenessEvidenceUrl: rawEntry
        }
      })
    });
    expect(result.status).toBe("SUCCESS");
    if (result.status !== "SUCCESS") throw new Error(result.failureReason);
    const safeEntry = new URL(base.source.officialEntryUrl);
    safeEntry.search = "";
    safeEntry.hash = "";
    const safeChain = new URL(base.source.officialChainEvidenceUrl);
    safeChain.search = "";
    safeChain.hash = "";
    expect(result.jobs[0]?.listUrl).toBe(safeEntry.toString());
    expect(result.jobs[0]?.evidence.officialEntryUrl).toBe(safeEntry.toString());
    expect(result.jobs[0]?.evidence.officialChainEvidenceUrl).toBe(safeChain.toString());
    expect(result.observation.completenessEvidenceUrl).toBeUndefined();
    expect(new URL(result.jobs[0]!.officialUrl).protocol).toBe("https:");
    expect(result.jobs[0]?.officialUrl).not.toMatch(/[?#](?:campaign|summer|social-jobs)/);
    expect(JSON.stringify(result)).not.toMatch(/summer|social-jobs|private|#chain/);
    expect(plan.source.officialEntryUrl).toBe(rawEntry);
  });

  it("keeps the canonical official entry as listUrl instead of an API endpoint", async () => {
    const base = planFor("source-hengrui-social");
    const rawEntry = `${base.source.officialEntryUrl}?campaign=summer#jobs`;
    const apiEvidenceUrl = "https://api.example.test/jobs?country=China#response";
    const plan = {
      ...base,
      source: { ...base.source, officialEntryUrl: rawEntry }
    } as SourceCrawlPlan;
    const result = await runSourceCrawl(plan, {
      fetch: async () => ({
        ok: true,
        capturedAt,
        payload: {
          data: {
            jobs: [{
              id: "job-1",
              title: "Token Engineer",
              officialUrl: "https://jobs.example.test/job-1",
              locationRaw: "上海",
              cities: ["上海"]
            }]
          }
        },
        completeness: {
          completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
          completenessEvidenceKind: "WEAK_MANUAL_SAMPLE",
          completenessEvidenceUrl: apiEvidenceUrl
        }
      })
    });
    expect(result.status).toBe("SUCCESS");
    if (result.status !== "SUCCESS") throw new Error(result.failureReason);
    const expectedListUrl = new URL(base.source.officialEntryUrl);
    expectedListUrl.search = "";
    expectedListUrl.hash = "";
    expect(result.jobs[0]?.listUrl).toBe(expectedListUrl.toString());
    expect(result.jobs[0]?.evidence.officialEntryUrl).toBe(expectedListUrl.toString());
    expect(result.observation.completenessEvidenceUrl).toBeUndefined();
    expect(result.jobs[0]?.listUrl).not.toBe(result.observation.completenessEvidenceUrl);
  });

  it("omits evidence URL and fails closed when the official entry URL is malformed", async () => {
    const base = planFor("source-hengrui-social");
    const plan = {
      ...base,
      source: { ...base.source, officialEntryUrl: "https://[malformed-secret" }
    } as SourceCrawlPlan;
    const failedFetch = await runSourceCrawl(plan, {
      fetch: async () => ({ ok: false, capturedAt, failureReason: "Invalid JSON response" })
    });
    expect(failedFetch.observation.completenessEvidenceUrl).toBeUndefined();
    expect(JSON.stringify(failedFetch)).not.toContain("malformed-secret");

    const adapterFailure = await runSourceCrawl(plan, {
      fetch: async () => ({ ok: true, capturedAt, payload: { jobs: [] } })
    });
    expect(adapterFailure.status).toBe("FAILED");
    expect(adapterFailure.observation.completenessEvidenceUrl).toBeUndefined();
    expect(JSON.stringify(adapterFailure)).not.toContain("malformed-secret");
  });

  it("marks thrown fetch exceptions with the FETCH stage", async () => {
    const plan = planFor("source-astrazeneca-social");
    const cause = new Error("fetch threw");

    await expect(runSourceCrawl(plan, { fetch: async () => { throw cause; } })).rejects.toMatchObject({
      stage: "FETCH",
      cause
    });
  });

  it("marks thrown adapter exceptions with the ADAPTER stage", async () => {
    const basePlan = planFor("source-astrazeneca-social");
    const cause = new Error("adapter threw");
    const plan = { ...basePlan } as SourceCrawlPlan;
    Object.defineProperty(plan, "adapterId", { get: () => { throw cause; } });

    await expect(
      runSourceCrawl(plan, {
        fetch: async () => ({ ok: true, capturedAt, html: "<html></html>" })
      })
    ).rejects.toMatchObject({ stage: "ADAPTER", cause });
  });

  it("uses the HTML table adapter for AstraZeneca and returns normalized jobs", async () => {
    const plan = planFor("source-astrazeneca-social");
    const fetch: SourceFetchFunction = async (receivedPlan) => {
      expect(receivedPlan).toBe(plan);
      return {
        ok: true,
        capturedAt,
        html: readFixture("astrazeneca-search-results.html"),
        completeness: {
          completenessStatus: "INCOMPLETE",
          expectedJobCount: 283,
          completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
          completenessEvidenceUrl: plan.source.officialEntryUrl,
          completenessBlockerReason: "Visited only the first page",
          totalPages: 19,
          pageSize: 15,
          pagesVisited: 1
        }
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
    expect(result.jobs[0]?.officialUrl).toBe(
      "https://job-search.astrazeneca.cn/jobs/regional-sales-manager-beijing"
    );
    expect(result.observation.id).toBe(`${plan.source.id}:html-table:${capturedAt}`);
    expect(result.observation.structuredJobCount).toBe(2);
    expect(result.observation.expectedJobCount).toBeUndefined();
    expect(result.observation.completenessStatus).toBe("INCOMPLETE");
    expect(result.observation.completenessEvidenceKind).toBeUndefined();
    expect(result.observation.completenessBlockerReason).toBe("Visited only the first page");
    expect(result.observation.totalPages).toBeUndefined();
    expect(result.observation.pageSize).toBeUndefined();
    expect(result.observation.pagesVisited).toBeUndefined();
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
      completenessStatus: "FAILED",
      completenessEvidenceKind: "FETCH_FAILURE",
      completenessEvidenceUrl: plan.source.officialEntryUrl,
      completenessBlockerReason: fetchFailure,
      failureReason: fetchFailure
    });
    expect(result.observation.crawledAt.toISOString()).toBe(capturedAt);
  });

  it("preserves failed-fetch evidence and pagination evaluation by reference", async () => {
    const plan = planFor("source-astrazeneca-social");
    const fetchEvidence = { marker: "fetch-evidence" } as never;
    const paginationEvaluation = { marker: "pagination-evaluation" } as never;

    const result = await runSourceCrawl(plan, {
      fetch: async () => ({
        ok: false,
        capturedAt,
        failureReason: "strict fetch failure",
        fetchEvidence,
        paginationEvaluation
      })
    });

    expect(result.fetchEvidence).toBe(fetchEvidence);
    expect(result.paginationEvaluation).toBe(paginationEvaluation);
  });

  it("classifies a successful transport with missing adapter input as adapter failure", async () => {
    const plan = planFor("source-hengrui-social");

    const result = await runSourceCrawl(plan, {
      fetch: async () => ({ ok: true, capturedAt, html: "<html></html>" })
    });

    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") {
      throw new Error("Expected adapter input failure");
    }
    expect(result.observation.completenessStatus).toBe("FAILED");
    expect(result.observation.completenessEvidenceKind).not.toBe("FETCH_FAILURE");
    expect(result.failureReason).toContain("Expected JSON payload");
  });

  it.each([
    ["unsafe source", "official-json", { payload: { jobs: [] } }, "https://bad.example/token=secret"],
    ["official-json receives html", "official-json", { html: "<html></html>" }, undefined],
    ["html-table receives payload", "html-table", { payload: { jobs: [] } }, undefined]
  ] as const)("preserves evidence references when %s fails before adapter execution", async (
    _label, adapterId, transportInput, unsafeEntry
  ) => {
    const base = adapterId === "official-json"
      ? planFor("source-hengrui-social")
      : planFor("source-novartis-social");
    const selectedPlan = unsafeEntry
      ? { ...base, source: { ...base.source, officialEntryUrl: unsafeEntry } } as SourceCrawlPlan
      : base;
    const fetchEvidence = { marker: "fetch-evidence" } as never;
    const paginationEvaluation = { marker: "pagination-evaluation" } as never;
    const priorTransportAttempts = [{ marker: "prior-attempt" }] as never;
    const result = await runSourceCrawl(selectedPlan, { fetch: async () => ({
      ok: true, capturedAt, ...transportInput, fetchEvidence, paginationEvaluation, priorTransportAttempts
    } as never) });
    expect(result.status).toBe("FAILED");
    expect(result.fetchEvidence).toBe(fetchEvidence);
    expect(result.paginationEvaluation).toBe(paginationEvaluation);
    expect(result.priorTransportAttempts).toBe(priorTransportAttempts);
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

  it("fails closed on sensitive source identity metadata without leaking it and preserves strict fetch refs", async () => {
    const base = planFor("source-hengrui-social");
    const plan = { ...base, source: { ...base.source, id: "source-clientSecret%253Dhidden" } } as SourceCrawlPlan;
    const fetchEvidence = { marker: "fetch-evidence", fetchCounts: { validCount: 1 } } as never;
    const paginationEvaluation = { marker: "pagination-evaluation" } as never;
    const priorTransportAttempts = [{ marker: "prior" }] as never;
    const result = await runSourceCrawl(plan, { fetch: async () => ({ ok: true, capturedAt,
      payload: { data: { jobs: [{ id: "safe", title: "Safe", officialUrl: "https://jobs.example.test/safe", locationRaw: "上海", cities: ["上海"] }] } },
      fetchEvidence, paginationEvaluation, priorTransportAttempts }) });
    expect(result.status).toBe("FAILED");
    expect(result.fetchEvidence).toBe(fetchEvidence);
    expect(result.paginationEvaluation).toBe(paginationEvaluation);
    expect(result.priorTransportAttempts).toBe(priorTransportAttempts);
    expect(JSON.stringify(result)).not.toMatch(/hidden|clientSecret/iu);
    if (result.status !== "FAILED") throw new Error("expected failure");
    expect(result.failureReason).toBe("Adapter input metadata is unsafe");
  });

  it.each([
    ["source", (base: SourceCrawlPlan) => ({ ...base, source: { ...base.source, id: "source-token%253Dhidden" } })],
    ["company", (base: SourceCrawlPlan) => ({ ...base, company: { ...base.company, officialChineseName: "clientSecret＝hidden" } })]
  ] as const)("rejects unsafe %s metadata even when fetch returns ok:false", async (_label, mutate) => {
    const plan = mutate(planFor("source-hengrui-social")) as SourceCrawlPlan;
    const fetchEvidence = { marker: "fetch" } as never;
    const paginationEvaluation = { marker: "evaluation" } as never;
    const priorTransportAttempts = [{ marker: "prior" }] as never;
    const result = await runSourceCrawl(plan, { fetch: async () => ({ ok: false, capturedAt,
      failureReason: "upstream failed", fetchEvidence, paginationEvaluation, priorTransportAttempts }) });
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") throw new Error("expected failure");
    expect(result.failureReason).toBe("Adapter input metadata is unsafe");
    expect(result.fetchEvidence).toBe(fetchEvidence);
    expect(result.paginationEvaluation).toBe(paginationEvaluation);
    expect(result.priorTransportAttempts).toBe(priorTransportAttempts);
    expect(JSON.stringify(result)).not.toMatch(/hidden|clientSecret/iu);
  });
});
