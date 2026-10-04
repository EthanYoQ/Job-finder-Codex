import { describe, expect, it } from "vitest";
import { OFFICIAL_API_JSON_CONFIG } from "../../src/crawler/companyRecruitmentProfiles/shared";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { reconcileAdapterRows } from "../../src/crawler/adapters/reconciliation";
import type { NormalizedJobRecord } from "../../src/crawler/normalizedJob";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import { getPlanBySourceId, buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { sha256Bytes, type PersistentSourceFetchEvidence } from "../../src/crawler/sourceFetchEvidence";
import { createHttpHtmlSourceFetch } from "../../src/crawler/httpHtmlSourceFetch";
import { createGrifolsChinaSourceFetch, type GrifolsChinaHttpResponse } from "../../src/crawler/grifolsChinaSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import {
  issueAGradeOfficialTotalCertificate,
  requiresAGradeOfficialTotalCertificate,
  verifyAGradeCompletenessCertificateReceipt
} from "../../src/crawler/completenessCertificate";

const capturedAt = "2026-08-12T12:00:00.000Z";
const officialArtifactSha256 = "a".repeat(64);

function gskPlan() {
  const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-gsk-china-social");
  if (plan?.adapterId !== "official-json") throw new Error("Expected staged GSK plan");
  // These algebra fixtures exercise the historical Phenom certificate shape;
  // current GSK Moka scope and strict request replay have their own integration test.
  const { moka: _moka, ...legacy } = plan;
  return { ...legacy, source: { ...plan.source, atsKind: "OFFICIAL_JSON" as const,
    officialEntryUrl: "https://jobs.gsk.com/cn/zh/search-results?keywords=China" },
    json: OFFICIAL_API_JSON_CONFIG,
    officialJsonFetch: { kind: "phenom" as const, countryFilter: "China",
      detailBaseUrl: "https://jobs.gsk.com/gb/en/job", pageSize: 50, maxPages: 3 } };
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
  it("certifies Grifols only when official detail evidence proves every mainland scope exclusion", async () => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-grifols-china-social");
    if (plan?.adapterId !== "official-json" || plan.profileBoundSource?.kind !== "grifols-china-detail-scope") {
      throw new Error("Expected staged Grifols detail-scoped plan");
    }
    expect(requiresAGradeOfficialTotalCertificate(plan)).toBe(true);
    const entry = "https://jobsearch.grifols.com/search/?createNewAlert=false&q=&locationsearch=China";
    const marketing = "https://jobsearch.grifols.com/job/Shanghai-Marketing-Assistant/1429532033/";
    const fieldService = "https://jobsearch.grifols.com/job/Home-Office-%E7%8F%BE%E5%A0%B4%E6%9C%8D%E5%8B%99%E5%B7%A5%E7%A8%8B%E5%B8%AB-Field-Service-Engineer/1409962833/";
    const response = (url: string, body: string): GrifolsChinaHttpResponse => ({
      status: 200,
      body,
      finalUrl: url,
      contentType: "text/html; charset=utf-8",
      capturedAt
    });
    const detail = (url: string, streetAddress: string, officialLocation: string) =>
      `<link rel="canonical" href="${url}">
        <div class="jobDisplayShell"><meta itemprop="streetAddress" content="${streetAddress}">
          <div class="jobDisplay"><div class="content"><b>Location: ${officialLocation}</b></div></div>
        </div>`;
    const fetch = createGrifolsChinaSourceFetch({
      now: () => new Date(capturedAt),
      http: async request => {
        if (request.url === entry) return response(request.url,
          `<span class="paginationLabel">Results <b>1 – 2</b> of <b>2</b></span>
            <table id="searchresults" aria-label="Search results for China. Page 1 of 1, Results 1 to 2 of 2"><tbody>
              <tr class="data-row"><td class="jobTitle hidden-phone"><a class="jobTitle-link" href="/job/Shanghai-Marketing-Assistant/1429532033/">Marketing Assistant</a></td><td class="colLocation hidden-phone"><span class="jobLocation">Shanghai, CN</span></td></tr>
              <tr class="data-row"><td class="jobTitle hidden-phone"><a class="jobTitle-link" href="/job/Home-Office-%E7%8F%BE%E5%A0%B4%E6%9C%8D%E5%8B%99%E5%B7%A5%E7%A8%8B%E5%B8%AB-Field-Service-Engineer/1409962833/">Field Service Engineer</a></td><td class="colLocation hidden-phone"><span class="jobLocation">Home Office, CN</span></td></tr>
            </tbody></table>`);
        if (request.url === marketing) {
          return response(request.url, detail(request.url, "Shanghai, CN", "APAC : China : Shanghai:Shangai"));
        }
        return response(request.url, detail(request.url, "Home Office, CN", "APAC : Hong Kong : Home Office:Hong Kong"));
      }
    });
    const crawl = await runSourceCrawl(plan, { fetch });
    if (!crawl.fetchEvidence || !crawl.paginationEvaluation || !crawl.reconciliation) {
      throw new Error("Expected exact Grifols crawl evidence");
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
    if (decision.status !== "CERTIFIED") throw new Error("Expected Grifols A-grade certificate");
    expect(decision.certificate).toMatchObject({
      counts: { officialTotal: 2, validationDiscardCount: 1, finalUniqueJobCount: 1 },
      legalScopeExclusionLedger: [{
        code: "VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE",
        recordIndex: 1
      }]
    });
    expect(verifyAGradeCompletenessCertificateReceipt({
      certificate: decision.certificate,
      certificateSha256: decision.certificateSha256,
      expected: {
        releaseCandidateId: "rc-html",
        batchId: "batch-html",
        sourceResultId: "result-html",
        sourceId: plan.source.id,
        companyId: plan.company.id,
        sourceConfigSha256: sourcePlanConfigSha256(plan),
        surfaceIds: [plan.source.surfaceId!],
        channelIds: plan.expectedChannels!.map(({ channelId }) => channelId),
        officialArtifactLogicalKey: crawl.fetchEvidence.declaredCompleteness!.artifactLogicalKey,
        officialArtifactSha256
      }
    })).toMatchObject({ status: "PASS", grade: "A", finalUniqueJobCount: 1 });
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
