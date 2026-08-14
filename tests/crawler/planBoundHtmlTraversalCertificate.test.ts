import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { reconcileAdapterRows } from "../../src/crawler/adapters/reconciliation";
import { createHttpHtmlSourceFetch, type HttpHtmlRequest } from "../../src/crawler/httpHtmlSourceFetch";
import { buildJobDedupeKey, type NormalizedJobRecord } from "../../src/crawler/normalizedJob";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import {
  PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS,
  type PlanBoundHtmlTraversalSourceId
} from "../../src/crawler/planBoundHtmlTraversalValidator";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  sourcePlanConfigSha256,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { sha256Bytes, type PersistentSourceFetchEvidence } from "../../src/crawler/sourceFetchEvidence";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { validateStrictHtmlCompletenessProof } from "../../src/crawler/strictHtmlCompletenessProof";
import {
  createPlanBoundHtmlBrowserTraversalValidation,
  issueBGradeTraversalCertificate,
  requiresBGradeCertificateSourceId,
  verifyBGradeTraversalCertificateReceipt
} from "../../src/crawler/traversalCertificate";
import { candidateCompanies } from "../../src/data/companyRegistry";

const capturedAt = "2026-08-14T00:00:00.000Z";
const now = new Date("2026-08-14T00:05:00.000Z");

describe("plan-bound HTML B-grade traversal certificates", () => {
  it("requires an independent certificate for every registered plan-bound HTML source", () => {
    expect(PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS).toEqual([
      "source-novartis-social",
      "source-astellas-china-social",
      "source-otsuka-china-social-2",
      "source-grand-pharma-social",
      "source-huahai-social",
      "source-fosun-pharma-social",
      "source-kelun-social",
      "source-tongrentang-social",
      "source-sanofi-china-social",
      "source-takeda-china-social"
    ]);
    for (const sourceId of PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS) {
      expect(requiresBGradeCertificateSourceId(sourceId)).toBe(true);
    }
  });

  for (const sourceId of PLAN_BOUND_HTML_TRAVERSAL_SOURCE_IDS) {
    it(`issues and externally replays ${sourceId}`, async () => {
      const sourcePlan = plan(sourceId);
      const crawled = await strictMainCrawl(sourceId);
      if (!crawled.fetchEvidence || !crawled.paginationEvaluation || !crawled.reconciliation) {
        throw new Error(`Expected strict main evidence: ${JSON.stringify(crawled)}`);
      }
      expect(crawled.status, JSON.stringify(crawled)).toBe("SUCCESS");
      if (!isTalentbrewSource(sourceId)) expect(crawled.truth.completenessVerified).toBe(true);
      expect(validateStrictHtmlCompletenessProof(sourcePlan, crawled.fetchEvidence),
        JSON.stringify(crawled.fetchEvidence)).toBe(true);
      const matchKeys = crawled.jobs.map(buildJobDedupeKey);
      const browserPages = sourceId === "source-novartis-social"
        ? novartisBrowserPages(matchKeys)
        : sourceId === "source-astellas-china-social"
          ? [astellasBrowserPage(matchKeys)]
          : isTalentbrewSource(sourceId)
            ? talentbrewBrowserPages(sourceId, crawled.jobs)
          : [{ pageNumber: 1, declaredTotalPages: 1, matchKeys, nextControlPresent: false }];
      const validation = createPlanBoundHtmlBrowserTraversalValidation({
        sourceId,
        companyId: sourcePlan.company.id,
        sourceConfigSha256: sourcePlanConfigSha256(sourcePlan),
        surfaceIds: [sourcePlan.source.surfaceId!],
        channelIds: sourcePlan.expectedChannels!.map(({ channelId }) => channelId),
        pages: browserPages,
        observedAt: capturedAt,
        expiresAt: "2026-08-20T00:00:00.000Z"
      });
      const decision = issueBGradeTraversalCertificate({
        binding: {
          releaseCandidateId: "rc-html-1",
          batchId: "batch-html-1",
          sourceResultId: `result-${sourceId}`,
          sourceConfigSha256: sourcePlanConfigSha256(sourcePlan)
        },
        plan: sourcePlan,
        transportSuccess: true,
        adapterSuccess: true,
        evidence: crawled.fetchEvidence,
        paginationEvaluation: crawled.paginationEvaluation,
        reconciliation: crawled.reconciliation,
        jobs: crawled.jobs,
        independentValidation: validation,
        validationExecution: "CURRENT_RUN",
        trigger: "INITIAL_QUALIFICATION",
        now
      });
      expect(decision.status, JSON.stringify(decision)).toBe("CERTIFIED");
      if (decision.status !== "CERTIFIED") throw new Error("Expected a B-grade certificate");
      expect(verifyBGradeTraversalCertificateReceipt({
        certificate: decision.certificate,
        certificateSha256: decision.certificateSha256,
        expected: {
          releaseCandidateId: "rc-html-1",
          batchId: "batch-html-1",
          sourceResultId: `result-${sourceId}`,
          sourceId,
          companyId: sourcePlan.company.id,
          sourceConfigSha256: sourcePlanConfigSha256(sourcePlan),
          surfaceIds: [sourcePlan.source.surfaceId!],
          channelIds: sourcePlan.expectedChannels!.map(({ channelId }) => channelId),
          canonicalJobSetSha256: crawled.reconciliation.outputJobKeySetSha256,
          adapterReconciliationSha256: crawled.reconciliation.ledgerSha256
        },
        now
      })).toMatchObject({ status: "PASS", grade: "B", sourceId });
      expect(() => verifyBGradeTraversalCertificateReceipt({
        certificate: decision.certificate,
        certificateSha256: decision.certificateSha256,
        expected: {
          releaseCandidateId: "rc-html-1",
          batchId: "batch-html-1",
          sourceResultId: `result-${sourceId}`,
          sourceId,
          companyId: sourcePlan.company.id,
          sourceConfigSha256: sourcePlanConfigSha256(sourcePlan),
          canonicalJobSetSha256: "f".repeat(64)
        },
        now
      })).toThrow();
    });
  }

  it("certifies the exact Novartis sliding-window duplicates as deterministic dedupe", async () => {
    const sourceId = "source-novartis-social";
    const sourcePlan = plan(sourceId);
    const crawled = await strictMainCrawl(sourceId);
    if (!crawled.fetchEvidence || !crawled.paginationEvaluation || !crawled.reconciliation) {
      throw new Error("Expected strict Novartis main evidence");
    }
    const browserPages = novartisBrowserPages(crawled.jobs.map(buildJobDedupeKey));
    const validation = createPlanBoundHtmlBrowserTraversalValidation({
      sourceId,
      companyId: sourcePlan.company.id,
      sourceConfigSha256: sourcePlanConfigSha256(sourcePlan),
      surfaceIds: [sourcePlan.source.surfaceId!],
      channelIds: sourcePlan.expectedChannels!.map(({ channelId }) => channelId),
      pages: browserPages,
      observedAt: capturedAt,
      expiresAt: "2026-08-20T00:00:00.000Z"
    });
    const decision = issueBGradeTraversalCertificate({
      binding: {
        releaseCandidateId: "rc-html-overlap", batchId: "batch-html-overlap",
        sourceResultId: "result-html-overlap", sourceConfigSha256: sourcePlanConfigSha256(sourcePlan)
      },
      plan: sourcePlan,
      transportSuccess: true,
      adapterSuccess: true,
      evidence: crawled.fetchEvidence,
      paginationEvaluation: crawled.paginationEvaluation,
      reconciliation: crawled.reconciliation,
      jobs: crawled.jobs,
      independentValidation: validation,
      validationExecution: "CURRENT_RUN",
      trigger: "INITIAL_QUALIFICATION",
      now
    });
    expect(decision.status, JSON.stringify(decision)).toBe("CERTIFIED");
    if (decision.status !== "CERTIFIED") throw new Error("Expected a B-grade certificate");
    expect(decision.certificate.counts.dedupeDiscardCount).toBe(2);
    expect(verifyBGradeTraversalCertificateReceipt({
      certificate: decision.certificate,
      certificateSha256: decision.certificateSha256,
      expected: {
        releaseCandidateId: "rc-html-overlap", batchId: "batch-html-overlap",
        sourceResultId: "result-html-overlap", sourceId,
        companyId: sourcePlan.company.id,
        sourceConfigSha256: sourcePlanConfigSha256(sourcePlan),
        canonicalJobSetSha256: crawled.reconciliation.outputJobKeySetSha256,
        adapterReconciliationSha256: crawled.reconciliation.ledgerSha256
      },
      now
    })).toMatchObject({ status: "PASS", finalUniqueJobCount: 6 });
  });

  it("rejects a one-page Novartis UI set that erases the main duplicate-key multiplicities", async () => {
    const sourceId = "source-novartis-social";
    const sourcePlan = plan(sourceId);
    const crawled = await strictMainCrawl(sourceId);
    if (!crawled.fetchEvidence || !crawled.paginationEvaluation || !crawled.reconciliation) {
      throw new Error("Expected strict Novartis main evidence");
    }
    const matchKeys = crawled.jobs.map(buildJobDedupeKey);
    const validation = createPlanBoundHtmlBrowserTraversalValidation({
      sourceId,
      companyId: sourcePlan.company.id,
      sourceConfigSha256: sourcePlanConfigSha256(sourcePlan),
      surfaceIds: [sourcePlan.source.surfaceId!],
      channelIds: sourcePlan.expectedChannels!.map(({ channelId }) => channelId),
      pages: [{ pageNumber: 1, declaredTotalPages: 1, matchKeys, rawMatchKeys: matchKeys,
        nextControlPresent: false }],
      observedAt: capturedAt,
      expiresAt: "2026-08-20T00:00:00.000Z"
    });
    expect(issueBGradeTraversalCertificate({
      binding: { releaseCandidateId: "rc-html-forged", batchId: "batch-html-forged",
        sourceResultId: "result-html-forged", sourceConfigSha256: sourcePlanConfigSha256(sourcePlan) },
      plan: sourcePlan,
      transportSuccess: true,
      adapterSuccess: true,
      evidence: crawled.fetchEvidence,
      paginationEvaluation: crawled.paginationEvaluation,
      reconciliation: crawled.reconciliation,
      jobs: crawled.jobs,
      independentValidation: validation,
      validationExecution: "CURRENT_RUN",
      trigger: "INITIAL_QUALIFICATION",
      now
    })).toMatchObject({
      status: "REJECTED",
      blockerCodes: expect.arrayContaining(["INDEPENDENT_JOB_SET_MISMATCH"])
    });
  });

  it("rejects multi-page claims for static HTML sources and incomplete Astellas partition proofs", () => {
    const staticSourceId = "source-otsuka-china-social-2";
    const staticPlan = plan(staticSourceId);
    const staticKey = buildJobDedupeKey(job(staticSourceId));
    expect(() => createPlanBoundHtmlBrowserTraversalValidation({
      sourceId: staticSourceId,
      companyId: staticPlan.company.id,
      sourceConfigSha256: sourcePlanConfigSha256(staticPlan),
      surfaceIds: [staticPlan.source.surfaceId!],
      channelIds: staticPlan.expectedChannels!.map(({ channelId }) => channelId),
      pages: [
        { pageNumber: 1, declaredTotalPages: 2, matchKeys: [staticKey], nextControlPresent: true },
        { pageNumber: 2, declaredTotalPages: 2, matchKeys: [`${staticKey}-two`], nextControlPresent: false }
      ],
      observedAt: capturedAt,
      expiresAt: "2026-08-20T00:00:00.000Z"
    })).toThrow("page limit mismatch");

    const astellasPlan = plan("source-astellas-china-social");
    const astellasKeys = ["one", "two", "three"].map((id) => `source-astellas-china-social:${id}`);
    expect(() => createPlanBoundHtmlBrowserTraversalValidation({
      sourceId: "source-astellas-china-social",
      companyId: astellasPlan.company.id,
      sourceConfigSha256: sourcePlanConfigSha256(astellasPlan),
      surfaceIds: [astellasPlan.source.surfaceId!],
      channelIds: astellasPlan.expectedChannels!.map(({ channelId }) => channelId),
      pages: [{
        pageNumber: 1,
        declaredTotalPages: 1,
        matchKeys: astellasKeys,
        rawMatchKeys: astellasKeys,
        partitions: [
          { controlIndex: 1, controlId: "shared", matchKeys: [astellasKeys[0]!] },
          { controlIndex: 2, controlId: "shared", matchKeys: [astellasKeys[1]!] },
          { controlIndex: 3, controlId: "panel-3", matchKeys: [astellasKeys[2]!] }
        ],
        nextControlPresent: false
      }],
      observedAt: capturedAt,
      expiresAt: "2026-08-20T00:00:00.000Z"
    })).toThrow("partition proof mismatch");
  });

  it("rejects incomplete or internally inconsistent TalentBrew partition proofs", () => {
    const sourceId = "source-sanofi-china-social" as const;
    const sourcePlan = plan(sourceId);
    const common = {
      sourceId,
      companyId: sourcePlan.company.id,
      sourceConfigSha256: sourcePlanConfigSha256(sourcePlan),
      surfaceIds: [sourcePlan.source.surfaceId!],
      channelIds: sourcePlan.expectedChannels!.map(({ channelId }) => channelId),
      observedAt: capturedAt,
      expiresAt: "2026-08-20T00:00:00.000Z"
    };
    expect(() => createPlanBoundHtmlBrowserTraversalValidation({
      ...common,
      pages: [{ channelId: "employment-fixed-term", pageNumber: 1, declaredTotalPages: 1,
        declaredTotalJobs: 1, matchKeys: [`${sourceId}:1`], rawMatchKeys: [`${sourceId}:1`],
        nextControlPresent: false }]
    })).toThrow("partition order mismatch");
    expect(() => createPlanBoundHtmlBrowserTraversalValidation({
      ...common,
      pages: [
        { channelId: "employment-fixed-term", pageNumber: 1, declaredTotalPages: 1,
          declaredTotalJobs: 2, matchKeys: [`${sourceId}:1`], rawMatchKeys: [`${sourceId}:1`],
          nextControlPresent: false },
        { channelId: "employment-regular", pageNumber: 1, declaredTotalPages: 1,
          declaredTotalJobs: 1, matchKeys: [`${sourceId}:2`], rawMatchKeys: [`${sourceId}:2`],
          nextControlPresent: false }
      ]
    })).toThrow("partition total mismatch");
    expect(() => createPlanBoundHtmlBrowserTraversalValidation({
      ...common,
      pages: [
        { channelId: "employment-fixed-term", pageNumber: 1, declaredTotalPages: 1,
          declaredTotalJobs: 0, matchKeys: [], rawMatchKeys: [], nextControlPresent: false },
        { channelId: "employment-regular", pageNumber: 1, declaredTotalPages: 1,
          declaredTotalJobs: 1, matchKeys: [`${sourceId}:2`], rawMatchKeys: [`${sourceId}:2`],
          nextControlPresent: false }
      ]
    })).not.toThrow();
  });

  it("accepts a complete Grand Pharma social partition when the campus partition is empty", async () => {
    const grand = readFileSync(resolve(process.cwd(),
      "src/crawler/fixtures/static-official-sources/grand.html"), "utf8")
      .split(/\r?\n/u).filter((line) => !line.includes("schooldetail.html")).join("\n");
    const crawled = await strictMainCrawl("source-grand-pharma-social", grand);
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { completenessVerified: true }
    });
  });

  it("rejects a self-consistent generic artifact that did not pass the source-bound HTML replay", () => {
    const sourceId = "source-huahai-social";
    const sourcePlan = plan(sourceId);
    const output = job(sourceId);
    const evidence = evidenceFor(sourceId);
    const reconciled = reconcileAdapterRows(1, 1, [output], []);
    const validation = createPlanBoundHtmlBrowserTraversalValidation({
      sourceId, companyId: sourcePlan.company.id, sourceConfigSha256: sourcePlanConfigSha256(sourcePlan),
      surfaceIds: [sourcePlan.source.surfaceId!],
      channelIds: sourcePlan.expectedChannels!.map(({ channelId }) => channelId),
      pages: [{ pageNumber: 1, declaredTotalPages: 1,
        matchKeys: [buildJobDedupeKey(output)], nextControlPresent: false }],
      observedAt: capturedAt, expiresAt: "2026-08-20T00:00:00.000Z"
    });
    expect(issueBGradeTraversalCertificate({
      binding: { releaseCandidateId: "rc-fake", batchId: "batch-fake", sourceResultId: "result-fake",
        sourceConfigSha256: sourcePlanConfigSha256(sourcePlan) },
      plan: sourcePlan, transportSuccess: true, adapterSuccess: true, evidence,
      paginationEvaluation: evaluatePaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true }),
      reconciliation: reconciled.reconciliation, jobs: reconciled.jobs, independentValidation: validation,
      validationExecution: "CURRENT_RUN", trigger: "INITIAL_QUALIFICATION", now
    })).toMatchObject({ status: "REJECTED", blockerCodes: expect.arrayContaining(["MAIN_TRAVERSAL_INCOMPLETE"]) });
  });

  it("does not let a plan-bound source bypass the main proof through an adapter-type rewrite", async () => {
    const sourceId = "source-huahai-social";
    const originalPlan = plan(sourceId);
    const crawled = await strictMainCrawl(sourceId);
    if (!crawled.fetchEvidence || !crawled.paginationEvaluation || !crawled.reconciliation) {
      throw new Error("Expected strict Huahai main evidence");
    }
    const forgedPlan = {
      ...originalPlan,
      adapterId: "official-json",
      json: {
        jobsPath: "jobs",
        fields: {
          sourceJobId: "sourceJobId",
          officialTitle: "officialTitle",
          officialUrl: "officialUrl",
          locationRaw: "locationRaw",
          cities: "cities"
        }
      }
    } as unknown as SourceCrawlPlan;
    const sourceConfigSha256 = sourcePlanConfigSha256(forgedPlan);
    const matchKeys = crawled.jobs.map(buildJobDedupeKey);
    const validation = createPlanBoundHtmlBrowserTraversalValidation({
      sourceId,
      companyId: originalPlan.company.id,
      sourceConfigSha256,
      surfaceIds: [originalPlan.source.surfaceId!],
      channelIds: originalPlan.expectedChannels!.map(({ channelId }) => channelId),
      pages: [{ pageNumber: 1, declaredTotalPages: 1, matchKeys, nextControlPresent: false }],
      observedAt: capturedAt,
      expiresAt: "2026-08-20T00:00:00.000Z"
    });
    expect(issueBGradeTraversalCertificate({
      binding: { releaseCandidateId: "rc-adapter-forge", batchId: "batch-adapter-forge",
        sourceResultId: "result-adapter-forge", sourceConfigSha256 },
      plan: forgedPlan,
      transportSuccess: true,
      adapterSuccess: true,
      evidence: crawled.fetchEvidence,
      paginationEvaluation: crawled.paginationEvaluation,
      reconciliation: crawled.reconciliation,
      jobs: crawled.jobs,
      independentValidation: validation,
      validationExecution: "CURRENT_RUN",
      trigger: "INITIAL_QUALIFICATION",
      now
    })).toMatchObject({
      status: "REJECTED",
      blockerCodes: expect.arrayContaining(["MAIN_TRAVERSAL_INCOMPLETE"])
    });
  });

  it("rejects dedupe collisions for a static HTML policy", () => {
    const sourceId = "source-otsuka-china-social-2";
    const sourcePlan = plan(sourceId);
    const output = job(sourceId);
    const evidence = evidenceFor(sourceId, [["raw-first", "raw-second"]]);
    const reconciled = reconcileAdapterRows(2, 2, [output, output], []);
    const validation = createPlanBoundHtmlBrowserTraversalValidation({
      sourceId,
      companyId: sourcePlan.company.id,
      sourceConfigSha256: sourcePlanConfigSha256(sourcePlan),
      surfaceIds: [sourcePlan.source.surfaceId!],
      channelIds: sourcePlan.expectedChannels!.map(({ channelId }) => channelId),
      pages: [{ pageNumber: 1, declaredTotalPages: 1,
        matchKeys: [buildJobDedupeKey(output)], nextControlPresent: false }],
      observedAt: capturedAt,
      expiresAt: "2026-08-20T00:00:00.000Z"
    });
    expect(issueBGradeTraversalCertificate({
      binding: {
        releaseCandidateId: "rc-static-collision", batchId: "batch-static-collision",
        sourceResultId: "result-static-collision", sourceConfigSha256: sourcePlanConfigSha256(sourcePlan)
      },
      plan: sourcePlan,
      transportSuccess: true,
      adapterSuccess: true,
      evidence,
      paginationEvaluation: evaluatePaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true }),
      reconciliation: reconciled.reconciliation,
      jobs: reconciled.jobs,
      independentValidation: validation,
      validationExecution: "CURRENT_RUN",
      trigger: "INITIAL_QUALIFICATION",
      now
    })).toMatchObject({ status: "REJECTED", blockerCodes: expect.arrayContaining(["OUTPUT_MISMATCH"]) });
  });
});

function plan(sourceId: PlanBoundHtmlTraversalSourceId) {
  const value = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), sourceId);
  if (value?.adapterId !== "html-table") throw new Error(`Expected HTML plan ${sourceId}`);
  return value;
}

async function strictMainCrawl(sourceId: PlanBoundHtmlTraversalSourceId, staticBodyOverride?: string) {
  const sourcePlan = plan(sourceId);
  if (isTalentbrewSource(sourceId)) return talentbrewMainCrawl(sourceId, sourcePlan);
  const bodies = sourceId === "source-novartis-social"
    ? [novartisPage(1, ["a", "b", "c"]), novartisPage(2, ["c", "d", "e"]), novartisPage(3, ["e", "f"])]
    : [sourceId === "source-astellas-china-social"
        ? astellasHtml()
        : staticBodyOverride ?? ({
            "source-fosun-pharma-social": fosunHtml(),
            "source-kelun-social": kelunHtml(),
            "source-tongrentang-social": tongrentangHtml()
          } as Partial<Record<PlanBoundHtmlTraversalSourceId, string>>)[sourceId] ?? readFileSync(resolve(
            process.cwd(), `src/crawler/fixtures/static-official-sources/${({
              "source-otsuka-china-social-2": "otsuka-group.html",
              "source-grand-pharma-social": "grand.html",
              "source-huahai-social": "huahai.html"
            } as Partial<Record<PlanBoundHtmlTraversalSourceId, string>>)[sourceId]}`
          ), "utf8")];
  let index = 0;
  const fetch = createHttpHtmlSourceFetch({
    now: () => new Date(capturedAt),
    http: async (request: HttpHtmlRequest) => ({
      status: 200,
      body: bodies[index++]!,
      finalUrl: request.url,
      contentType: "text/html; charset=utf-8",
      capturedAt
    })
  });
  return runSourceCrawl(sourcePlan, { fetch, isBaseline: true });
}

function isTalentbrewSource(sourceId: PlanBoundHtmlTraversalSourceId): sourceId is
  "source-sanofi-china-social" | "source-takeda-china-social" {
  return sourceId === "source-sanofi-china-social" || sourceId === "source-takeda-china-social";
}

async function talentbrewMainCrawl(
  sourceId: "source-sanofi-china-social" | "source-takeda-china-social",
  sourcePlan: ReturnType<typeof plan>
) {
  const scope = sourcePlan.table.pagination?.talentbrewScope;
  if (!scope) throw new Error("Expected TalentBrew scope");
  const entry = `<section id="search-results" data-ajax-url="/results" data-facet-term="1814991" ` +
    `data-facet-type="2" data-current-page="1" data-total-pages="1" ` +
    `data-total-job-results="${scope.allowedPartitions.length + (scope.excludedPartitions?.length ?? 0)}" ` +
    `data-records-per-page="15"></section><div id="search-filters">` +
    `<div data-enabled="false"><input class="filter-checkbox" checked data-id="1814991" data-facet-type="2" ` +
    `data-count="${scope.allowedPartitions.length + (scope.excludedPartitions?.length ?? 0)}" ` +
    `data-display="China" data-field-name="" /></div>` +
    [...scope.allowedPartitions, ...(scope.excludedPartitions ?? [])].map((partition) =>
      `<div data-enabled="true"><input class="filter-checkbox" data-id="${partition.id}" ` +
      `data-facet-type="${partition.facetType}" data-count="1" data-display="${partition.descriptor}" ` +
      `data-field-name="${partition.fieldName}" /></div>`
    ).join("") + `</div>`;
  const partitionByDescriptor = new Map(scope.allowedPartitions.map((partition, index) =>
    [partition.descriptor, { partition, index }]));
  const fetch = createHttpHtmlSourceFetch({
    now: () => new Date(capturedAt),
    http: async (request: HttpHtmlRequest) => {
      if (!request.url.includes("/results")) {
        return { status: 200, body: entry, finalUrl: request.url,
          contentType: "text/html; charset=utf-8", capturedAt };
      }
      const url = new URL(request.url);
      const descriptor = [...url.searchParams.entries()].find(([key]) =>
        key.startsWith("FacetFilters[1]") && key.endsWith(".Display"))?.[1];
      const selected = descriptor ? partitionByDescriptor.get(descriptor) : undefined;
      if (!selected) throw new Error(`Unexpected TalentBrew partition ${descriptor}`);
      const id = String(80_000 + selected.index);
      const officialUrl = sourceId === "source-sanofi-china-social"
        ? `https://jobs.sanofi.com/en/job/shanghai/role-${selected.index}/2649/${id}`
        : `https://jobs.takeda.com/job/shanghai/role-${selected.index}/1113/${id}`;
      const titleClass = sourceId === "source-takeda-china-social" ? ` class="title"` : "";
      const locationClass = sourceId === "source-takeda-china-social" ? "location" : "job-location";
      const results = `<section id="search-results" data-current-page="1" data-total-pages="1" ` +
        `data-total-job-results="1" data-records-per-page="15"><ul id="search-results-list"><li>` +
        `<button class="js-save-job-btn" data-job-id="${id}"></button>` +
        `<a href="${officialUrl}"><h2${titleClass}>Role ${selected.index}</h2></a>` +
        `<span class="${locationClass}">上海</span></li></ul></section>`;
      return { status: 200, body: JSON.stringify({
        filters: '<section id="search-filters"><input class="filter-checkbox" /></section>',
        hasContent: false,
        hasJobs: true,
        results
      }), finalUrl: request.url,
        contentType: "application/json", capturedAt };
    }
  });
  return runSourceCrawl(sourcePlan, { fetch, isBaseline: true });
}

function talentbrewBrowserPages(
  sourceId: "source-sanofi-china-social" | "source-takeda-china-social",
  jobs: readonly NormalizedJobRecord[]
) {
  const sourcePlan = plan(sourceId);
  const partitions = sourcePlan.table.pagination?.talentbrewScope?.allowedPartitions;
  if (!partitions) throw new Error("Expected TalentBrew partitions");
  const byId = new Map(jobs.map((value) => [value.sourceJobId, buildJobDedupeKey(value)]));
  return partitions.map((partition, index) => {
    const key = byId.get(String(80_000 + index));
    if (!key) throw new Error(`Missing TalentBrew key ${partition.channelId}`);
    return {
      channelId: partition.channelId,
      pageNumber: 1,
      declaredTotalPages: 1,
      declaredTotalJobs: 1,
      matchKeys: [key],
      rawMatchKeys: [key],
      nextControlPresent: false
    };
  });
}

function fosunHtml(): string {
  return `<table><tr><td><a href="/socialxq?jobId=123">招聘岗位</a></td><td>研发</td>` +
    `<td>复星医药</td><td><a>上海市</a></td></tr></table>` +
    `<div class="page"><a href="/social/?PageIndex=1">1</a></div>`;
}

function kelunHtml(): string {
  return `<table class="jobsTable"><tr><td><a href="/job_show/123">招聘岗位</a></td>` +
    `<td>研发</td><td>科伦</td><td>1</td><td>四川省</td></tr></table>` +
    `<a href="/social/?PageIndex=1">1</a>`;
}

function tongrentangHtml(): string {
  return `<a href="https://www.tongrentang.com/menu54/newsDetail/abc123.html">公开招聘公告</a>` +
    `<div class="page">共 1 页</div>`;
}

function astellasHtml(): string {
  const section = (id: string, jobs: readonly string[]) =>
    `<button class="cmp-accordion__button" aria-controls="${id}" aria-expanded="false"></button>` +
    `<div id="${id}">${jobs.map((jobId) =>
      `<a href="/content/dam/astellas-com/global/zh/careers/${jobId}.pdf"><span>${jobId}</span></a>`
    ).join("")}</div>`;
  return `<div class="cmp-accordion" data-cmp-is="accordion">` +
    section("panel-1", ["Role One"]) + section("panel-2", ["Role Two"]) + section("panel-3", ["Role Three"]) +
    `</div>`;
}

function novartisPage(page: number, ids: readonly string[]): string {
  const total = 3;
  const controls = Array.from({ length: total }, (_value, index) => {
    const number = index + 1;
    return `<li class="page-item${number === page ? " active" : ""}"><a class="page-link" ` +
      `title="page ${number}${number === page ? " active" : ""} out of ${total} pages"` +
      `${number === page ? "" : ` href="?page=${number - 1}"`}>${number}</a></li>`;
  }).join("");
  const next = page === total
    ? `<li class="page-item pager__item--next"><a href="" title="Go to next page" rel="next" class="page-link btn disabled">Next</a></li>`
    : `<li class="page-item pager__item--next"><a href="?page=${page}" title="Go to next page" rel="next" class="page-link">Next</a></li>`;
  const rows = ids.map((id) => `<tr><td class="views-field-field-job-title"><a ` +
    `href="/careers/career-search/job/details/${id}">Role ${id}</a></td>` +
    `<td class="views-field-field-job-work-location">China</td></tr>`).join("");
  return `<table class="views-table"><tbody>${rows}</tbody></table><ul class="pagination">${controls}${next}</ul>`;
}

function novartisBrowserPages(matchKeys: readonly string[]) {
  const byId = new Map(matchKeys.map((key) => [key.split("/").at(-1), key]));
  const key = (id: string) => {
    const value = byId.get(id);
    if (!value) throw new Error(`Missing Novartis browser key ${id}`);
    return value;
  };
  return [
    { pageNumber: 1, declaredTotalPages: 3, rawMatchKeys: [key("a"), key("b"), key("c")],
      matchKeys: [key("a"), key("b"), key("c")], nextControlPresent: true },
    { pageNumber: 2, declaredTotalPages: 3, rawMatchKeys: [key("c"), key("d"), key("e")],
      matchKeys: [key("d"), key("e")], nextControlPresent: true },
    { pageNumber: 3, declaredTotalPages: 3, rawMatchKeys: [key("e"), key("f")],
      matchKeys: [key("f")], nextControlPresent: false }
  ];
}

function astellasBrowserPage(matchKeys: readonly string[]) {
  const partitions = [0, 1, 2].map((controlIndex) => ({
    controlIndex: controlIndex + 1,
    controlId: `panel-${controlIndex + 1}`,
    matchKeys: matchKeys.filter((_key, index) => index % 3 === controlIndex)
  }));
  if (partitions.some((partition) => partition.matchKeys.length === 0)) {
    throw new Error("Astellas fixture requires all three declared partitions");
  }
  return {
    pageNumber: 1,
    declaredTotalPages: 1,
    matchKeys,
    rawMatchKeys: matchKeys,
    partitions,
    nextControlPresent: false
  };
}

function job(sourceId: PlanBoundHtmlTraversalSourceId, suffix = "test-role"): NormalizedJobRecord {
  const sourcePlan = plan(sourceId);
  const sourceJobId = sourceId === "source-novartis-social"
    ? undefined
    : sourceId === "source-astellas-china-social"
      ? suffix
      : `html:sha256:${createHash("sha256").update(`Role ${suffix}\u001f上海`, "utf8").digest("hex")}`;
  const officialUrl = sourceId === "source-novartis-social"
    ? `https://prod1.novartis.com/careers/career-search/job/details/req-${suffix}`
    : sourceId === "source-astellas-china-social"
      ? `https://www.astellas.com/content/dam/astellas-com/global/zh/${suffix}.pdf`
      : sourcePlan.source.officialEntryUrl;
  return {
    companyId: sourcePlan.company.id,
    sourceId,
    sourceKind: "SOCIAL",
    atsKind: sourcePlan.source.atsKind,
    officialChineseCompanyName: sourcePlan.company.officialChineseName,
    officialTitle: `Role ${suffix}`,
    officialUrl,
    listUrl: sourcePlan.source.officialEntryUrl,
    ...(sourceJobId ? { sourceJobId } : {}),
    locationRaw: "上海",
    cities: ["上海"],
    category: "其他",
    isBaseline: false,
    evidence: { officialEntryUrl: sourcePlan.source.officialEntryUrl, capturedAt }
  };
}

function evidenceFor(
  sourceId: PlanBoundHtmlTraversalSourceId,
  idsByPage: readonly string[][] = [["raw-1"]]
): PersistentSourceFetchEvidence {
  const sourcePlan = plan(sourceId);
  const declarationKind = sourcePlan.table.completenessProof?.kind === "OFFICIAL_TOTAL_PAGES"
    ? "OFFICIAL_TOTAL_PAGES" as const
    : "COMPLETE_PAGE_TRAVERSAL" as const;
  return deriveCanonicalPaginationEvidence({
    evidence: {
      captureTool: { name: "http-html", version: "1" },
      artifacts: idsByPage.map((ids, index) => ({
        id: `page-${index}`, logicalKey: `page-${index}`, kind: "OFFICIAL_COMPANY_PAGE" as const,
        requestedUrl: sourcePlan.source.officialEntryUrl, finalUrl: sourcePlan.source.officialEntryUrl,
        httpStatus: 200, contentType: "text/html", capturedAt,
        body: JSON.stringify(ids), extractorLocator: "html:plan-bound-test"
      })),
      pages: idsByPage.map((ids, index) => ({
        sequence: index, artifactLogicalKey: `page-${index}`, requestedPage: index + 1, returnedPage: index + 1,
        requestedPageSize: null, returnedPageSize: null, requestedOffset: null, returnedOffset: null,
        rawJobIds: [...ids], validJobIds: [...ids], declaredTotal: null, declaredCount: null,
        declaredPages: idsByPage.length,
        nextPageSignalBefore: index === 0 ? null : `page-${index + 1}`,
        nextPageSignalAfter: index === idsByPage.length - 1 ? null : `page-${index + 2}`,
        responseFingerprintSha256: sha256Bytes(Buffer.from(JSON.stringify(ids))).sha256,
        termination: (index === idsByPage.length - 1 ? "NEXT_ABSENT" : "CONTINUE") as "NEXT_ABSENT" | "CONTINUE",
        anomalyCodes: [], capturedAt
      })),
      declaredCompleteness: {
        kind: declarationKind, value: idsByPage.length, artifactLogicalKey: "page-0",
        extractorLocator: "html:plan-bound-test", scope: "SOURCE"
      },
      fetchCounts: {
        rawCount: idsByPage.flat().length, parsedCount: idsByPage.flat().length,
        validCount: idsByPage.flat().length, parseDiscardCount: 0, validationDiscardCount: 0
      },
      fetchLosses: []
    },
    expectedChannelIds: [],
    filteredOutput: true,
    ...(sourceId === "source-novartis-social" ? { allowRawIdOverlapAcrossPages: true } : {})
  });
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
