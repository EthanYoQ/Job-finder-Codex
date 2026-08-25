import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import {
  captureOfficialJsonRenderedTraversal,
  OFFICIAL_JSON_RENDERED_REQUIRED_CERTIFICATES,
  OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES,
  replayOfficialJsonRenderedTraversal,
  type OfficialJsonRenderedPageCapture
} from "../../src/crawler/officialJsonRenderedTraversalValidator";
import {
  createOfficialJsonSourceFetch,
  type OfficialJsonHttpRequest,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import {
  irreversibleOfficialJsonEvidenceId,
  persistentOfficialJsonJobId
} from "../../src/crawler/officialJsonEvidence";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { classifyBGradeIndependentTraversalFailure } from "../../src/crawler/independentTraversalDiagnostics";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  sourcePlanConfigSha256
} from "../../src/crawler/sourcePlan";
import { canonicalStringSetSha256 } from "../../src/crawler/sourceFetchEvidence";
import {
  createOfficialJsonRenderedTraversalValidation,
  issueBGradeTraversalCertificate,
  requiresBGradeCertificateSourceId,
  verifyBGradeTraversalCertificateReceipt
} from "../../src/crawler/traversalCertificate";

const observedAt = "2026-08-14T00:00:00.000Z";
const expiresAt = "2026-08-21T00:00:00.000Z";

describe("official JSON rendered traversal", () => {
  it("registers the three remaining launch sources as B-grade certificate authorities", () => {
    expect(OFFICIAL_JSON_RENDERED_REQUIRED_CERTIFICATES).toEqual({
      "source-cspc-social": "company-cspc",
      "source-nhu-social": "company-nhu",
      "source-xiuzheng-social": "company-xiuzheng"
    });
    expect(Object.keys(OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES)).toEqual([
      "source-cspc-social",
      "source-nhu-social",
      "source-xiuzheng-social"
    ]);
    for (const sourceId of Object.keys(OFFICIAL_JSON_RENDERED_REQUIRED_CERTIFICATES)) {
      expect(requiresBGradeCertificateSourceId(sourceId)).toBe(true);
    }
  });

  it("replays CSPC, NHU, and Xiuzheng with the same source job identities as their main adapters", () => {
    const cspcId = "00000000-0000-4000-8000-000000000001";
    expect(replayOfficialJsonRenderedTraversal("source-cspc-social", [page({
      channelId: "surface-cspc-social:0beb3022-3214-4333-a2e7-20786c4916d5",
      uiRequestCandidateIds: [cspcId],
      rows: [{
        sourceJobId: `0beb3022-3214-4333-a2e7-20786c4916d5:${cspcId}`,
        rawEvidenceId: irreversibleOfficialJsonEvidenceId(cspcId),
        scopeMarker: "SOCIAL_CHANNEL",
        scopeDecision: "INCLUDED_MAINLAND",
        recordIndex: 0,
        rawPayload: { REQUEST_ID: cspcId }
      }]
    })])).toMatchObject({ rawCount: 1, excludedCount: 0 });

    const nhuMainlandId = "00000000-0000-4000-8000-000000000002";
    const nhuJapanId = "00000000-0000-4000-8000-000000000003";
    expect(replayOfficialJsonRenderedTraversal("source-nhu-social", [page({ rows: [
      {
        sourceJobId: persistentOfficialJsonJobId(nhuMainlandId),
        rawEvidenceId: irreversibleOfficialJsonEvidenceId(nhuMainlandId),
        scopeMarker: JSON.stringify(["上海市"]),
        scopeDecision: "INCLUDED_MAINLAND",
        recordIndex: 0,
        rawPayload: { Id: nhuMainlandId, LocNames: ["上海市"] }
      },
      {
        sourceJobId: persistentOfficialJsonJobId(nhuJapanId),
        rawEvidenceId: irreversibleOfficialJsonEvidenceId(nhuJapanId),
        scopeMarker: JSON.stringify(["日本·东京"]),
        scopeDecision: "EXCLUDED_AUDITED",
        recordIndex: 1,
        rawPayload: { Id: nhuJapanId, LocNames: ["日本·东京"] }
      }
    ] })])).toMatchObject({ rawCount: 2, excludedCount: 1 });

    const xiuzhengRaw = { id: 16, name: "研发工程师" };
    const xiuzhengExcluded = { id: 17, name: "用人理念" };
    expect(replayOfficialJsonRenderedTraversal("source-xiuzheng-social", [page({ rows: [
      {
        sourceJobId: "16",
        rawEvidenceId: irreversibleOfficialJsonEvidenceId([0, xiuzhengRaw]),
        scopeMarker: xiuzhengRaw.name,
        scopeDecision: "INCLUDED_MAINLAND",
        recordIndex: 0,
        rawPayload: xiuzhengRaw
      },
      {
        sourceJobId: "17",
        rawEvidenceId: irreversibleOfficialJsonEvidenceId([1, xiuzhengExcluded]),
        scopeMarker: xiuzhengExcluded.name,
        scopeDecision: "EXCLUDED_AUDITED",
        recordIndex: 1,
        rawPayload: xiuzhengExcluded
      }
    ] })])).toEqual(expect.objectContaining({
      matchKeys: ["16"],
      rawSourceJobIds: ["16", "17"],
      excludedSourceJobIds: ["17"]
    }));
  });

  it("creates a strict validation and rejects scope, evidence, and pagination forgeries", () => {
    const rows = [{
      sourceJobId: "16",
      rawEvidenceId: irreversibleOfficialJsonEvidenceId([0, { id: 16, name: "研发工程师" }]),
      scopeMarker: "研发工程师",
      scopeDecision: "INCLUDED_MAINLAND" as const,
      recordIndex: 0,
      rawPayload: { id: 16, name: "研发工程师" }
    }];
    const validation = createOfficialJsonRenderedTraversalValidation({
      sourceId: "source-xiuzheng-social",
      companyId: "company-xiuzheng",
      sourceConfigSha256: "a".repeat(64),
      surfaceIds: ["surface-xiuzheng-social"],
      channelIds: ["source:source-xiuzheng-social:default"],
      pages: [page({ rows })],
      observedAt,
      expiresAt
    });
    expect(validation).toMatchObject({
      schemaVersion: "official-json-browser-network-traversal-v1",
      pages: [{ matchKeys: ["16"], rawRows: rows }]
    });

    expect(() => replayOfficialJsonRenderedTraversal("source-xiuzheng-social", [page({ rows: [{
      ...rows[0]!, scopeMarker: "用人理念"
    }] })])).toThrow(/raw row identity mismatch|scope decision mismatch/i);
    expect(() => replayOfficialJsonRenderedTraversal("source-xiuzheng-social", [page({ rows: [{
      ...rows[0]!, sourceJobId: "999999"
    }] })])).toThrow(/raw row identity mismatch/i);
    expect(() => replayOfficialJsonRenderedTraversal("source-xiuzheng-social", [page({ rows: [
      rows[0]!, { ...rows[0]!, sourceJobId: "17", recordIndex: 1 }
    ] })])).toThrow(/raw row identity mismatch|raw set does not reconcile/i);
    expect(() => replayOfficialJsonRenderedTraversal("source-xiuzheng-social", [{
      ...page({ rows }), declaredTotalPages: 2
    }])).toThrow(/pagination equation mismatch/i);
  });

  it("binds CSPC and NHU responses to their exact official origins", async () => {
    const cspcId = "00000000-0000-4000-8000-000000000010";
    const cspcPage = responsePage({
      expectedOrigin: "https://ehr.e-cspc.com:8081",
      path: "/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob",
      requestBody: new URLSearchParams({
        channelQrId: "0beb3022-3214-4333-a2e7-20786c4916d5",
        sortName: "zri.ext_rankNum",
        peopleId: "",
        root_id: "cspc",
        shareStaff: "",
        push_request_id: cspcId,
        keyword: "",
        ftl_list_stru_id: ""
      }).toString(),
      responseBody: { state: "1", total: "", jsonList: [{ REQUEST_ID: cspcId,
        PUBLISH_NAME: "研发工程师", work_place: "上海市", UPDATE_TIME: "2026-08-14 00:00:00" }] },
      renderedRows: ["1研发工程师1上海市--2026-08-14 00:00:00"]
    });
    const cspc = await captureOfficialJsonRenderedTraversal({
      sourceId: "source-cspc-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-cspc-social"].entryUrl,
      launchBrowser: async () => browser(cspcPage)
    });
    expect(cspcPage.crossOriginAccepted).toBe(false);
    expect(cspcPage.searchClicks).toBe(1);
    expect(cspc.pages[0]?.rawRows[0]).toMatchObject({ rawPayload: { REQUEST_ID: cspcId } });

    const cspcWithNext = responsePage({
      expectedOrigin: "https://ehr.e-cspc.com:8081",
      path: "/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob",
      requestBody: new URLSearchParams({
        channelQrId: "0beb3022-3214-4333-a2e7-20786c4916d5",
        sortName: "zri.ext_rankNum",
        peopleId: "",
        root_id: "cspc",
        shareStaff: "",
        push_request_id: cspcId,
        keyword: "",
        ftl_list_stru_id: ""
      }).toString(),
      responseBody: { state: "1", total: "", jsonList: [{ REQUEST_ID: cspcId,
        PUBLISH_NAME: "研发工程师", work_place: "上海市", UPDATE_TIME: "2026-08-14 00:00:00" }] },
      renderedRows: ["1研发工程师1上海市--2026-08-14 00:00:00"],
      cspcClicksBeforeRender: 2,
      cspcHasNext: true
    });
    await expect(captureOfficialJsonRenderedTraversal({
      sourceId: "source-cspc-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-cspc-social"].entryUrl,
      launchBrowser: async () => browser(cspcWithNext)
    })).rejects.toThrow(/untraversed continuation control/i);

    const nhuId = "00000000-0000-4000-8000-000000000011";
    const nhuPage = responsePage({
      expectedOrigin: "https://xinhecheng1.zhiye.com",
      path: "/api/Jobad/GetJobAdPageList",
      requestBody: JSON.stringify({ PageIndex: 0, PageSize: 20, Category: ["1"], KeyWords: "", SpecialType: 0,
        PortalId: "", DisplayFields: ["Category", "Kind", "LocId", "PostDate", "WorkWeChatQrCode"] }),
      responseBody: { Code: 200, Count: 1, PageIndex: 0, Data: [{ Id: nhuId, LocNames: ["上海市"] }] }
    });
    const nhu = await captureOfficialJsonRenderedTraversal({
      sourceId: "source-nhu-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-nhu-social"].entryUrl,
      launchBrowser: async () => browser(nhuPage)
    });
    expect(nhuPage.crossOriginAccepted).toBe(false);
    expect(nhu.pages[0]?.rawRows[0]).toMatchObject({ rawPayload: { Id: nhuId } });
  });

  it("accepts CSPC when the exact initial official response is already rendered", async () => {
    const cspcId = "00000000-0000-4000-8000-000000000012";
    const cspcPage = responsePage({
      expectedOrigin: "https://ehr.e-cspc.com:8081",
      path: "/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob",
      requestBody: new URLSearchParams({
        channelQrId: "0beb3022-3214-4333-a2e7-20786c4916d5",
        sortName: "zri.ext_rankNum",
        peopleId: "",
        root_id: "cspc",
        shareStaff: "",
        push_request_id: cspcId,
        keyword: "",
        ftl_list_stru_id: ""
      }).toString(),
      responseBody: { state: "1", total: "", jsonList: [{ REQUEST_ID: cspcId,
        PUBLISH_NAME: "研发工程师", work_place: "上海市", UPDATE_TIME: "2026-08-14 00:00:00" }] },
      renderedRows: ["1研发工程师1上海市--2026-08-14 00:00:00"],
      cspcInitiallyRendered: true
    });

    await expect(captureOfficialJsonRenderedTraversal({
      sourceId: "source-cspc-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-cspc-social"].entryUrl,
      launchBrowser: async () => browser(cspcPage)
    })).resolves.toMatchObject({ pages: [{ rawRows: [{ rawPayload: { REQUEST_ID: cspcId } }] }] });
    expect(cspcPage.searchClicks).toBe(0);
  });

  it("rejects response IDs outside CSPC UI candidates and narrowed request protocols", async () => {
    const cspcId = "00000000-0000-4000-8000-000000000020";
    const unrelatedId = "00000000-0000-4000-8000-000000000021";
    expect(() => replayOfficialJsonRenderedTraversal("source-cspc-social", [page({
      channelId: "surface-cspc-social:0beb3022-3214-4333-a2e7-20786c4916d5",
      uiRequestCandidateIds: [unrelatedId],
      rows: [{
        sourceJobId: `0beb3022-3214-4333-a2e7-20786c4916d5:${cspcId}`,
        rawEvidenceId: irreversibleOfficialJsonEvidenceId(cspcId),
        scopeMarker: "SOCIAL_CHANNEL",
        scopeDecision: "INCLUDED_MAINLAND",
        recordIndex: 0,
        rawPayload: { REQUEST_ID: cspcId }
      }]
    })])).toThrow(/request scope is invalid/i);

    const duplicateCspcKey = responsePage({
      expectedOrigin: "https://ehr.e-cspc.com:8081",
      path: "/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob",
      requestBody: `${new URLSearchParams({
        channelQrId: "0beb3022-3214-4333-a2e7-20786c4916d5",
        sortName: "zri.ext_rankNum",
        peopleId: "",
        root_id: "cspc",
        shareStaff: "",
        push_request_id: cspcId,
        keyword: "",
        ftl_list_stru_id: ""
      }).toString()}&keyword=shadow`,
      responseBody: { state: "1", total: "", jsonList: [{ REQUEST_ID: cspcId }] }
    });
    await expect(captureOfficialJsonRenderedTraversal({
      sourceId: "source-cspc-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-cspc-social"].entryUrl,
      launchBrowser: async () => browser(duplicateCspcKey)
    })).rejects.toThrow(/request contract mismatch|unexpected keys/i);

    const nhuId = "00000000-0000-4000-8000-000000000022";
    const narrowedNhu = responsePage({
      expectedOrigin: "https://xinhecheng1.zhiye.com",
      path: "/api/Jobad/GetJobAdPageList",
      requestBody: JSON.stringify({ PageIndex: 0, PageSize: 20, Category: ["1"], KeyWords: "", SpecialType: 0,
        PortalId: "", DisplayFields: ["Category", "Kind", "LocId", "PostDate", "WorkWeChatQrCode"],
        Department: "China" }),
      responseBody: { Code: 200, Count: 1, PageIndex: 0, Data: [{ Id: nhuId, LocNames: ["上海市"] }] }
    });
    await expect(captureOfficialJsonRenderedTraversal({
      sourceId: "source-nhu-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-nhu-social"].entryUrl,
      launchBrowser: async () => browser(narrowedNhu)
    })).rejects.toThrow(/response predicate rejected|request contract mismatch|unexpected keys/i);

    const narrowedXiuzheng = xiuzhengUiPage({ id: 16, name: "研发工程师" },
      JSON.stringify({ page: 1, page_size: 10, department: "研发" }));
    await expect(captureOfficialJsonRenderedTraversal({
      sourceId: "source-xiuzheng-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-xiuzheng-social"].entryUrl,
      launchBrowser: async () => browser(narrowedXiuzheng)
    })).rejects.toThrow(/unexpected keys/i);
  });

  it("ignores a narrowed NHU request before the exact same-page protocol response", async () => {
    const nhuId = "00000000-0000-4000-8000-000000000023";
    const exactRequest = { PageIndex: 0, PageSize: 20, Category: ["1"], KeyWords: "", SpecialType: 0,
      PortalId: "", DisplayFields: ["Category", "Kind", "LocId", "PostDate", "WorkWeChatQrCode"] };
    const pageObject = responsePage({
      expectedOrigin: "https://xinhecheng1.zhiye.com",
      path: "/api/Jobad/GetJobAdPageList",
      requestBody: JSON.stringify(exactRequest),
      precedingOfficialRequestBody: JSON.stringify({ ...exactRequest, Department: "China" }),
      responseBody: { Code: 200, Count: 1, PageIndex: 0, Data: [{ Id: nhuId, LocNames: ["上海市"] }] }
    });

    await expect(captureOfficialJsonRenderedTraversal({
      sourceId: "source-nhu-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-nhu-social"].entryUrl,
      launchBrowser: async () => browser(pageObject)
    })).resolves.toMatchObject({ pages: [{ rawRows: [{ rawPayload: { Id: nhuId } }] }] });
    expect(pageObject.precedingOfficialAccepted).toBe(false);
  });

  it("drives the Xiuzheng UI route and rendered list instead of calling fetch from page evaluation", async () => {
    const raw = { id: 16, name: "研发工程师" };
    const pageObject = xiuzhengUiPage(raw);
    const captured = await captureOfficialJsonRenderedTraversal({
      sourceId: "source-xiuzheng-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-xiuzheng-social"].entryUrl,
      launchBrowser: async () => browser(pageObject)
    });
    expect(pageObject.routeClicks).toEqual(["人力资源", "查看更多"]);
    expect("evaluate" in pageObject).toBe(false);
    expect(captured.pages[0]?.rawRows[0]).toMatchObject({ sourceJobId: "16", rawPayload: raw });
  });

  it("waits for delayed Xiuzheng SPA route controls after DOMContentLoaded", async () => {
    const raw = { id: 16, name: "研发工程师" };
    const pageObject = xiuzhengUiPage(raw, undefined, { deferRouteControls: true });

    await expect(captureOfficialJsonRenderedTraversal({
      sourceId: "source-xiuzheng-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-xiuzheng-social"].entryUrl,
      launchBrowser: async () => browser(pageObject)
    })).resolves.toMatchObject({ pages: [{ rawRows: [{ sourceJobId: "16" }] }] });

    expect(pageObject.routeControlWaits).toEqual(["人力资源", "查看更多"]);
  });

  it("accepts one visible Xiuzheng route control when a hidden responsive duplicate comes first", async () => {
    const raw = { id: 16, name: "研发工程师" };
    const pageObject = xiuzhengUiPage(raw, undefined, {
      totalRouteControlCount: 2,
      visibleRouteControlCount: 1
    });

    await expect(captureOfficialJsonRenderedTraversal({
      sourceId: "source-xiuzheng-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-xiuzheng-social"].entryUrl,
      launchBrowser: async () => browser(pageObject)
    })).resolves.toMatchObject({ pages: [{ rawRows: [{ sourceJobId: "16" }] }] });

    expect(pageObject.routeControlWaits).toEqual(["人力资源", "查看更多"]);
  });

  it("preserves an abort raised while Xiuzheng waits for a delayed route control", async () => {
    const controller = new AbortController();
    const pageObject = xiuzhengUiPage({ id: 16, name: "研发工程师" }, undefined, {
      deferRouteControls: true,
      abortDuringRouteControlWait: controller
    });
    const close = vi.fn(async () => undefined);

    await expect(captureOfficialJsonRenderedTraversal({
      sourceId: "source-xiuzheng-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-xiuzheng-social"].entryUrl,
      signal: controller.signal,
      launchBrowser: async () => ({ newPage: async () => pageObject as never, close })
    })).rejects.toThrow("cancelled during Xiuzheng route readiness");

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("preserves and classifies an abort raised while Xiuzheng counts visible route controls", async () => {
    const controller = new AbortController();
    const abortReason = new Error("cancelled during Xiuzheng visible control count");
    const pageObject = xiuzhengUiPage({ id: 16, name: "研发工程师" }, undefined, {
      abortDuringRouteControlCount: { controller, reason: abortReason }
    });
    const close = vi.fn(async () => undefined);

    let captured: unknown;
    try {
      await captureOfficialJsonRenderedTraversal({
        sourceId: "source-xiuzheng-social",
        entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-xiuzheng-social"].entryUrl,
        signal: controller.signal,
        launchBrowser: async () => ({ newPage: async () => pageObject as never, close })
      });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBe(abortReason);
    expect(classifyBGradeIndependentTraversalFailure(captured)).toBe("B_GRADE_VALIDATOR_ABORTED");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("waits for Xiuzheng pagination to reach the expected active page and rendered rows", async () => {
    const pageObject = xiuzhengTwoPageUi();
    const captured = await captureOfficialJsonRenderedTraversal({
      sourceId: "source-xiuzheng-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-xiuzheng-social"].entryUrl,
      launchBrowser: async () => browser(pageObject)
    });
    expect(captured.pages.map((candidate) => candidate.rawRows[0]?.sourceJobId)).toEqual(["16", "17"]);
    expect(pageObject.routeClicks).toEqual(["人力资源", "查看更多", "page:2"]);
  });

  it.each([
    ["HOME_GOTO", "HOME_GOTO"],
    ["HUMAN_RESOURCE_ROUTE", "HUMAN_RESOURCE_ROUTE"],
    ["RECRUIT_LIST_ROUTE", "RECRUIT_LIST_ROUTE"]
  ] as const)("retains the safe Xiuzheng %s navigation stage", async (failureStage, expectedStage) => {
    const pageObject = xiuzhengUiPage({ id: 16, name: "研发工程师" }, undefined, { failureStage });
    const failure = await captureOfficialJsonRenderedTraversal({
      sourceId: "source-xiuzheng-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-xiuzheng-social"].entryUrl,
      launchBrowser: async () => browser(pageObject)
    }).catch((error: unknown) => error);

    expect(classifyBGradeIndependentTraversalFailure(failure)).toBe("B_GRADE_BROWSER_NAVIGATION_FAILED");
    expect(failure).toMatchObject({ message: `Xiuzheng browser validator ${expectedStage} navigation failed` });
  });

  it("issues and verifies Xiuzheng, then rejects a fully self-rehashed row outside the main raw commitment", async () => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-xiuzheng-social");
    if (!plan || plan.adapterId !== "official-json") throw new Error("Missing Xiuzheng plan");
    const mainRows = [{ id: 17, name: "用人理念" }, { id: 16, name: "研发工程师" }];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(observedAt),
      http: async (request) => jsonResponse(request, {
        code: 0,
        data: { current_page: 1, last_page: 1, per_page: 10, total: mainRows.length, data: mainRows }
      })
    });
    const result = await runSourceCrawl(plan, { fetch: fetcher });
    if (!result.fetchEvidence || !result.paginationEvaluation || !result.reconciliation) {
      throw new Error("Expected Xiuzheng exact crawl evidence");
    }
    const sourceConfigSha256 = sourcePlanConfigSha256(plan);
    const independentValidation = createOfficialJsonRenderedTraversalValidation({
      sourceId: "source-xiuzheng-social",
      companyId: plan.company.id,
      sourceConfigSha256,
      surfaceIds: [plan.source.surfaceId!],
      channelIds: plan.expectedChannels!.map(({ channelId }) => channelId),
      pages: [page({ rows: mainRows.map((rawPayload, recordIndex) => ({
        sourceJobId: String(rawPayload.id),
        rawEvidenceId: irreversibleOfficialJsonEvidenceId([recordIndex, rawPayload]),
        scopeMarker: rawPayload.name,
        scopeDecision: rawPayload.name === "用人理念" ? "EXCLUDED_AUDITED" as const : "INCLUDED_MAINLAND" as const,
        recordIndex,
        rawPayload
      })) })],
      observedAt,
      expiresAt
    });
    const now = new Date("2026-08-14T00:05:00.000Z");
    const decision = issueBGradeTraversalCertificate({
      binding: { releaseCandidateId: "rc-xiuzheng", batchId: "batch-xiuzheng",
        sourceResultId: "result-xiuzheng", sourceConfigSha256 },
      plan,
      transportSuccess: true,
      adapterSuccess: true,
      evidence: result.fetchEvidence,
      paginationEvaluation: result.paginationEvaluation,
      reconciliation: result.reconciliation,
      jobs: result.jobs,
      independentValidation,
      validationExecution: "CURRENT_RUN",
      trigger: "INITIAL_QUALIFICATION",
      now
    });
    expect(decision.status, JSON.stringify(decision)).toBe("CERTIFIED");
    if (decision.status !== "CERTIFIED") throw new Error("Expected Xiuzheng certificate");
    const expected = {
      releaseCandidateId: "rc-xiuzheng",
      batchId: "batch-xiuzheng",
      sourceResultId: "result-xiuzheng",
      sourceId: "source-xiuzheng-social",
      companyId: "company-xiuzheng",
      sourceConfigSha256,
      canonicalRawEvidenceIdSetSha256: canonicalStringSetSha256(
        result.fetchEvidence.pages.flatMap((candidate) => candidate.rawJobIds)
      )
    } as const;
    expect(verifyBGradeTraversalCertificateReceipt({
      certificate: decision.certificate,
      certificateSha256: decision.certificateSha256,
      expected,
      now
    })).toMatchObject({ status: "PASS", finalUniqueJobCount: 1 });

    const forged = structuredClone(decision.certificate);
    if (forged.schemaVersion !== "b-grade-independent-traversal-v2" ||
        forged.independentValidation.schemaVersion !== "official-json-browser-network-traversal-v1") {
      throw new Error("Expected official JSON certificate");
    }
    const forgedPayload = { id: 999999, name: "用人理念" };
    forged.independentValidation.pages[0]!.rawRows[0] = {
      sourceJobId: "999999",
      rawEvidenceId: irreversibleOfficialJsonEvidenceId([0, forgedPayload]),
      scopeMarker: forgedPayload.name,
      scopeDecision: "EXCLUDED_AUDITED",
      recordIndex: 0,
      rawPayload: forgedPayload
    };
    forged.independentValidation.artifactSha256 = canonicalSha256({
      sourceId: forged.independentValidation.sourceId,
      retrievalPath: forged.independentValidation.retrievalPath,
      matchKeyKind: forged.independentValidation.matchKeyKind,
      pages: forged.independentValidation.pages,
      observedAt: forged.independentValidation.observedAt
    });
    forged.mainTraversal.canonicalRawMatchKeySetSha256 = canonicalStringSetSha256(["16", "999999"]);
    forged.mainTraversal.canonicalExcludedMatchKeySetSha256 = canonicalStringSetSha256(["999999"]);
    expect(() => verifyBGradeTraversalCertificateReceipt({
      certificate: forged,
      certificateSha256: canonicalSha256(forged),
      expected,
      now
    })).toThrow(/raw evidence commitment|raw match-key set/i);
  });

  it("rejects NHU locations outside the explicit mainland or audited Japan policy", () => {
    const id = "00000000-0000-4000-8000-000000000004";
    expect(() => replayOfficialJsonRenderedTraversal("source-nhu-social", [page({ rows: [{
      sourceJobId: persistentOfficialJsonJobId(id),
      rawEvidenceId: irreversibleOfficialJsonEvidenceId(id),
      scopeMarker: JSON.stringify(["United States of America"]),
      scopeDecision: "EXCLUDED_AUDITED",
      recordIndex: 0,
      rawPayload: { Id: id, LocNames: ["United States of America"] }
    }] })])).toThrow(/outside the audited scope policy/i);
  });

  it("fails closed when CSPC is aborted while the rendered rows become matching", async () => {
    const controller = new AbortController();
    const id = "00000000-0000-4000-8000-000000000030";
    const pageObject = responsePage({
      expectedOrigin: "https://ehr.e-cspc.com:8081",
      path: "/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob",
      requestBody: new URLSearchParams({
        channelQrId: "0beb3022-3214-4333-a2e7-20786c4916d5",
        sortName: "zri.ext_rankNum",
        peopleId: "",
        root_id: "cspc",
        shareStaff: "",
        push_request_id: id,
        keyword: "",
        ftl_list_stru_id: ""
      }).toString(),
      responseBody: { state: "1", total: "", jsonList: [{ REQUEST_ID: id,
        PUBLISH_NAME: "研发工程师", work_place: "上海市", UPDATE_TIME: "2026-08-14 00:00:00" }] },
      renderedRows: ["1研发工程师1上海市--2026-08-14 00:00:00"],
      abortDuringRenderedRows: controller
    });
    const close = vi.fn(async () => undefined);
    await expect(captureOfficialJsonRenderedTraversal({
      sourceId: "source-cspc-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-cspc-social"].entryUrl,
      signal: controller.signal,
      launchBrowser: async () => ({ newPage: async () => pageObject as never, close })
    })).rejects.toThrow("cancelled during render");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes an aborted launch exactly once and releases the shared browser permit", async () => {
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const controller = new AbortController();
      const close = vi.fn(async () => undefined);
      await expect(captureOfficialJsonRenderedTraversal({
        sourceId: "source-xiuzheng-social",
        entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-xiuzheng-social"].entryUrl,
        signal: controller.signal,
        launchBrowser: async () => {
          controller.abort(new Error("cancelled during launch"));
          return { newPage: vi.fn() as never, close };
        }
      })).rejects.toThrow("cancelled during launch");
      expect(close).toHaveBeenCalledTimes(1);
    }
  });

  it("closes the browser after page creation fails", async () => {
    const close = vi.fn(async () => undefined);
    await expect(captureOfficialJsonRenderedTraversal({
      sourceId: "source-cspc-social",
      entryUrl: OFFICIAL_JSON_RENDERED_TRAVERSAL_POLICIES["source-cspc-social"].entryUrl,
      launchBrowser: async () => ({
        newPage: vi.fn(async () => { throw new Error("page creation failed"); }) as never,
        close
      })
    })).rejects.toThrow("page creation failed");
    expect(close).toHaveBeenCalledTimes(1);
  });
});

function page(input: {
  rows: OfficialJsonRenderedPageCapture["rawRows"];
  channelId?: string;
  uiRequestCandidateIds?: readonly string[];
}): OfficialJsonRenderedPageCapture {
  return {
    channelId: input.channelId ?? "source:source-xiuzheng-social:default",
    pageNumber: 1,
    declaredTotalPages: 1,
    declaredTotalJobs: input.rows.length,
    uiRequestCandidateIds: input.uiRequestCandidateIds ?? [],
    rawRows: input.rows,
    nextControlPresent: false
  };
}

function responsePage(input: {
  expectedOrigin: string;
  path: string;
  requestBody: string;
  responseBody: unknown;
  renderedRows?: readonly string[];
  cspcHasNext?: boolean;
  cspcClicksBeforeRender?: number;
  cspcInitiallyRendered?: boolean;
  abortDuringRenderedRows?: AbortController;
  precedingOfficialRequestBody?: string;
}) {
  const candidate = (origin: string, requestBody = input.requestBody) => ({
    url: () => `${origin}${input.path}`,
    request: () => ({ method: () => "POST", postData: () => requestBody }),
    status: () => 200,
    text: async () => JSON.stringify(input.responseBody)
  });
  let searchClicks = 0;
  const pageObject = {
    get searchClicks() { return searchClicks; },
    crossOriginAccepted: true,
    precedingOfficialAccepted: false,
    waitForResponse: async (predicate: (value: ReturnType<typeof candidate>) => boolean) => {
      pageObject.crossOriginAccepted = predicate(candidate("https://evil.example"));
      if (input.precedingOfficialRequestBody) {
        const preceding = candidate(input.expectedOrigin, input.precedingOfficialRequestBody);
        pageObject.precedingOfficialAccepted = predicate(preceding);
        if (pageObject.precedingOfficialAccepted) return preceding;
      }
      const official = candidate(input.expectedOrigin);
      if (!predicate(official)) throw new Error("Official response predicate rejected its exact origin");
      return official;
    },
    goto: async (url: string) => ({ status: () => 200, url: () => url }),
    frameLocator: () => ({
      getByText: () => ({ count: async () => 1, click: async () => { searchClicks += 1; } }),
      locator: (selector: string) => ({
        allTextContents: async () => {
          const values = selector.includes("vxe-table") &&
              (input.cspcInitiallyRendered || searchClicks >= (input.cspcClicksBeforeRender ?? 1))
            ? [...(input.renderedRows ?? [])]
            : [];
          if (values.length > 0 && input.abortDuringRenderedRows && !input.abortDuringRenderedRows.signal.aborted) {
            input.abortDuringRenderedRows.abort(new Error("cancelled during render"));
          }
          return values;
        },
        count: async () => selector.includes(":not(.is--disabled)")
          ? (input.cspcHasNext ? 1 : 0)
          : selector.includes("is--disabled")
            ? (input.cspcHasNext ? 0 : 1)
            : 0
      })
    }),
    close: vi.fn(async () => undefined)
  };
  return pageObject;
}

function xiuzhengUiPage(
  raw: Record<string, unknown>,
  requestBody = JSON.stringify({ page: 1, page_size: 10 }),
  options: {
    deferRouteControls?: boolean;
    abortDuringRouteControlWait?: AbortController;
    abortDuringRouteControlCount?: { controller: AbortController; reason: Error };
    totalRouteControlCount?: number;
    visibleRouteControlCount?: number;
    failureStage?: "HOME_GOTO" | "HUMAN_RESOURCE_ROUTE" | "RECRUIT_LIST_ROUTE";
  } = {}
) {
  const routeClicks: string[] = [];
  const routeControlWaits: string[] = [];
  const readyRouteControls = new Set(options.deferRouteControls ? [] : ["人力资源", "查看更多"]);
  const response = {
    url: () => "https://www.xiuzheng.com/front/human-resource/job-list",
    request: () => ({ method: () => "POST", postData: () => requestBody }),
    status: () => 200,
    headers: () => ({ "content-type": "application/json" }),
    text: async () => JSON.stringify({ code: 0, data: {
      current_page: 1, last_page: 1, per_page: 10, total: 1, data: [raw]
    } })
  };
  return {
    routeClicks,
    routeControlWaits,
    goto: async (url: string) => {
      if (options.failureStage === "HOME_GOTO") throw new Error("unsafe dynamic home error");
      return { status: () => 200, url: () => url };
    },
    waitForURL: async (url: string) => {
      if (options.failureStage === "HUMAN_RESOURCE_ROUTE" && url.endsWith("#/humanResource")) {
        throw new Error("unsafe dynamic human-resource error");
      }
      if (options.failureStage === "RECRUIT_LIST_ROUTE" && url.endsWith("#/humanmore")) {
        throw new Error("unsafe dynamic recruit-list error");
      }
    },
    waitForResponse: async (predicate: (value: typeof response) => boolean) => {
      if (!predicate(response)) throw new Error("Xiuzheng response predicate rejected the UI request");
      return response;
    },
    getByText: (text: string) => {
      const visibleLocator = {
        first: () => ({ waitFor: async () => {
          routeControlWaits.push(text);
          if (text === "人力资源" && options.abortDuringRouteControlWait &&
              !options.abortDuringRouteControlWait.signal.aborted) {
            options.abortDuringRouteControlWait.abort(new Error("cancelled during Xiuzheng route readiness"));
            throw new Error("route control wait interrupted");
          }
          readyRouteControls.add(text);
        } }),
        count: async () => {
          if (text === "人力资源" && options.abortDuringRouteControlCount &&
              !options.abortDuringRouteControlCount.controller.signal.aborted) {
            options.abortDuringRouteControlCount.controller.abort(options.abortDuringRouteControlCount.reason);
            throw new Error("page closed during visible control count");
          }
          return readyRouteControls.has(text) ? (options.visibleRouteControlCount ?? 1) : 0;
        }
      };
      return {
        filter: () => visibleLocator,
        first: () => ({ waitFor: async () => {
        routeControlWaits.push(text);
        readyRouteControls.add(text);
      } }),
      count: async () => readyRouteControls.has(text) ? (options.totalRouteControlCount ?? 1) : 0,
      click: async () => { routeClicks.push(text); }
      };
    },
    locator: (selector: string) => selector.includes("tabs_detail_content_item")
      ? { allTextContents: async () => [String(raw.name)] }
      : selector.includes("button.active")
        ? { allTextContents: async () => ["1"] }
        : { allTextContents: async () => ["1"] },
    close: vi.fn(async () => undefined)
  };
}

function xiuzhengTwoPageUi() {
  const routeClicks: string[] = [];
  const raws = [{ id: 16, name: "研发工程师" }, { id: 17, name: "质量工程师" }];
  let responseIndex = 0;
  let renderedPage = 1;
  const response = (pageNumber: number) => ({
    url: () => "https://www.xiuzheng.com/front/human-resource/job-list",
    request: () => ({ method: () => "POST", postData: () => JSON.stringify({ page: pageNumber, page_size: 10 }) }),
    status: () => 200,
    headers: () => ({ "content-type": "application/json" }),
    text: async () => JSON.stringify({ code: 0, data: {
      current_page: pageNumber, last_page: 2, per_page: 10, total: 2, data: [raws[pageNumber - 1]]
    } })
  });
  return {
    routeClicks,
    goto: async (url: string) => ({ status: () => 200, url: () => url }),
    waitForURL: async () => undefined,
    waitForResponse: async (predicate: (value: ReturnType<typeof response>) => boolean) => {
      responseIndex += 1;
      const value = response(responseIndex);
      if (!predicate(value)) throw new Error("Xiuzheng response predicate rejected the UI request");
      return value;
    },
    getByText: (text: string) => {
      const locator = {
        first: () => ({ waitFor: async () => undefined }),
        count: async () => 1
      };
      return {
        ...locator,
        filter: () => locator,
        click: async () => { routeClicks.push(text); }
      };
    },
    getByRole: (_role: string, input: { name: string }) => ({
      count: async () => 1,
      click: async () => {
        routeClicks.push(`page:${input.name}`);
        setTimeout(() => { renderedPage = Number(input.name); }, 20);
      }
    }),
    locator: (selector: string) => selector.includes("tabs_detail_content_item")
      ? { allTextContents: async () => [raws[renderedPage - 1]!.name] }
      : selector.includes("button.active")
        ? { allTextContents: async () => [String(renderedPage)] }
        : { allTextContents: async () => ["1", "2"] },
    close: vi.fn(async () => undefined)
  };
}

function browser(pageObject: object) {
  return {
    newPage: async () => pageObject as never,
    close: vi.fn(async () => undefined)
  };
}

function jsonResponse(request: OfficialJsonHttpRequest, body: unknown): OfficialJsonHttpResponse {
  return {
    status: 200,
    body: JSON.stringify(body),
    finalUrl: request.url,
    contentType: "application/json; charset=utf-8",
    capturedAt: observedAt
  };
}

function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const primitive = JSON.stringify(value);
    if (primitive === undefined) throw new Error("Cannot canonicalize undefined");
    return primitive;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8")))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}
