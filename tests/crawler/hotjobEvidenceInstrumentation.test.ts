import { describe, expect, it } from "vitest";
import {
  createHotjobLegacySourceFetch,
  type HotjobLegacyHttpResponse
} from "../../src/crawler/hotjobLegacySourceFetch";
import {
  createHotjobWecruitSourceFetch,
  type HotjobWecruitHttpResponse
} from "../../src/crawler/hotjobWecruitSourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const capturedAt = "2026-07-10T10:00:00.000Z";

const legacyPlan = {
  adapterId: "official-json",
  company: { id: "company-legacy", officialChineseName: "测试制药" },
  source: {
    id: "source-legacy-social",
    companyId: "company-legacy",
    kind: "SOCIAL",
    atsKind: "HOTJOB_WECRUIT",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://legacy.hotjob.cn/wt/TEST/web/index",
    officialChainEvidenceUrl: "https://example.cn/careers"
  },
  json: {
    jobsPath: "jobs",
    fields: {
      sourceJobId: "sourceJobId",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw"
    }
  },
  hotjobLegacy: {
    listUrl: "https://legacy.hotjob.cn/wt/TEST/web/mode400/position/list",
    suitePath: "wt/TEST",
    pageSize: 1,
    maxPages: 2
  }
} satisfies SourceCrawlPlan;

const wecruitPlan = {
  adapterId: "official-json",
  company: { id: "company-wecruit", officialChineseName: "测试药业" },
  source: {
    id: "source-wecruit-social",
    companyId: "company-wecruit",
    kind: "SOCIAL",
    atsKind: "HOTJOB_WECRUIT",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://wecruit.hotjob.cn/SUTEST/pb/social.html",
    officialChainEvidenceUrl: "https://example.com.cn/jobs"
  },
  json: {
    jobsPath: "jobs",
    fields: {
      sourceJobId: "sourceJobId",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw"
    }
  },
  hotjob: { suiteKey: "SUTEST", pageSize: 1, maxPages: 2 }
} satisfies SourceCrawlPlan;

function legacyResponse(body: unknown, overrides: Partial<HotjobLegacyHttpResponse> = {}): HotjobLegacyHttpResponse {
  return {
    status: 200,
    body: JSON.stringify(body),
    finalUrl: legacyPlan.hotjobLegacy.listUrl,
    contentType: "application/json; charset=utf-8",
    capturedAt,
    ...overrides
  };
}

const wecruitApiUrl =
  "https://wecruit.hotjob.cn/wecruit/positionInfo/listPosition/SUTEST?iSaJAx=isAjax&request_locale=zh-CN";

function wecruitResponse(body: unknown, overrides: Partial<HotjobWecruitHttpResponse> = {}): HotjobWecruitHttpResponse {
  return {
    status: 200,
    body: JSON.stringify(body),
    finalUrl: wecruitApiUrl,
    contentType: "application/json",
    capturedAt,
    ...overrides
  };
}

function legacyJob(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { PostId: id, PostName: `Role ${id}`, WorkPlace: "上海市", ...overrides };
}

function wecruitJob(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { postId: id, postName: `Role ${id}`, workPlaceStr: "上海市", ...overrides };
}

describe("Hotjob strict fetch evidence", () => {
  it("retains exact Legacy pages, truthful total coordinates, reconciled counts, and manual completeness", async () => {
    let index = 0;
    const bodies = [
      { pageCount: 2, data: { rowCount: 2, currentPage: 1, details: [legacyJob("a")] } },
      { pageCount: 2, data: { rowCount: 2, currentPage: 2, details: [legacyJob("b")] } }
    ];
    const result = await createHotjobLegacySourceFetch({
      now: () => new Date(capturedAt),
      http: async () => legacyResponse(bodies[index++])
    })(legacyPlan);

    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: 2 },
      fetchEvidence: {
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 0 },
        declaredCompleteness: {
          kind: "OFFICIAL_TOTAL_COUNT",
          value: 2,
          artifactLogicalKey: "hotjob-legacy-page-0000",
          extractorLocator: expect.stringMatching(/request:page=1,pageSize=1.*json:rowCount=\$\.data\.rowCount/)
        }
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: false }
    });
    if (!result.ok || !result.fetchEvidence) throw new Error("Expected Legacy evidence");
    expect(result.fetchEvidence.artifacts.map((artifact) => artifact.body)).toEqual(
      bodies.map((body) => JSON.stringify(body))
    );
    expect(result.fetchEvidence.pages.map((page) => page.termination)).toEqual(["CONTINUE", "DECLARED_TOTAL_REACHED"]);
    expect(result.fetchEvidence.pages.map((page) => page.returnedPage)).toEqual([1, 2]);
    if (!("payload" in result) || !result.payload || typeof result.payload !== "object" ||
      !("jobs" in result.payload) || !Array.isArray(result.payload.jobs)) throw new Error("Expected payload jobs");
    expect(result.payload.jobs).toHaveLength(2);
    expect(result.payload.jobs.every((job: unknown) =>
      typeof job === "object" && job !== null && "sourceJobId" in job &&
      typeof job.sourceJobId === "string" && /^hotjob:sha256:[0-9a-f]{64}$/.test(job.sourceJobId)
    )).toBe(true);
  });

  it("retains exact Wecruit pages and totalPage locator while remaining manual", async () => {
    let index = 0;
    const bodies = [
      { data: { pageForm: { totalPage: 2, currentPage: 1, pageData: [wecruitJob("a")] } } },
      { data: { pageForm: { totalPage: 2, currentPage: 2, pageData: [wecruitJob("b")] } } }
    ];
    const result = await createHotjobWecruitSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => wecruitResponse(bodies[index++])
    })(wecruitPlan);

    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", totalPages: 2 },
      fetchEvidence: {
        declaredCompleteness: {
          kind: "OFFICIAL_TOTAL_PAGES",
          value: 2,
          extractorLocator: expect.stringMatching(/request:page=1,pageSize=1,attempt=1.*json:totalPage=\$\.data\.pageForm\.totalPage/)
        }
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: true }
    });
    if (!result.ok || !result.fetchEvidence) throw new Error("Expected Wecruit evidence");
    expect(result.fetchEvidence.artifacts[0]).toMatchObject({
      logicalKey: "hotjob-wecruit-page-0000-attempt-01",
      body: JSON.stringify(bodies[0])
    });
    expect(result.fetchEvidence.artifacts.map((artifact) => artifact.body)).toEqual(
      bodies.map((body) => JSON.stringify(body))
    );
  });

  it.each(["finalUrl", "contentType", "capturedAt"] as const)(
    "fails closed with retained raw Legacy evidence when %s is missing",
    async (field) => {
      const response = legacyResponse({ data: { rowCount: 1, details: [legacyJob("a")] } });
      delete response[field];
      const result = await createHotjobLegacySourceFetch({ http: async () => response, now: () => new Date(capturedAt) })(legacyPlan);
      expect(result).toMatchObject({ ok: false, failureReason: expect.stringContaining("evidence metadata") });
    }
  );

  it("fails closed on false Wecruit origin/path/MIME/time metadata", async () => {
    const variants: Partial<HotjobWecruitHttpResponse>[] = [
      { finalUrl: "https://evil.example/wecruit/positionInfo/listPosition/SUTEST" },
      { finalUrl: "https://wecruit.hotjob.cn/wecruit/other" },
      { contentType: "text/html" },
      { capturedAt: "2026-07-10T09:59:59.000Z" }
    ];
    for (const variant of variants) {
      const result = await createHotjobWecruitSourceFetch({
        http: async () => wecruitResponse({ data: { pageForm: { totalPage: 1, pageData: [wecruitJob("a")] } } }, variant),
        now: () => new Date(capturedAt)
      })(wecruitPlan);
      expect(result).toMatchObject({ ok: false, failureReason: expect.stringMatching(/final URL|Content-Type|captured time/i) });
    }
  });

  it("rejects missing collections instead of inventing empty successful pages and retains the raw artifact", async () => {
    const legacy = await createHotjobLegacySourceFetch({
      http: async () => legacyResponse({ data: { rowCount: 0 } }),
      now: () => new Date(capturedAt)
    })(legacyPlan);
    const wecruit = await createHotjobWecruitSourceFetch({
      http: async () => wecruitResponse({ data: { pageForm: { totalPage: 1 } } }),
      now: () => new Date(capturedAt)
    })(wecruitPlan);
    for (const result of [legacy, wecruit]) {
      expect(result).toMatchObject({
        ok: false,
        fetchEvidence: { fetchCounts: { rawCount: 1, parsedCount: 0, validCount: 0, parseDiscardCount: 1 } }
      });
    }
  });

  it("records exact Legacy parse/validation losses for non-object, missing, duplicate, scope, URL, and secret rows", async () => {
    const raw = [
      legacyJob("safe"),
      null,
      { PostId: "missing", PostName: "No location" },
      legacyJob("safe"),
      legacyJob("us", { WorkPlace: "Boston, United States" }),
      legacyJob("bad", { PostName: "Bearer=abc123" })
    ];
    const result = await createHotjobLegacySourceFetch({
      http: async () => legacyResponse({ data: { currentPage: 1, details: raw } }),
      now: () => new Date(capturedAt)
    })({ ...legacyPlan, hotjobLegacy: { ...legacyPlan.hotjobLegacy, maxPages: 1 } });
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [expect.objectContaining({ sourceJobId: expect.stringMatching(/^hotjob:sha256:/) })] },
      fetchEvidence: {
        fetchCounts: { rawCount: 6, parsedCount: 5, validCount: 1, parseDiscardCount: 1, validationDiscardCount: 4 },
        fetchLosses: [
          expect.objectContaining({ stage: "PARSE", details: { code: "NON_OBJECT_RECORD", pageSequence: 0, recordIndex: 1 } }),
          expect.objectContaining({ stage: "VALIDATION", details: expect.objectContaining({ code: "MISSING_REQUIRED_FIELD" }) }),
          expect.objectContaining({ stage: "VALIDATION", details: expect.objectContaining({ code: "DUPLICATE_OFFICIAL_ID" }) }),
          expect.objectContaining({ stage: "VALIDATION", details: expect.objectContaining({ code: "OUT_OF_SCOPE" }) }),
          expect.objectContaining({ stage: "VALIDATION", details: expect.objectContaining({ code: "SENSITIVE_OUTPUT" }) })
        ]
      }
    });
    const serialized = JSON.stringify(result, (key, value) => key === "body" ? "<opaque>" : value);
    expect(serialized).not.toContain("Bearer=abc123");
    expect(serialized).not.toContain("Bearer=abc123");
  });

  it("records the same exact Wecruit parse/validation boundary without leaking rejected values", async () => {
    const raw = [
      wecruitJob("safe"),
      null,
      { postId: "missing", postName: "No location" },
      wecruitJob("safe"),
      wecruitJob("us", { workPlaceStr: "Boston, United States" }),
      wecruitJob("bad/url"),
      wecruitJob("secret", { postName: "client.secret=hidden-value" })
    ];
    const result = await createHotjobWecruitSourceFetch({
      http: async () => wecruitResponse({ data: { pageForm: { currentPage: 1, pageData: raw } } }),
      now: () => new Date(capturedAt)
    })({ ...wecruitPlan, hotjob: { ...wecruitPlan.hotjob, maxPages: 1 } });
    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: { rawCount: 7, parsedCount: 6, validCount: 1, parseDiscardCount: 1, validationDiscardCount: 5 },
        fetchLosses: [
          expect.objectContaining({ details: expect.objectContaining({ code: "NON_OBJECT_RECORD" }) }),
          expect.objectContaining({ details: expect.objectContaining({ code: "MISSING_REQUIRED_FIELD" }) }),
          expect.objectContaining({ details: expect.objectContaining({ code: "DUPLICATE_OFFICIAL_ID" }) }),
          expect.objectContaining({ details: expect.objectContaining({ code: "OUT_OF_SCOPE" }) }),
          expect.objectContaining({ details: expect.objectContaining({ code: "INVALID_OFFICIAL_URL" }) }),
          expect.objectContaining({ details: expect.objectContaining({ code: "SENSITIVE_OUTPUT" }) })
        ]
      }
    });
    const serialized = JSON.stringify(result, (key, value) => key === "body" ? "<opaque>" : value);
    expect(serialized).not.toContain("bad/url");
    expect(serialized).not.toContain("hidden-value");
  });

  it.each(["legacy", "wecruit"] as const)("retains exact invalid JSON response evidence for %s", async (kind) => {
    const result = kind === "legacy"
      ? await createHotjobLegacySourceFetch({
          http: async () => ({ ...legacyResponse({}), body: "{invalid" }), now: () => new Date(capturedAt)
        })(legacyPlan)
      : await createHotjobWecruitSourceFetch({
          http: async () => ({ ...wecruitResponse({}), body: "{invalid" }), now: () => new Date(capturedAt)
        })(wecruitPlan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: [expect.objectContaining({ body: "{invalid" })],
        fetchCounts: { rawCount: 1, parsedCount: 0, validCount: 0, parseDiscardCount: 1, validationDiscardCount: 0 },
        fetchLosses: [expect.objectContaining({ stage: "PARSE", details: expect.objectContaining({ code: "INVALID_RECORD_COLLECTION" }) })]
      }
    });
  });

  it("fails closed through shared D1 on unstable totals, repeated sets, and returned-page mismatch while retaining evidence", async () => {
    const scenarios = [
      [
        { data: { pageForm: { totalPage: 2, currentPage: 1, pageData: [wecruitJob("a")] } } },
        { data: { pageForm: { totalPage: 3, currentPage: 2, pageData: [wecruitJob("b")] } } }
      ],
      [
        { data: { pageForm: { totalPage: 2, currentPage: 1, pageData: [wecruitJob("a")] } } },
        { data: { pageForm: { totalPage: 2, currentPage: 2, pageData: [wecruitJob("a")] } } }
      ],
      [
        { data: { pageForm: { totalPage: 2, currentPage: 9, pageData: [wecruitJob("a")] } } }
      ],
      [
        { data: { pageForm: { totalPage: 2, currentPage: 1, pageData: [] } } },
        { data: { pageForm: { totalPage: 2, currentPage: 2, pageData: [wecruitJob("b")] } } }
      ]
    ];
    for (const pages of scenarios) {
      let index = 0;
      const result = await createHotjobWecruitSourceFetch({
        http: async () => wecruitResponse(pages[index++] ?? pages.at(-1)),
        now: () => new Date(capturedAt)
      })(wecruitPlan);
      expect(result).toMatchObject({ ok: false, fetchEvidence: { artifacts: expect.any(Array) } });
      expect(result.paginationEvaluation?.safeCompleteness).toBe(false);
    }
  });

  it("retains factual retry response artifacts and never relabels the failed response as the success", async () => {
    let attempts = 0;
    const failedBody = JSON.stringify({ error: "temporary" });
    const successBody = { data: { pageForm: { totalPage: 1, currentPage: 1, pageData: [wecruitJob("a")] } } };
    const result = await createHotjobWecruitSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => ++attempts === 1
        ? { ...wecruitResponse({}, { status: 503 }), body: failedBody }
        : wecruitResponse(successBody)
    })(wecruitPlan);
    expect(attempts).toBe(2);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok || !result.fetchEvidence) throw new Error("Expected retry evidence");
    expect(result.fetchEvidence.artifacts.map((artifact) => ({ key: artifact.logicalKey, status: artifact.httpStatus, body: artifact.body }))).toEqual([
      { key: "hotjob-wecruit-page-0000-attempt-01", status: 503, body: failedBody },
      { key: "hotjob-wecruit-page-0000-attempt-02", status: 200, body: JSON.stringify(successBody) }
    ]);
    expect(result.fetchEvidence.pages[0]?.artifactLogicalKey).toBe("hotjob-wecruit-page-0000-attempt-02");
  });

  it("uses the actual retry ordinal when a thrown attempt has no response artifact", async () => {
    let attempts = 0;
    const result = await createHotjobWecruitSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("no response available");
        return wecruitResponse({ data: { pageForm: { totalPage: 1, currentPage: 1, pageData: [wecruitJob("a")] } } });
      }
    })(wecruitPlan);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok || !result.fetchEvidence) throw new Error("Expected retry evidence");
    expect(result.fetchEvidence.artifacts.map((artifact) => artifact.logicalKey)).toEqual([
      "hotjob-wecruit-page-0000-attempt-02"
    ]);
    expect(result.fetchEvidence.declaredCompleteness?.extractorLocator).toContain("attempt=2");
  });

  it("does not synthesize a Legacy total/count/pages when declarations are absent", async () => {
    const result = await createHotjobLegacySourceFetch({
      http: async () => legacyResponse({ data: { currentPage: 1, details: [legacyJob("a")] } }),
      now: () => new Date(capturedAt)
    })({ ...legacyPlan, hotjobLegacy: { ...legacyPlan.hotjobLegacy, maxPages: 1 } });
    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        completenessEvidenceKind: "WEAK_MANUAL_SAMPLE"
      },
      fetchEvidence: { pages: [{ declaredTotal: null, declaredPages: null }] }
    });
    expect(result.ok && result.fetchEvidence?.declaredCompleteness).toBeUndefined();
  });

  it.each(["legacy", "wecruit"] as const)("archives non-2xx %s HTML responses before safe HTTP failure", async (kind) => {
    const html = "<html>temporary upstream error</html>";
    const result = kind === "legacy"
      ? await createHotjobLegacySourceFetch({
          http: async () => ({ ...legacyResponse({}, { status: 503, contentType: "text/html" }), body: html }),
          now: () => new Date(capturedAt)
        })(legacyPlan)
      : await createHotjobWecruitSourceFetch({
          http: async () => ({ ...wecruitResponse({}, { status: 503, contentType: "text/html" }), body: html }),
          now: () => new Date(capturedAt)
        })(wecruitPlan);
    expect(result).toMatchObject({ ok: false, failureReason: expect.stringMatching(/HTTP 503/) });
    if (result.ok || !result.fetchEvidence) throw new Error("Expected HTTP failure evidence");
    expect(result.fetchEvidence.artifacts.length).toBeGreaterThanOrEqual(1);
    expect(result.fetchEvidence.artifacts.every((artifact) =>
      artifact.httpStatus === 503 && artifact.contentType === "text/html" && artifact.body === html
    )).toBe(true);
  });

  it.each(["legacy", "wecruit"] as const)("archives 200 wrong-MIME %s bodies before failing closed", async (kind) => {
    const body = JSON.stringify(kind === "legacy"
      ? { data: { currentPage: 1, details: [legacyJob("a")] } }
      : { data: { pageForm: { currentPage: 1, pageData: [wecruitJob("a")] } } });
    const result = kind === "legacy"
      ? await createHotjobLegacySourceFetch({
          http: async () => ({ ...legacyResponse({}, { contentType: "text/html" }), body }), now: () => new Date(capturedAt)
        })(legacyPlan)
      : await createHotjobWecruitSourceFetch({
          http: async () => ({ ...wecruitResponse({}, { contentType: "text/html" }), body }), now: () => new Date(capturedAt)
        })(wecruitPlan);
    expect(result).toMatchObject({ ok: false, failureReason: expect.stringContaining("Content-Type") });
    if (result.ok || !result.fetchEvidence) throw new Error("Expected MIME failure evidence");
    expect(result.fetchEvidence.artifacts.at(-1)).toMatchObject({ contentType: "text/html", body });
  });

  it.each([
    ["legacy", "parse"], ["legacy", "metadata"], ["wecruit", "parse"], ["wecruit", "metadata"]
  ] as const)("retains prior %s page state on later-page %s failure", async (kind, failureKind) => {
    let page = 0;
    const result = kind === "legacy"
      ? await createHotjobLegacySourceFetch({
          now: () => new Date(capturedAt),
          http: async () => {
            page += 1;
            if (page === 1) return legacyResponse({ data: { rowCount: 2, currentPage: 1, details: [legacyJob("a")] } });
            if (failureKind === "metadata") {
              const response = legacyResponse({ data: { rowCount: 2, currentPage: 2, details: [legacyJob("b")] } });
              delete response.finalUrl;
              return response;
            }
            return { ...legacyResponse({}), body: "{invalid" };
          }
        })(legacyPlan)
      : await createHotjobWecruitSourceFetch({
          now: () => new Date(capturedAt),
          http: async () => {
            page += 1;
            if (page === 1) return wecruitResponse({ data: { pageForm: { totalPage: 2, currentPage: 1, pageData: [wecruitJob("a")] } } });
            if (failureKind === "metadata") {
              const response = wecruitResponse({ data: { pageForm: { totalPage: 2, currentPage: 2, pageData: [wecruitJob("b")] } } });
              delete response.capturedAt;
              return response;
            }
            return { ...wecruitResponse({}), body: "{invalid" };
          }
        })(wecruitPlan);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok && result.fetchEvidence) {
      expect(result.fetchEvidence.artifacts[0]?.body).toContain(kind === "legacy" ? "Role a" : "Role a");
      expect(result.fetchEvidence.pages[0]?.termination).toBe(
        failureKind === "metadata" ? "ABORTED" : "CONTINUE"
      );
      expect(result.fetchEvidence.pages.length).toBeGreaterThanOrEqual(1);
      if (failureKind === "parse") {
        expect(result.fetchEvidence.artifacts).toHaveLength(2);
        expect(result.fetchEvidence.pages).toHaveLength(2);
      } else {
        expect(result.fetchEvidence.artifacts).toHaveLength(1);
      }
    } else {
      throw new Error("Expected retained prior evidence");
    }
  });

  it("uses safe terminal facts for all-throw and 503-then-throw without leaking transport errors", async () => {
    const allThrow = await createHotjobWecruitSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => { throw new Error("Bearer example-placeholder"); }
    })(wecruitPlan);
    expect(allThrow).toMatchObject({ ok: false, failureReason: expect.stringMatching(/TRANSPORT_FAILURE.*ATTEMPT_2/) });
    expect(JSON.stringify(allThrow)).not.toContain("top-secret-transport");

    let attempt = 0;
    const mixed = await createHotjobWecruitSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        attempt += 1;
        if (attempt === 1) return { ...wecruitResponse({}, { status: 503, contentType: "text/html" }), body: "temporary" };
        throw new Error("cookie=session-secret");
      }
    })(wecruitPlan);
    expect(mixed).toMatchObject({
      ok: false,
      failureReason: expect.stringMatching(/TRANSPORT_FAILURE.*ATTEMPT_2/),
      fetchEvidence: {
        artifacts: [expect.objectContaining({ httpStatus: 503, body: "temporary" })],
        fetchLosses: [expect.objectContaining({ details: expect.objectContaining({ code: "TRANSPORT_FAILURE", noteCode: "ATTEMPT_2" }) })]
      }
    });
    expect(JSON.stringify(mixed, (key, value) => key === "body" ? "<opaque>" : value)).not.toContain("session-secret");
  });

  it("rejects NFKC Chinese overseas scope while retaining explicit China and mixed-scope facts", async () => {
    const records = [
      legacyJob("us", { WorkPlace: "美国" }),
      legacyJob("sg", { WorkPlace: "新加坡" }),
      legacyJob("jp", { WorkPlace: "日本东京" }),
      legacyJob("in", { WorkPlace: "印度" }),
      legacyJob("de", { WorkPlace: "德国" }),
      legacyJob("fr", { WorkPlace: "法国" }),
      legacyJob("ca", { WorkPlace: "加拿大" }),
      legacyJob("au", { WorkPlace: "澳大利亚" }),
      legacyJob("uk", { WorkPlace: "英国伦敦" }),
      legacyJob("cn", { WorkPlace: "中华人民共和国上海市" }),
      legacyJob("mixed", { WorkPlace: "中国及美国" })
    ];
    const result = await createHotjobLegacySourceFetch({
      now: () => new Date(capturedAt),
      http: async () => legacyResponse({ data: { currentPage: 1, details: records } })
    })({ ...legacyPlan, hotjobLegacy: { ...legacyPlan.hotjobLegacy, maxPages: 1 } });
    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: { rawCount: 11, parsedCount: 11, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 9 }
      }
    });
  });

  it.each([
    "https://user:placeholder@legacy.hotjob.cn/wt/TEST/web/index",
    "https://legacy.hotjob.cn/wt/TEST/web/index?apiKey=secret-value",
    "https://legacy.hotjob.cn/wt/token=secret/web/index",
    "https://legacy.hotjob.cn/wt/TEST/web/index#session=secret"
  ])("rejects unsafe Legacy official entry before any request: %s", async (officialEntryUrl) => {
    let calls = 0;
    const result = await createHotjobLegacySourceFetch({
      now: () => new Date(capturedAt),
      http: async () => { calls += 1; return legacyResponse({ data: { currentPage: 1, details: [legacyJob("a")] } }); }
    })({ ...legacyPlan, source: { ...legacyPlan.source, officialEntryUrl } });
    expect(result).toMatchObject({ ok: false, failureReason: expect.stringMatching(/entry URL|credential/i) });
    expect(calls).toBe(0);
  });

  it("cleans a harmless Legacy Referer before sending and rejects an unsafe list URL before request", async () => {
    const referers: string[] = [];
    const harmlessEntry = "https://legacy.hotjob.cn/wt/TEST/web/index?locale=zh-CN#jobs";
    const cleanResult = await createHotjobLegacySourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        referers.push(request.headers.Referer!);
        return legacyResponse({ data: { currentPage: 1, details: [legacyJob("a")] } });
      }
    })({ ...legacyPlan, source: { ...legacyPlan.source, officialEntryUrl: harmlessEntry }, hotjobLegacy: { ...legacyPlan.hotjobLegacy, maxPages: 1 } });
    expect(cleanResult).toMatchObject({ ok: true });
    expect(referers).toEqual(["https://legacy.hotjob.cn/wt/TEST/web/index"]);

    let unsafeCalls = 0;
    const unsafeResult = await createHotjobLegacySourceFetch({
      now: () => new Date(capturedAt),
      http: async () => { unsafeCalls += 1; return legacyResponse({}); }
    })({ ...legacyPlan, hotjobLegacy: { ...legacyPlan.hotjobLegacy, listUrl: "https://legacy.hotjob.cn/api/token=secret/list" } });
    expect(unsafeResult).toMatchObject({ ok: false });
    expect(unsafeCalls).toBe(0);
  });

  it("returns a fixed safe Legacy transport fact for a first-page throw without fabricating evidence", async () => {
    const result = await createHotjobLegacySourceFetch({
      now: () => new Date(capturedAt),
      http: async () => { throw new Error("Authorization=Bearer example-placeholder"); }
    })(legacyPlan);
    expect(result).toEqual({
      ok: false,
      capturedAt,
      failureReason: "Hotjob legacy TRANSPORT_FAILURE at PAGE_1 ATTEMPT_1"
    });
    expect(JSON.stringify(result)).not.toContain("first-page-secret");
  });

  it("returns a fixed safe Legacy transport fact for a later-page throw and aborts exact prior evidence", async () => {
    let page = 0;
    const result = await createHotjobLegacySourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        page += 1;
        if (page === 2) throw new Error("cookie=later-page-secret");
        return legacyResponse({ data: { rowCount: 2, currentPage: 1, details: [legacyJob("a")] } });
      }
    })(legacyPlan);
    expect(result).toMatchObject({
      ok: false,
      failureReason: "Hotjob legacy TRANSPORT_FAILURE at PAGE_2 ATTEMPT_1",
      fetchEvidence: {
        artifacts: [expect.objectContaining({ logicalKey: "hotjob-legacy-page-0000" })],
        pages: [expect.objectContaining({ sequence: 0, termination: "ABORTED" })]
      }
    });
    expect(JSON.stringify(result, (key, value) => key === "body" ? "<opaque>" : value)).not.toContain("later-page-secret");
  });

  it("never echoes a malformed credential-bearing Legacy URL through a native URL error", async () => {
    const malformedSecret = "https://[token=malformed-secret";
    const result = await createHotjobLegacySourceFetch({
      now: () => new Date(capturedAt),
      http: async () => { throw new Error("must not be called"); }
    })({ ...legacyPlan, hotjobLegacy: { ...legacyPlan.hotjobLegacy, listUrl: malformedSecret } });
    expect(result).toMatchObject({ ok: false, failureReason: "Hotjob request URL is invalid" });
    expect(JSON.stringify(result)).not.toContain("malformed-secret");
  });
});
