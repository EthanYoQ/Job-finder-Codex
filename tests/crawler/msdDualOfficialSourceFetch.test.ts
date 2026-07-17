import { describe, expect, it } from "vitest";
import {
  createMsdDualOfficialSourceFetch,
  reconcileMsdOfficialSets,
  validateStrictMsdDualOfficialEvidence,
  type MsdOfficialReconciliationInput
} from "../../src/crawler/msdDualOfficialSourceFetch";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";

const detailBaseUrl = "https://jobs.msd.com/cn/zh/job";
const allowedApplyOrigins = ["https://msd.wd5.myworkdayjobs.com"];

function workdayRecord(id: string, sparse = false): Record<string, unknown> {
  if (sparse) return { bulletFields: [id] };
  return {
    title: `Medical role ${id}`,
    externalPath: `/job/CHN---Shanghai/Medical-role-${id}`,
    locationsText: "CHN - Shanghai - Shanghai",
    workerSubType: "Regular",
    bulletFields: [id]
  };
}

function phenomRecord(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reqId: id,
    jobSeqNo: `MSD-CN-${id}`,
    title: `Medical role ${id}`,
    country: "China",
    state: "Shanghai",
    city: "Shanghai",
    location: "Shanghai, Shanghai, China",
    descriptionTeaser: "A current externally advertised medical position.",
    applyUrl: `${allowedApplyOrigins[0]}/SearchJobs/job/CHN---Shanghai/Medical-role-${id}/apply`,
    externalApply: true,
    ...overrides
  };
}

function reconcile(
  workdayRecords: readonly Record<string, unknown>[],
  phenomRecords: readonly Record<string, unknown>[]
) {
  return reconcileMsdOfficialSets({
    workdayRecords,
    phenomRecords,
    officialDetailBaseUrl: detailBaseUrl,
    allowedApplyOrigins
  } satisfies MsdOfficialReconciliationInput);
}

describe("MSD dual-official-source reconciliation", () => {
  it.each([1, 3, 7])("derives the formal set from the current official records when the total changes (%s)", (size) => {
    const ids = Array.from({ length: size }, (_, index) => `REQ-DYNAMIC-${index + 1}`);
    const result = reconcile(
      ids.map((id, index) => workdayRecord(id, index === ids.length - 1)),
      ids.map((id) => phenomRecord(id))
    );

    expect(result).toMatchObject({ ok: true, excluded: [] });
    if (!result.ok) throw new Error(result.failureCode);
    expect(result.jobs.map((job) => job.officialId).sort()).toEqual([...ids].sort());
    expect(result.jobs).toHaveLength(ids.length);
  });

  it("hydrates a sparse Workday row only from the same official Phenom requisition", () => {
    const formalId = "REQ-SPARSE-SHANGHAI";
    const result = reconcile(
      [workdayRecord(formalId, true)],
      [phenomRecord(formalId, { title: "Innovation engagement specialist" })]
    );

    expect(result).toMatchObject({
      ok: true,
      jobs: [{
        officialId: formalId,
        title: "Innovation engagement specialist",
        locationRaw: "Shanghai, Shanghai, China"
      }]
    });
    if (!result.ok) throw new Error(result.failureCode);
    expect(result.jobs[0]?.officialUrl.startsWith(`${detailBaseUrl}/`)).toBe(true);
    expect(result.jobs[0]?.officialUrl).not.toContain("myworkdayjobs.com");
  });

  it("keeps a strong current posting from the primary official careers page when Workday has already dropped it", () => {
    const officialOnlyId = "REQ-OFFICIAL-PAGE-ONLY";
    const result = reconcile([], [phenomRecord(officialOnlyId, {
      visibilityType: "External",
      postedDate: "2026-07-17T08:00:00+08:00"
    })]);

    expect(result).toMatchObject({
      ok: true,
      jobs: [{ officialId: officialOnlyId }],
      excluded: []
    });
  });

  it("accepts the official page timestamp when its UTC offset omits the colon", () => {
    const officialOnlyId = "REQ-OFFICIAL-UTC-BASIC";
    expect(reconcile([], [phenomRecord(officialOnlyId, {
      visibilityType: "External",
      postedDate: "2026-07-17T00:00:00.000+0000"
    })])).toMatchObject({ ok: true, jobs: [{ officialId: officialOnlyId }] });
  });

  it.each([
    "QA integration test vacancy - do not apply",
    "Automated test role - do not apply"
  ])("excludes an official test placeholder only when every semantic proof is present: %s", (title) => {
    const formalId = "REQ-FORMAL";
    const placeholderId = `PLACEHOLDER-${title.length}`;
    const result = reconcile(
      [workdayRecord(formalId)],
      [
        phenomRecord(formalId),
        phenomRecord(placeholderId, {
          title,
          descriptionTeaser: "",
          applyUrl: null,
          externalApply: false
        })
      ]
    );

    expect(result).toMatchObject({
      ok: true,
      jobs: [{ officialId: formalId }],
      excluded: [{ officialId: placeholderId, code: "VERIFIED_OFFICIAL_TEST_PLACEHOLDER" }]
    });
  });

  it.each([
    ["ordinary title", "", null, false, false],
    ["QA Test Automation Engineer Role", "", null, false, false],
    ["Staging Operations Manager", "", null, false, false],
    ["Sandbox Platform Engineer", "", null, false, false],
    ["QA test vacancy - do not apply", "real responsibilities", null, false, false],
    ["QA test vacancy - do not apply", "", "https://msd.wd5.myworkdayjobs.com/SearchJobs/apply", false, false],
    ["QA test vacancy - do not apply", "", null, true, false],
    ["QA test vacancy - do not apply", "", null, false, true]
  ])("blocks an unmatched Phenom record when one placeholder proof is absent", (
    title,
    descriptionTeaser,
    applyUrl,
    externalApply,
    includeInWorkday
  ) => {
    const formalId = "REQ-FORMAL";
    const unmatchedId = "UNMATCHED-CANDIDATE";
    const workday = [workdayRecord(formalId)];
    if (includeInWorkday) workday.push(workdayRecord(unmatchedId, true));

    const result = reconcile(workday, [
      phenomRecord(formalId),
      phenomRecord(unmatchedId, { title, descriptionTeaser, applyUrl, externalApply })
    ]);

    expect(result).toMatchObject({
      ok: false,
      failureCode: "MSD_UNKNOWN_OFFICIAL_SET_DIFFERENCE"
    });
  });

  it("rejects a matched record whose advertised application URL is outside both endorsed official origins", () => {
    const formalId = "REQ-UNTRUSTED-URL";
    const result = reconcile(
      [workdayRecord(formalId, true)],
      [phenomRecord(formalId, { applyUrl: "https://jobs.example.invalid/collect-resume" })]
    );

    expect(result).toMatchObject({
      ok: false,
      failureCode: "MSD_NON_OFFICIAL_URL"
    });
  });

  it("keeps a Shanghai mainland-China record and blocks the same requisition when the official mirror reports a foreign scope", () => {
    const formalId = "REQ-LOCATION-SCOPE";
    expect(reconcile(
      [workdayRecord(formalId, true)],
      [phenomRecord(formalId)]
    )).toMatchObject({ ok: true });

    expect(reconcile(
      [workdayRecord(formalId, true)],
      [phenomRecord(formalId, {
        country: "Singapore",
        state: "Singapore",
        city: "Singapore",
        location: "Singapore, Singapore"
      })]
    )).toMatchObject({
      ok: false,
      failureCode: "MSD_OUT_OF_SCOPE"
    });
  });
});

describe("MSD dual-official-source pagination", () => {
  it("returns a structured retry signal for a temporary official-entry failure", async () => {
    const plan = buildStagedSourceCrawlPlans(candidateCompanies)
      .find((candidate) => candidate.source.id === "source-msd-china-social");
    expect(plan?.transientRetryPolicy).toEqual({ maxRetries: 1, backoffMs: 10_000 });
    const result = await createMsdDualOfficialSourceFetch({
      entryHttp: async (request) => ({
        status: 503,
        body: "temporarily unavailable",
        finalUrl: request.url,
        contentType: "text/html"
      })
    })(plan!);

    expect(result).toMatchObject({
      ok: false,
      failureReason: "MSD_HTTP_RESPONSE_INVALID",
      transportFailure: { code: "OFFICIAL_HTTP_503", retryable: true }
    });
  });

  it("accepts a short final Phenom page and requests every dynamic offset exactly once", async () => {
    const ids = Array.from({ length: 101 }, (_, index) => `REQ-PAGE-${index + 1}`);
    const placeholderId = "SYNTHETIC-PLACEHOLDER";
    const phenomIds = [...ids, placeholderId];
    const capturedAt = "2026-07-17T00:00:00.000Z";
    const entryBody = `<script>
      var phApp = phApp || {"widgetApiEndpoint":"https://jobs.msd.com/widgets","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"MSD1GB","pageName":"search-results"}; phApp.ddo = {};
      phApp.pageId = "page10-ds";
    </script>`;
    const jsonResponse = (body: unknown, finalUrl: string) => ({
      status: 200,
      body: JSON.stringify(body),
      finalUrl,
      contentType: "application/json; charset=utf-8",
      capturedAt
    });
    const workdayRequests: number[] = [];
    const phenomRequests: number[] = [];
    const fetch = createMsdDualOfficialSourceFetch({
      now: () => new Date(capturedAt),
      entryHttp: async (request) => ({
        status: 200,
        body: entryBody,
        finalUrl: request.url,
        contentType: "text/html; charset=utf-8",
        capturedAt
      }),
      workdayHttp: async (request) => {
        const body = JSON.parse(request.body ?? "{}") as {
          appliedFacets?: Record<string, unknown>;
          offset?: number;
          limit?: number;
        };
        if (Object.keys(body.appliedFacets ?? {}).length === 0) {
          return jsonResponse({
            facets: [
              { facetParameter: "locations", values: [{ descriptor: "CHN - Shanghai", id: "china-location" }] },
              { facetParameter: "workerSubType", values: [{ descriptor: "Regular", id: "regular-worker" }] }
            ]
          }, request.url);
        }
        const offset = body.offset ?? 0;
        workdayRequests.push(offset);
        return jsonResponse({
          total: ids.length,
          jobPostings: ids.slice(offset, offset + (body.limit ?? 20)).map((id) => workdayRecord(id))
        }, request.url);
      },
      phenomHttp: async (request) => {
        const body = JSON.parse(request.body ?? "{}") as { from?: number; size?: number };
        const offset = body.from ?? 0;
        phenomRequests.push(offset);
        return jsonResponse({
          refineSearch: {
            totalHits: phenomIds.length,
            data: {
              jobs: phenomIds.slice(offset, offset + (body.size ?? 100)).map((id, index) =>
                phenomRecord(id, id === placeholderId
                  ? {
                      title: "Region job test",
                      descriptionTeaser: `Requisition ID: ${id}`,
                      applyUrl: null,
                      externalApply: false
                    }
                  : offset === 0 && index === 0
                    ? { title: "Senior  Medical role" }
                    : {}))
            }
          }
        }, request.url);
      }
    });
    const plan = buildStagedSourceCrawlPlans(candidateCompanies)
      .find((candidate) => candidate.source.id === "source-msd-china-social");
    expect(plan).toBeDefined();

    const result = await fetch(plan!);

    expect(result).toMatchObject({
      ok: true,
      payload: { jobPostings: expect.any(Array) },
      paginationEvaluation: { safeCompleteness: true, derivedAnomalyCodes: [] }
    });
    if (!result.ok) throw new Error(result.failureReason);
    if (!("payload" in result) || !result.fetchEvidence) {
      throw new Error("MSD_TEST_FETCH_SHAPE_INVALID");
    }
    const payload = result.payload as { jobPostings: unknown[] };
    expect(payload.jobPostings).toHaveLength(ids.length);
    expect(phenomRequests).toEqual([0, 100]);
    expect(workdayRequests).toEqual([0, 20, 40, 60, 80, 100]);
    expect(result.fetchEvidence.pages.map((page) => page.returnedPageSize)).toEqual([null, null]);
    expect(result.fetchEvidence.fetchCounts).toMatchObject({
      rawCount: phenomIds.length,
      validCount: ids.length,
      validationDiscardCount: 1
    });
    expect(result.fetchEvidence.fetchLosses).toHaveLength(1);

    const crawled = await runSourceCrawl(plan!, { fetch: async () => result });
    expect(crawled.truth).toEqual({
      transportSuccess: true,
      adapterSuccess: true,
      completenessVerified: true
    });
    expect(validateStrictMsdDualOfficialEvidence(
      plan!,
      crawled.fetchEvidence,
      crawled.jobs
    )).toBe(true);

    const evidence = crawled.fetchEvidence!;
    const mutateArtifact = (
      logicalKey: string,
      mutate: (artifact: (typeof evidence.artifacts)[number]) => void
    ) => {
      const tampered = structuredClone(evidence);
      const artifact = tampered.artifacts.find((candidate) => candidate.logicalKey === logicalKey);
      if (!artifact) throw new Error(`MISSING_TEST_ARTIFACT:${logicalKey}`);
      mutate(artifact);
      return tampered;
    };
    const entryTamper = mutateArtifact("msd-official-entry", (artifact) => {
      artifact.body = (artifact.body as string).replace("MSD1GB", "MSD1GB-TAMPERED");
    });
    const workdayTamper = mutateArtifact("msd-workday-page-0000", (artifact) => {
      const body = JSON.parse(artifact.body as string) as { jobPostings: Array<Record<string, unknown>> };
      body.jobPostings[0]!.bulletFields = ["REQ-TAMPERED"];
      artifact.body = JSON.stringify(body);
    });
    const phenomTamper = mutateArtifact("msd-phenom-page-0000", (artifact) => {
      const body = JSON.parse(artifact.body as string) as {
        refineSearch: { data: { jobs: Array<Record<string, unknown>> } };
      };
      body.refineSearch.data.jobs[0]!.title = "Tampered title";
      artifact.body = JSON.stringify(body);
    });
    const requestProofTamper = mutateArtifact("msd-phenom-page-0000", (artifact) => {
      artifact.extractorLocator = `${artifact.extractorLocator.slice(0, -1)}0`;
    });
    const exclusionTamper = structuredClone(evidence);
    exclusionTamper.fetchLosses[0]!.reason = "TAMPERED_EXCLUSION";
    const outputTamper = crawled.jobs.map((job, index) => index === 0
      ? { ...job, officialTitle: "Tampered output" }
      : job);
    const configTamper = structuredClone(plan!) as typeof plan & {
      profileBoundSource: { config: { maxPages: number } };
    };
    configTamper.profileBoundSource.config.maxPages -= 1;

    for (const tamperedEvidence of [
      entryTamper,
      workdayTamper,
      phenomTamper,
      requestProofTamper,
      exclusionTamper
    ]) {
      expect(validateStrictMsdDualOfficialEvidence(plan!, tamperedEvidence, crawled.jobs)).toBe(false);
    }
    expect(validateStrictMsdDualOfficialEvidence(plan!, evidence, outputTamper)).toBe(false);
    expect(validateStrictMsdDualOfficialEvidence(configTamper!, evidence, crawled.jobs)).toBe(false);
  });
});
