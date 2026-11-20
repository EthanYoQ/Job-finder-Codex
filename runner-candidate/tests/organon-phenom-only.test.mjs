import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { candidateCompanies } from "../src/data/companyRegistry.ts";
import { buildStagedSourceCrawlPlans } from "../src/crawler/sourcePlan.ts";
import { createOfficialJsonSourceFetch } from "../src/crawler/officialJsonSourceFetch.ts";
import { runSourceCrawl } from "../src/crawler/runSourceCrawl.ts";
import { replayStrictSourceQualityEvidenceAsync } from "../src/crawler/runSourceCrawl.ts";
import { evaluatePaginationEvidence } from "../src/crawler/paginationEvidence.ts";
import { isOrganonPhenomOnlyPlan, ORGANON_PHENOM_ONLY_POLICY } from "../src/crawler/organonOfficialPostedDate.ts";

const organonPlan = buildStagedSourceCrawlPlans(candidateCompanies).find(
  (plan) => plan.source.id === "source-organon-china-social"
);

const sampleRaw = JSON.parse(
  readFileSync(new URL("./fixtures/organon-location-change.json", import.meta.url), "utf8")
);

function buildOrganonEntryHtml(jobs, { keywords = "China", totalHits = jobs.length } = {}) {
  const payload = {
    eagerLoadRefineSearch: {
      status: 200,
      hits: totalHits,
      totalHits,
      data: {
        keywords,
        jobs
      }
    }
  };
  const config = {
    widgetApiEndpoint: "https://jobs.organon.com/widgets",
    country: "cn",
    deviceType: "desktop",
    locale: "zh_cn",
    refNum: "MECEUS",
    pageName: "search-results",
    pageId: "page18-ds"
  };
  return `<!doctype html><html><head><title>Organon</title></head><body>
<script>
var phApp = ${JSON.stringify(config)};
</script>
<script>
phApp.ddo = ${JSON.stringify(payload)};
</script>
</body></html>`;
}

function buildOrganonFetch(jobs, entryOverrides) {
  const requests = [];
  const fixedNow = "2026-11-20T00:10:00.000Z";
  const http = async (req) => {
    requests.push(req.url);
    assert.ok(
      !req.url.includes("myworkdayjobs.com"),
      `ORGANON_PHENOM_ONLY_V1 must never request myworkdayjobs.com, saw ${req.url}`
    );
    if (req.url === "https://jobs.organon.com/cn/zh/search-results?keywords=China" ||
        req.url === "https://jobs.organon.com/cn/zh/search-results") {
      return {
        status: 200,
        finalUrl: req.url,
        contentType: "text/html; charset=UTF-8",
        capturedAt: fixedNow,
        body: buildOrganonEntryHtml(jobs, entryOverrides)
      };
    }
    if (req.url === "https://jobs.organon.com/widgets") {
      return {
        status: 200,
        finalUrl: req.url,
        contentType: "application/json",
        capturedAt: fixedNow,
        body: JSON.stringify({
          refineSearch: {
            status: 200,
            hits: jobs.length,
            totalHits: jobs.length,
            data: { jobs, aggregations: [] }
          }
        })
      };
    }
    throw new Error(`Unexpected URL in Organon fetch: ${req.url}`);
  };
  return { fetchImpl: createOfficialJsonSourceFetch({ http, now: () => new Date(fixedNow) }), requests };
}

test("ORGANON_PHENOM_ONLY_V1 crawls and replays via Phenom JSON with zero Workday requests", async () => {
  assert.ok(organonPlan);
  assert.equal(organonPlan.officialJsonFetch?.publicVisibilityPolicy, ORGANON_PHENOM_ONLY_POLICY);
  assert.equal(isOrganonPhenomOnlyPlan(organonPlan), true);

  const { fetchImpl, requests } = buildOrganonFetch([sampleRaw]);
  const result = await runSourceCrawl(organonPlan, {
    fetch: fetchImpl,
    isBaseline: false
  });

  assert.equal(result.status, "SUCCESS", JSON.stringify(result.diagnostics));
  assert.equal(result.truth.completenessVerified, true);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].officialUrl, sampleRaw.applyUrl);
  assert.deepEqual(requests, [
    "https://jobs.organon.com/cn/zh/search-results?keywords=China",
    "https://jobs.organon.com/widgets"
  ]);

  const capturedAt = result.fetchEvidence.artifacts[0].capturedAt;
  const paginationEvaluation = evaluatePaginationEvidence({
    evidence: result.fetchEvidence,
    expectedChannelIds: [...new Set(result.fetchEvidence.pages.map((p) => p.channelId).filter(Boolean))],
    filteredOutput: true,
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
    allowIndependentlyVerifiedProfileBoundExclusions: true
  });
  const strict = await replayStrictSourceQualityEvidenceAsync({
    plan: organonPlan,
    evidence: result.fetchEvidence,
    paginationEvaluation,
    reconciliation: result.reconciliation,
    jobs: result.jobs,
    capturedAt
  });
  assert.equal(strict, true);
});

test("ORGANON_PHENOM_ONLY_V1 still rejects keyword/country scope mismatch", async () => {
  const { fetchImpl } = buildOrganonFetch([sampleRaw], { keywords: "Taiwan" });
  const fetched = await fetchImpl(organonPlan, { isBaseline: false });
  assert.equal(fetched.ok, false);
  assert.match(fetched.failureReason ?? "", /ORGANON_KEYWORD_COUNTRY_SCOPE_UNKNOWN/);
});

test("ORGANON_PHENOM_ONLY_V1 replay rejects injected Workday native detail artifacts", async () => {
  const { fetchImpl } = buildOrganonFetch([sampleRaw]);
  const result = await runSourceCrawl(organonPlan, {
    fetch: fetchImpl,
    isBaseline: false
  });
  assert.equal(result.status, "SUCCESS", JSON.stringify(result.diagnostics));

  const capturedAt = result.fetchEvidence.artifacts[0].capturedAt;
  const tamperedEvidence = structuredClone(result.fetchEvidence);
  tamperedEvidence.artifacts.push({
    id: `organon-detail-${sampleRaw.reqId}`,
    logicalKey: `organon-detail-${sampleRaw.reqId}`,
    kind: "OFFICIAL_COMPANY_PAGE",
    requestedUrl: sampleRaw.applyUrl,
    finalUrl: sampleRaw.applyUrl,
    httpStatus: 200,
    contentType: "text/html",
    capturedAt,
    extractorLocator: "organon-workday-jobposting-v1",
    body: "<html></html>",
    bodyRepresentation: "EXACT"
  });
  const paginationEvaluation = evaluatePaginationEvidence({
    evidence: tamperedEvidence,
    expectedChannelIds: [...new Set(tamperedEvidence.pages.map((p) => p.channelId).filter(Boolean))],
    filteredOutput: true,
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true,
    allowIndependentlyVerifiedProfileBoundExclusions: true
  });
  const strict = await replayStrictSourceQualityEvidenceAsync({
    plan: organonPlan,
    evidence: tamperedEvidence,
    paginationEvaluation,
    reconciliation: result.reconciliation,
    jobs: result.jobs,
    capturedAt
  });
  assert.equal(strict, false);
});
