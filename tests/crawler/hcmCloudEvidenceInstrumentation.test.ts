import { describe, expect, it } from "vitest";
import { createOfficialJsonSourceFetch, type OfficialJsonHttpResponse } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const NOW = "2026-07-08T00:00:00.000Z";
const ENTRY = "https://hcm.lunan.com.cn/recruit";
const COUNT = "https://hcm.lunan.com.cn/api/hcm.model.count?model=ReleaseJobMgr";
const LIST = "https://hcm.lunan.com.cn/api/hcm.model.list?model=ReleaseJobMgr";

const plan = {
  adapterId: "official-json",
  company: { id: "company-lunan", officialChineseName: "鲁南制药集团股份有限公司" },
  source: {
    id: "source-lunan-social",
    companyId: "company-lunan",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: ENTRY,
    officialChainEvidenceUrl: ENTRY
  },
  json: {
    jobsPath: "jobs",
    fields: {
      sourceJobId: "sourceJobId",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    }
  },
  officialJsonFetch: { kind: "hcm-cloud", pageSize: 2, maxPages: 5 }
} satisfies SourceCrawlPlan;

function encoded(payload: unknown): string {
  const base64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  return JSON.stringify({
    hcm_transfer_strategy: "hb5",
    hcm_param: `rsp${base64.replace(/[5a]/gu, (value) => value === "5" ? "a" : "!")}`
  });
}

function encodedBytes(bytes: Uint8Array): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return JSON.stringify({
    hcm_transfer_strategy: "hb5",
    hcm_param: `rsp${base64.replace(/[5a]/gu, (value) => value === "5" ? "a" : "!")}`
  });
}

function response(url: string, payload: unknown, overrides: Partial<OfficialJsonHttpResponse> = {}): OfficialJsonHttpResponse {
  return {
    status: 200,
    body: encoded(payload),
    finalUrl: url,
    contentType: "application/json; charset=utf-8",
    capturedAt: NOW,
    ...overrides
  };
}

function row(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, name: `医学专员-${id}`, work_city: "上海市", ...extra };
}

function fetcherWith(responses: OfficialJsonHttpResponse[]) {
  let index = 0;
  return createOfficialJsonSourceFetch({
    now: () => new Date(NOW),
    http: async () => responses[index++]!
  });
}

describe("HCM Cloud direct evidence instrumentation", () => {
  it.each([
    "https://user:placeholder@hcm.lunan.com.cn/recruit",
    "https://hcm.lunan.com.cn/recruit?token=secret123",
    "https://hcm.lunan.com.cn/recruit/token=secret123",
    "https://hcm.lunan.com.cn/recruit/%74%6f%6b%65%6e%3dsecret123",
    "https://hcm.lunan.com.cn/recruit/ｔｏｋｅｎ＝secret123"
  ])("fails before HTTP for an unsafe HCM entry URL", async (entryUrl) => {
    let calls = 0;
    const fetcher = createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => {
      calls += 1;
      return response(COUNT, { result: { list: [{ count__id: 0 }] } });
    } });
    const result = await fetcher({ ...plan, source: { ...plan.source, officialEntryUrl: entryUrl } });
    expect(result).toMatchObject({ ok: false });
    expect(calls).toBe(0);
    expect(JSON.stringify(result)).not.toContain("secret123");
  });

  it("decodes a real hb5 inverse round trip without replacement characters", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 1 }] } }),
      response(LIST, { result: { page_index: 1, list: [row("5a", { name: "研发平台主管" })] } })
    ])(plan);
    expect(result).toMatchObject({ ok: true, payload: { jobs: [{ title: "研发平台主管" }] } });
    expect(JSON.stringify(result)).not.toContain("�");
  });

  it("recognizes a chained mainland province and prefecture location from the official Lunan list", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 1 }] } }),
      response(LIST, {
        result: {
          page_index: 1,
          list: [row("lunan-mainland", { work_city: "山东省临沂市兰山区" })]
        }
      })
    ])(plan);

    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: { rawCount: 1, validCount: 1 },
        fetchLosses: []
      },
      payload: {
        jobs: [expect.objectContaining({ locationRaw: "山东省临沂市兰山区" })]
      }
    });
  });

  it.each(["山东海外", "海南国际", "临沂海外", "临沂市海外", "山东省临沂市海外"])(
    "does not treat an unrecognized province-prefixed label as a mainland location: %s",
    async (workCity) => {
      const result = await fetcherWith([
        response(COUNT, { result: { list: [{ count__id: 1 }] } }),
        response(LIST, { result: { page_index: 1, list: [row("not-a-location", { work_city: workCity })] } })
      ])(plan);

      expect(result).toMatchObject({
        ok: true,
        fetchEvidence: {
          fetchCounts: { rawCount: 1, validCount: 0, validationDiscardCount: 1 },
          fetchLosses: [{ details: { code: "OUT_OF_SCOPE" } }]
        },
        payload: { jobs: [] }
      });
    }
  );

  it("retains the current raw artifact and fails on invalid decoded UTF-8 bytes", async () => {
    const body = encodedBytes(Uint8Array.from([0xc3, 0x28]));
    const result = await fetcherWith([response(COUNT, {}, { body })])(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: [{ kind: "ATS_API_RESPONSE", body }],
        pages: [],
        supportingArtifactOnlyFailure: { code: "HCM_COUNT_RESPONSE_FAILED" }
      }
    });
    expect(JSON.stringify(result)).not.toContain("�");
  });

  it("represents count-only failures as supporting artifacts and never as pagination pages", async () => {
    const bad = response(COUNT, {}, { body: "not-json" });
    const result = await fetcherWith([bad])(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: [{ kind: "ATS_API_RESPONSE", body: "not-json" }],
        pages: [],
        supportingArtifactOnlyFailure: { code: "HCM_COUNT_RESPONSE_FAILED" }
      }
    });
  });

  it("uses EMPTY_PAGE for an official zero with an exact empty first list page", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 0 }] } }),
      response(LIST, { result: { page_index: 1, list: [] } })
    ])(plan);
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: 0 },
      fetchEvidence: { artifacts: [{ kind: "ATS_API_RESPONSE" }, { kind: "PAGINATION_PAGE" }],
        pages: [{ termination: "EMPTY_PAGE", declaredTotal: 0 }] },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: true }
    });
  });

  it("keeps official zero with a missing returned page ABORTED and noncertifying", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 0 }] } }),
      response(LIST, { result: { list: [] } })
    ])(plan);
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: 0 },
      fetchEvidence: { pages: [{ requestedPage: 1, returnedPage: null, termination: "ABORTED" }] },
      paginationEvaluation: {
        safeCompleteness: false,
        verifiedEligible: false,
        derivedAnomalyCodes: ["RETURNED_PAGE_MISMATCH"]
      }
    });
  });

  it("keeps official zero with a mismatched returned page ABORTED and lets D1 label it", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 0 }] } }),
      response(LIST, { result: { page_index: 2, list: [] } })
    ])(plan);
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: 0 },
      fetchEvidence: { pages: [{ requestedPage: 1, returnedPage: 2, termination: "ABORTED" }] },
      paginationEvaluation: {
        safeCompleteness: false,
        verifiedEligible: false,
        derivedAnomalyCodes: ["RETURNED_PAGE_MISMATCH"]
      }
    });
  });

  it("rejects a backward list capture time while retaining only prior trustworthy supporting evidence", async () => {
    const responses = [
      response(COUNT, { result: { list: [{ count__id: 1 }] } }, { capturedAt: "2026-07-08T00:00:00.500Z" }),
      response(LIST, { result: { page_index: 1, list: [row("1")] } }, { capturedAt: "2026-07-08T00:00:00.250Z" })
    ];
    let index = 0;
    let clockCalls = 0;
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(clockCalls++ === 0 ? NOW : "2026-07-08T00:00:01.000Z"),
      http: async () => responses[index++]!
    })(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: [{ kind: "ATS_API_RESPONSE", capturedAt: "2026-07-08T00:00:00.500Z" }],
        pages: [],
        supportingArtifactOnlyFailure: { code: "HCM_LIST_RESPONSE_FAILED" }
      }
    });
  });

  it("proves intercepted count/list request semantic filter tuples are equal", async () => {
    const bodies: string[] = [];
    const fetcher = createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => {
      bodies.push(request.body!);
      return request.url.includes("count")
        ? response(COUNT, { result: { list: [{ count__id: 1 }] } })
        : response(LIST, { result: { page_index: 1, list: [row("1")] } });
    } });
    const result = await fetcher(plan);
    expect(result).toMatchObject({ ok: true });
    const decoded = bodies.map((body) => {
      const envelope = JSON.parse(body) as { hcm_param: string };
      return JSON.parse(Buffer.from(envelope.hcm_param.slice(3), "base64").toString("utf8")) as Record<string, unknown>;
    });
    const semantic = (payload: Record<string, unknown>) => {
      const filter = payload.filter_dict as Record<string, unknown>;
      const extra = payload.extra_property as Record<string, unknown>;
      const params = extra.filter_params as Record<string, unknown>;
      return { model: payload.model, jobClass: filter.job_class, status: filter.status,
        delivery: filter.delivery, contractUnit: filter.contract_unit, portalState: extra.state,
        recruitType: params.job_class };
    };
    expect(semantic(decoded[0]!)).toEqual(semantic(decoded[1]!));
    expect(result.fetchEvidence?.artifacts.every((artifact) =>
      /filter-sha256:[0-9a-f]{64}/u.test(artifact.extractorLocator))).toBe(true);
  });

  it("canonicalizes a benign entry query without retaining its raw value and preserves references through runSourceCrawl", async () => {
    const queried = "https://hcm.lunan.com.cn/recruit?view=social-jobs";
    const fetcher = fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 1 }] } }),
      response(LIST, { result: { page_index: 1, list: [row("1")] } })
    ]);
    const queriedPlan = { ...plan, source: { ...plan.source, officialEntryUrl: queried } };
    const fetched = await fetcher(queriedPlan);
    expect(fetched).toMatchObject({ ok: true, completeness: {
      completenessEvidenceUrl: expect.stringMatching(/view=sha256%3A[0-9a-f]{64}/u)
    } });
    expect(JSON.stringify(fetched)).not.toContain("social-jobs");
    if (!fetched.ok || !fetched.fetchEvidence || !fetched.paginationEvaluation) throw new Error("expected HCM evidence");
    const crawled = await runSourceCrawl(queriedPlan, { fetch: async () => fetched });
    expect(crawled.fetchEvidence).toBe(fetched.fetchEvidence);
    expect(crawled.paginationEvaluation).toBe(fetched.paginationEvaluation);
    expect(crawled.observation.completenessStatus).not.toBe("VERIFIED");
    const declaration = fetched.fetchEvidence.declaredCompleteness!;
    const declarationArtifact = fetched.fetchEvidence.artifacts.find(
      (artifact) => artifact.logicalKey === declaration.artifactLogicalKey
    )!;
    expect(crawled.observation.completenessEvidenceUrl).toBe(
      declarationArtifact.finalUrl ?? declarationArtifact.requestedUrl
    );
  });
  it("retains one exact count artifact and two exact list page artifacts without self-promotion", async () => {
    const countBody = response(COUNT, { result: { list: [{ count__id: 3 }] } });
    const page1 = response(LIST, { result: { page_index: 1, list: [row("1"), row("2")] } });
    const page2 = response(LIST, { result: { page_index: 2, list: [row("3")] } });
    const result = await fetcherWith([countBody, page1, page2])(plan);
    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 3,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT"
      },
      fetchEvidence: {
        artifacts: [
          { kind: "ATS_API_RESPONSE", body: countBody.body },
          { kind: "PAGINATION_PAGE", body: page1.body },
          { kind: "PAGINATION_PAGE", body: page2.body }
        ],
        pages: [
          { requestedPage: 1, returnedPage: 1, declaredTotal: 3, termination: "CONTINUE" },
          { requestedPage: 2, returnedPage: 2, declaredTotal: 3, termination: "DECLARED_TOTAL_REACHED" }
        ],
        fetchCounts: { rawCount: 3, parsedCount: 3, validCount: 3, parseDiscardCount: 0, validationDiscardCount: 0 }
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: false }
    });
    const serialized = JSON.stringify(result, (_key, value) => typeof value === "string" && value.startsWith("{") ? "[opaque]" : value);
    expect(serialized).not.toMatch(/hcm_param/u);
    if (!result.fetchEvidence) throw new Error("expected evidence");
    expect(result.fetchEvidence.artifacts[0]!.extractorLocator).toMatch(/decode:hb5-base64-v1.*\$\.result\.list\[0\]\.count__id/u);
    expect(result.fetchEvidence.artifacts[1]!.extractorLocator).toMatch(/filter-sha256:[0-9a-f]{64}.*\$\.result\.list/u);
  });

  it.each([
    ["missing final URL", { omitFinalUrl: true }],
    ["wrong final path", { finalUrl: ENTRY }],
    ["wrong MIME", { contentType: "text/html" }],
    ["future capture", { capturedAt: "2026-07-08T00:00:01.000Z" }]
  ])("fails closed with available exact count evidence for %s", async (_name, rawOverrides) => {
    const { omitFinalUrl, ...overrides } = rawOverrides as Record<string, unknown>;
    const bad = response(COUNT, { result: { list: [{ count__id: 0 }] } }, overrides as Partial<OfficialJsonHttpResponse>);
    if (omitFinalUrl) delete bad.finalUrl;
    const result = await fetcherWith([bad])(plan);
    expect(result).toMatchObject({ ok: false });
    if (bad.finalUrl && bad.contentType && bad.capturedAt === NOW) {
      expect(result.fetchEvidence?.artifacts[0]?.body).toBe(bad.body);
    }
    expect(result).not.toHaveProperty("completeness.completenessStatus", "VERIFIED");
  });

  it.each([
    ["invalid envelope JSON", "not-json"],
    ["missing encoded payload", JSON.stringify({ hcm_transfer_strategy: "hb5" })],
    ["invalid encoded payload", JSON.stringify({ hcm_transfer_strategy: "hb5", hcm_param: "rsp%%%" })],
    ["duplicate envelope keys", '{"hcm_param":"rspAAAA","hcm_param":"rspBBBB","hcm_transfer_strategy":"hb5"}']
  ])("retains the exact count artifact and fails on %s", async (_name, body) => {
    const bad = response(COUNT, {}, { body });
    const result = await fetcherWith([bad])(plan);
    expect(result).toMatchObject({ ok: false, fetchEvidence: { artifacts: [{ body }] } });
  });

  it.each([
    [{ result: { list: [{ count__id: 2, id: 3 }] } }, "ambiguous"],
    [{ result: { list: [{ count__id: "2" }] } }, "nonnegative integer"],
    [{ result: { list: [{ count__id: -1 }] } }, "nonnegative integer"]
  ])("rejects invalid or conflicting count coordinates", async (payload, _reason) => {
    const result = await fetcherWith([response(COUNT, payload)])(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HCMCloud count is invalid" });
    expect(result.fetchEvidence?.artifacts).toHaveLength(1);
  });

  it("selects the exact Lunan aggregate-row count only when the envelope count proves one aggregate row", async () => {
    const lunanPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        countCoordinatePolicy: "LUNAN_AGGREGATE_ROW"
      }
    } satisfies SourceCrawlPlan;
    const result = await fetcherWith([
      response(COUNT, { result: { count: 1, list: [{ count__id: 2, id: 2 }] } }),
      response(LIST, { result: { page_index: 1, list: [row("1"), row("2")] } })
    ])(lunanPlan);

    expect(result).toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 2 },
      fetchEvidence: { fetchCounts: { rawCount: 2, validCount: 2 } }
    });
    expect(result.fetchEvidence?.artifacts[0]?.extractorLocator).toContain("$.result.list[0].count__id");
  });

  it.each([
    { result: { count: 2, list: [{ count__id: 2, id: 2 }] } },
    { result: { count: 1, list: [{ count__id: 2, id: 3 }] } },
    { result: { count: 1, list: [{ count__id: 2, id: 2 }, { count__id: 0, id: 0 }] } }
  ])("rejects a drifted Lunan aggregate-row count envelope", async (payload) => {
    const result = await fetcherWith([response(COUNT, payload)])({
      ...plan,
      officialJsonFetch: { ...plan.officialJsonFetch, countCoordinatePolicy: "LUNAN_AGGREGATE_ROW" }
    });
    expect(result).toMatchObject({ ok: false, failureReason: "HCMCloud count is invalid" });
  });

  it("keeps a missing count noncertifying and aborts after one truthful list page", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [] } }),
      response(LIST, { result: { page_index: 1, list: [row("1")] } })
    ])(plan);
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: { pages: [{ termination: "ABORTED", declaredTotal: null }] },
      paginationEvaluation: { safeCompleteness: false, verifiedEligible: false }
    });
    expect(result.fetchEvidence).not.toHaveProperty("declaredCompleteness");
  });

  it("rejects a non-array list with both count and list evidence retained", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 1 }] } }),
      response(LIST, { result: { page_index: 1, list: {} } })
    ])(plan);
    expect(result).toMatchObject({ ok: false, fetchEvidence: { artifacts: [{ kind: "ATS_API_RESPONSE" }, { kind: "PAGINATION_PAGE" }] } });
    expect(result.fetchEvidence?.pages[0]?.termination).toBe("FAILED");
  });

  it("accounts parse, validation, duplicate, scope and fallback losses exactly", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 7 }] } }),
      response(LIST, { result: { page_index: 1, list: [
        "bad", row("1"), row("1"), row("2", { name: "" }), row("3", { work_city: "Tokyo" }),
        { id: "4", name: "医学专员-4" }, row("5", { name: "token=secret123" })
      ] } })
    ])({ ...plan, officialJsonFetch: { ...plan.officialJsonFetch, maxPages: 1, defaultLocationRaw: "上海" } });
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: {
        fetchCounts: { rawCount: 7, parsedCount: 6, validCount: 1, parseDiscardCount: 1, validationDiscardCount: 5 },
        fetchLosses: expect.arrayContaining([
          expect.objectContaining({ stage: "PARSE", details: expect.objectContaining({ code: "NON_OBJECT_RECORD" }) }),
          expect.objectContaining({ details: expect.objectContaining({ code: "DUPLICATE_OFFICIAL_ID" }) }),
          expect.objectContaining({ details: expect.objectContaining({ code: "MISSING_REQUIRED_FIELD" }) }),
          expect.objectContaining({ details: expect.objectContaining({ code: "OUT_OF_SCOPE" }) }),
          expect.objectContaining({ details: expect.objectContaining({ code: "DECLARED_LOCATION_FALLBACK" }) }),
          expect.objectContaining({ details: expect.objectContaining({ code: "SENSITIVE_OUTPUT" }) })
        ])
      }
    });
  });

  it("derives repeated-page anomalies only through D1 and remains manual", async () => {
    const repeated = response(LIST, { result: { page_index: 2, list: [row("1"), row("2")] } });
    const first = { ...repeated, body: repeated.body.replace('"page_index":2', '"page_index":1') };
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 4 }] } }), first, repeated
    ])(plan);
    expect(result).toMatchObject({ ok: true, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" } });
    expect(result.paginationEvaluation?.derivedAnomalyCodes).toEqual(expect.arrayContaining(["REPEATED_JOB_ID_SET_WITH_NEXT"]));
  });

  it("preserves direct failure evidence and blocks browser fallback self-certification", async () => {
    const direct = response(COUNT, { error: "blocked" }, { status: 500 });
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => direct,
      hcmCloudBrowserFetch: (async () => ({
        ok: true,
        capturedAt: NOW,
        payload: { jobs: [row("browser")] },
        completeness: {
          completenessStatus: "VERIFIED",
          expectedJobCount: 1,
          completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
          completenessEvidenceUrl: ENTRY,
          pagesVisited: 1
        }
      })) as never
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      failureReason: "HCMCloud browser session failed",
      priorTransportAttempts: [{
        transport: "DIRECT_HTTP", code: "HCM_DIRECT_FAILED",
        fetchEvidence: { artifacts: [{ kind: "ATS_API_RESPONSE", body: direct.body }] }
      }, { transport: "BROWSER_SESSION", code: "HCM_BROWSER_SESSION_FAILED", outcome: "FAILED" }]
    });
  });

  it("retains a current wrong-MIME list artifact as FAILED", async () => {
    const badList = response(LIST, { result: { page_index: 1, list: [row("1")] } }, { contentType: "text/html" });
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 1 }] } }), badList
    ])(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: [{ kind: "ATS_API_RESPONSE" }, { kind: "PAGINATION_PAGE", body: badList.body }],
        pages: [{ termination: "FAILED" }]
      }
    });
  });

  it("retains prior evidence and changes the last trustworthy page to ABORTED on later metadata failure", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 3 }] } }),
      response(LIST, { result: { page_index: 1, list: [row("1"), row("2")] } }),
      response(LIST, { result: { page_index: 2, list: [row("3")] } }, { finalUrl: ENTRY })
    ])(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: [{ kind: "ATS_API_RESPONSE" }, { kind: "PAGINATION_PAGE" }],
        pages: [{ termination: "ABORTED", rawJobIds: expect.any(Array) }],
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 2 }
      }
    });
  });

  it("lets D1 derive returned-page mismatch without caller labels", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 1 }] } }),
      response(LIST, { result: { page_index: 2, list: [row("1")] } })
    ])(plan);
    expect(result).toMatchObject({ ok: true, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" } });
    expect(result.fetchEvidence?.pages[0]?.anomalyCodes).toEqual(["RETURNED_PAGE_MISMATCH"]);
    expect(result.paginationEvaluation?.derivedAnomalyCodes).toEqual(["RETURNED_PAGE_MISMATCH"]);
  });

  it("fails when cumulative raw rows exceed the official count", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 1 }] } }),
      response(LIST, { result: { page_index: 1, list: [row("1"), row("2")] } })
    ])(plan);
    expect(result).toMatchObject({
      ok: false,
      failureReason: "HCMCloud raw rows exceed official count",
      fetchEvidence: { pages: [{ termination: "FAILED", declaredTotal: 1 }] }
    });
  });

  it("fails closed when a list response exposes a changed root official count", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 2 }] } }),
      response(LIST, { count: 3, result: { page_index: 1, list: [row("1"), row("2")] } })
    ])(plan);
    expect(result).toMatchObject({
      ok: false,
      failureReason: "HCMCloud list shape is invalid",
      fetchEvidence: { pages: [{ termination: "FAILED" }] }
    });
  });

  it("lets D1 derive max-pages-with-next from raw cardinality", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 3 }] } }),
      response(LIST, { result: { page_index: 1, list: [row("1"), row("2")] } })
    ])({ ...plan, officialJsonFetch: { ...plan.officialJsonFetch, maxPages: 1 } });
    expect(result).toMatchObject({ ok: true, fetchEvidence: { pages: [{ termination: "MAX_PAGE_LIMIT" }] } });
    expect(result.paginationEvaluation?.derivedAnomalyCodes).toEqual(["MAX_PAGES_WITH_NEXT"]);
  });

  it("accounts official-ID and detail-ID collisions independently", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 3 }] } }),
      response(LIST, { result: { page_index: 1, list: [
        row("official-1", { job_id: "detail-1" }),
        row("official-2", { job_id: "detail-1" }),
        row("official-1", { job_id: "detail-3" })
      ] } })
    ])(plan);
    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: { rawCount: 3, parsedCount: 3, validCount: 1, validationDiscardCount: 2 },
        fetchLosses: [
          { details: { code: "DUPLICATE_DETAIL_ID" } },
          { details: { code: "DUPLICATE_OFFICIAL_ID" } }
        ]
      }
    });
  });

  it("rejects credential-bearing detail paths without leaking them outside opaque bodies", async () => {
    const secretPath = "/recruit/token=secret123/#/portal_job_detail";
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 1 }] } }),
      response(LIST, { result: { page_index: 1, list: [row("1")] } })
    ])({ ...plan, officialJsonFetch: { ...plan.officialJsonFetch, detailPath: secretPath } });
    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 0, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code: "UNSAFE_OFFICIAL_URL" } }] }
    });
    const withoutBodies = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    const evidence = withoutBodies.fetchEvidence as { artifacts: Array<Record<string, unknown>> };
    for (const artifact of evidence.artifacts) delete artifact.body;
    expect(JSON.stringify(withoutBodies)).not.toContain("secret123");
  });

  it("accepts audited mainland province and prefecture locations while rejecting explicit foreign coordinates", async () => {
    const result = await fetcherWith([
      response(COUNT, { result: { list: [{ count__id: 2 }] } }),
      response(LIST, { result: { page_index: 1, list: [
        row("1", { work_city: "山东省·临沂市" }),
        row("2", { work_city: "山东省·临沂市", country: "Japan" })
      ] } })
    ])(plan);
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [{ title: "医学专员-1", locationRaw: "山东省·临沂市" }] },
      fetchEvidence: {
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 1, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code: "AMBIGUOUS_SCOPE" } }]
      }
    });
  });
});
