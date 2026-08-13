import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { reconcileAdapterRows } from "../../src/crawler/adapters/reconciliation";
import type { NormalizedJobRecord } from "../../src/crawler/normalizedJob";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import { getPlanBySourceId, buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { sha256Bytes, type PersistentSourceFetchEvidence } from "../../src/crawler/sourceFetchEvidence";
import { createHttpHtmlSourceFetch } from "../../src/crawler/httpHtmlSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import {
  issueAGradeOfficialTotalCertificate,
  verifyAGradeCompletenessCertificateReceipt
} from "../../src/crawler/completenessCertificate";

const capturedAt = "2026-08-12T12:00:00.000Z";
const officialArtifactSha256 = "a".repeat(64);

function gskPlan() {
  const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-gsk-china-social");
  if (plan?.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "phenom") {
    throw new Error("Expected staged GSK plan");
  }
  return plan;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

function job(sourceJobId: string, suffix = ""): NormalizedJobRecord {
  return {
    companyId: "company-gsk-china",
    sourceId: "source-gsk-china-social",
    sourceKind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    officialChineseCompanyName: "葛兰素史克中国",
    officialTitle: `Medical role ${sourceJobId}`,
    officialUrl: `https://jobs.gsk.com/gb/en/job/${sourceJobId}${suffix}`,
    sourceJobId,
    locationRaw: "Shanghai, China",
    cities: ["上海"],
    category: "医学事务",
    isBaseline: false,
    evidence: {
      officialEntryUrl: "https://jobs.gsk.com/cn/zh/search-results?keywords=China",
      capturedAt
    }
  };
}

function evidence(officialTotal: number, rawUniqueIds: string[], rawCount = rawUniqueIds.length): PersistentSourceFetchEvidence {
  return {
    captureTool: { name: "test", version: "1" },
    artifacts: [{
      id: "artifact-1",
      logicalKey: "phenom-page-0000",
      kind: "ATS_API_RESPONSE",
      requestedUrl: "https://jobs.gsk.com/widget-api",
      finalUrl: "https://jobs.gsk.com/widget-api",
      httpStatus: 200,
      contentType: "application/json",
      capturedAt,
      body: "{}",
      extractorLocator: "phenom-page-v1|selected_fields:china|json:$.refineSearch.totalHits"
    }],
    pages: [{
      sequence: 0,
      artifactLogicalKey: "phenom-page-0000",
      requestedOffset: 0,
      returnedOffset: 0,
      requestedPageSize: 50,
      rawJobIds: rawUniqueIds,
      validJobIds: rawUniqueIds,
      declaredTotal: officialTotal,
      nextPageSignalBefore: null,
      nextPageSignalAfter: null,
      responseFingerprintSha256: sha256Bytes(Buffer.from("{}", "utf8")).sha256,
      termination: "NEXT_ABSENT",
      anomalyCodes: [],
      capturedAt
    }],
    declaredCompleteness: {
      kind: "OFFICIAL_TOTAL_COUNT",
      value: officialTotal,
      artifactLogicalKey: "phenom-page-0000",
      extractorLocator: "phenom-page-v1|selected_fields:china|json:$.refineSearch.totalHits",
      scope: "SOURCE"
    },
    fetchCounts: {
      rawCount,
      parsedCount: rawCount,
      validCount: rawCount,
      parseDiscardCount: 0,
      validationDiscardCount: 0
    },
    fetchLosses: []
  };
}

function candidate(input: {
  officialTotal: number;
  jobs: NormalizedJobRecord[];
  rawUniqueIds?: string[];
  rawCount?: number;
  plan?: ReturnType<typeof gskPlan>;
}) {
  const plan = input.plan ?? gskPlan();
  const rawUniqueIds = input.rawUniqueIds ?? input.jobs.map((value) => `raw-${value.sourceJobId}`);
  const fetchEvidence = deriveCanonicalPaginationEvidence({
    evidence: evidence(input.officialTotal, rawUniqueIds, input.rawCount),
    expectedChannelIds: [],
    filteredOutput: true,
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
  });
  const reconciled = reconcileAdapterRows(input.rawCount ?? rawUniqueIds.length, input.rawCount ?? rawUniqueIds.length, input.jobs, []);
  return {
    binding: {
      releaseCandidateId: "rc-1",
      batchId: "batch-1",
      sourceResultId: "result-1",
      sourceConfigSha256: sourcePlanConfigSha256(plan)
    },
    plan,
    transportSuccess: true,
    adapterSuccess: true,
    evidence: fetchEvidence,
    paginationEvaluation: evaluatePaginationEvidence({
      evidence: fetchEvidence,
      expectedChannelIds: [],
      filteredOutput: true,
      allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
    }),
    reconciliation: reconciled.reconciliation,
    jobs: reconciled.jobs,
    officialArtifactSha256
  };
}

describe("A-grade official-total completeness certificate", () => {
  it("issues A grade for a lossless plan-bound HTML official total", async () => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-csl-china-social");
    if (plan?.adapterId !== "html-table") throw new Error("Expected staged CSL HTML plan");
    const fetch = createHttpHtmlSourceFetch({
      now: () => new Date(capturedAt),
      http: async request => ({
        status: 200,
        body: `<main>Showing 1 to 1 of 1 results
          <a href="https://jobs.csl.com/en/jobs/123"><p class="text-18">Medical Lead</p>
          <p><svg aria-hidden="true"></svg>Shanghai, China</p></a></main>`,
        finalUrl: request.url,
        contentType: "text/html; charset=utf-8",
        capturedAt
      })
    });
    const crawl = await runSourceCrawl(plan, { fetch });
    if (!crawl.fetchEvidence || !crawl.paginationEvaluation || !crawl.reconciliation) {
      throw new Error("Expected exact HTML crawl evidence");
    }
    expect(crawl.truth.completenessVerified).toBe(true);
    const decision = issueAGradeOfficialTotalCertificate({
      binding: {
        releaseCandidateId: "rc-html",
        batchId: "batch-html",
        sourceResultId: "result-html",
        sourceConfigSha256: sourcePlanConfigSha256(plan)
      },
      plan,
      transportSuccess: crawl.truth.transportSuccess,
      adapterSuccess: crawl.truth.adapterSuccess,
      evidence: crawl.fetchEvidence,
      paginationEvaluation: crawl.paginationEvaluation,
      reconciliation: crawl.reconciliation,
      jobs: crawl.jobs,
      officialArtifactSha256
    });
    expect(decision.status, JSON.stringify(decision)).toBe("CERTIFIED");
    expect(decision).toMatchObject({
      certificate: {
        grade: "A",
        scope: { companyId: "company-csl-china", sourceId: "source-csl-china-social" },
        counts: { officialTotal: 1, finalUniqueJobCount: 1 }
      }
    });
  });

  it("issues and verifies an exact same-scope certificate Receipt", () => {
    const decision = issueAGradeOfficialTotalCertificate(candidate({
      officialTotal: 2,
      jobs: [job("GSK-1"), job("GSK-2")]
    }));
    expect(decision.status, JSON.stringify(decision)).toBe("CERTIFIED");
    expect(decision).toMatchObject({
      status: "CERTIFIED",
      certificate: {
        grade: "A",
        scope: { companyId: "company-gsk-china", geography: "MAINLAND_CHINA" },
        counts: { officialTotal: 2, rawUniqueOfficialRecordCount: 2, finalUniqueJobCount: 2 }
      }
    });
    if (decision.status !== "CERTIFIED") throw new Error("Expected certificate");
    expect(verifyAGradeCompletenessCertificateReceipt({
      certificate: decision.certificate,
      certificateSha256: decision.certificateSha256,
      expected: {
        releaseCandidateId: "rc-1",
        batchId: "batch-1",
        sourceResultId: "result-1",
        sourceId: "source-gsk-china-social",
        companyId: "company-gsk-china",
        sourceConfigSha256: sourcePlanConfigSha256(gskPlan())
      }
    })).toMatchObject({ status: "PASS", grade: "A", finalUniqueJobCount: 2 });
    expect(() => verifyAGradeCompletenessCertificateReceipt({
      certificate: decision.certificate,
      certificateSha256: decision.certificateSha256,
      expected: {
        releaseCandidateId: "rc-1",
        batchId: "batch-1",
        sourceResultId: "result-1",
        sourceId: "source-gsk-china-social",
        companyId: "company-gsk-china",
        sourceConfigSha256: sourcePlanConfigSha256(gskPlan()),
        surfaceIds: ["wrong-surface"],
        officialArtifactLogicalKey: "phenom-page-0000",
        officialArtifactSha256
      }
    })).toThrow(/surface scope mismatch/i);

    const wrongCompany = structuredClone(decision.certificate);
    wrongCompany.scope.companyId = "company-abbvie-china";
    const wrongCompanySha256 = sha256Bytes(Buffer.from(canonicalJson(wrongCompany), "utf8")).sha256;
    expect(() => verifyAGradeCompletenessCertificateReceipt({
      certificate: wrongCompany,
      certificateSha256: wrongCompanySha256,
      expected: {
        releaseCandidateId: "rc-1",
        batchId: "batch-1",
        sourceResultId: "result-1",
        sourceId: "source-gsk-china-social",
        sourceConfigSha256: sourcePlanConfigSha256(gskPlan())
      }
    })).toThrow(/binding mismatch/i);
  });

  it("fails closed when an official total of 100 only yields 10 unique jobs", () => {
    const jobs = Array.from({ length: 10 }, (_, index) => job(`GSK-${index}`));
    expect(issueAGradeOfficialTotalCertificate(candidate({ officialTotal: 100, jobs })))
      .toMatchObject({ status: "REJECTED", blockerCodes: expect.arrayContaining(["OFFICIAL_TOTAL_MISMATCH"]) });
  });

  it("does not use a global or differently filtered total to certify mainland output", () => {
    const global = candidate({ officialTotal: 1, jobs: [job("GSK-1")] });
    global.evidence.declaredCompleteness!.scope = "GLOBAL_UNFILTERED";
    expect(issueAGradeOfficialTotalCertificate(global))
      .toMatchObject({ status: "REJECTED", blockerCodes: expect.arrayContaining(["SCOPE_MISMATCH"]) });

    const differentFilter = gskPlan();
    const phenomConfig = differentFilter.officialJsonFetch;
    if (phenomConfig?.kind !== "phenom") throw new Error("Expected Phenom config");
    differentFilter.officialJsonFetch = { ...phenomConfig, countryFilter: "Singapore" };
    expect(issueAGradeOfficialTotalCertificate(candidate({
      officialTotal: 1,
      jobs: [job("GSK-1")],
      plan: differentFilter
    }))).toMatchObject({ status: "REJECTED", blockerCodes: expect.arrayContaining(["SCOPE_MISMATCH"]) });
  });

  it("allows only auditable deterministic legal duplicates", () => {
    const { sourceJobId: _firstSourceJobId, ...duplicateA } = job("GSK-1");
    const { sourceJobId: _secondSourceJobId, ...duplicateBase } = job("GSK-1");
    const duplicateB = { ...duplicateBase, officialTitle: "Medical role GSK-1 alternate representation" };
    const decision = issueAGradeOfficialTotalCertificate(candidate({
      officialTotal: 2,
      jobs: [duplicateA, duplicateB],
      rawUniqueIds: ["raw-GSK-1-a", "raw-GSK-1-b"],
      rawCount: 2
    }));
    expect(decision.status, JSON.stringify(decision)).toBe("CERTIFIED");
    expect(decision).toMatchObject({
      status: "CERTIFIED",
      certificate: {
        counts: { rawObservationCount: 2, legalDedupeCount: 1, finalUniqueJobCount: 1 },
        legalDedupeLedger: [{ droppedCount: 1, dropReason: "DUPLICATE_DEDUPE_KEY_DETERMINISTIC_WINNER" }]
      }
    });
  });
});
