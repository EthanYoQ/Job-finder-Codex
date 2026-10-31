import { load } from "cheerio";
import { z } from "zod";
import { manualCaptureError, manualCaptureSha256, parseManualCaptureJson } from "./manualChromeCaptureEvidence";

const CHANNEL = "0beb3022-3214-4333-a2e7-20786c4916d5";
const endpoint = "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob";
const sha = z.string().regex(/^[0-9a-f]{64}$/u);
const businessSchema = z.object({
  url: z.literal(endpoint), method: z.literal("POST"), http_status: z.literal(200),
  started_at: z.string().datetime({ offset: true }),
  request_form_text: z.string().min(1).max(1_000_000), response_json_text: z.string().min(1).max(16_000_000),
  request_text_sha256: sha, response_text_sha256: sha
});
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
const rowSchema = z.object({
  REQUEST_ID: z.string().min(1), PUBLISH_NAME: z.string().trim().min(1), work_place: z.string().trim().min(1),
  UPDATE_TIME: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u)
});

export interface ManualCspcReplay {
  sourceId: "source-cspc-social";
  partitionIds: readonly ["cspc-social-channel"];
  observedRequestStartedAt: string;
  rawCount: number;
  officialDeclaredTotal: null;
  requestCandidateCount: number;
  absentRequestCandidateIds: string[];
  responseBoundSourceIds: string[];
  canonicalResponseIdSetSha256: string;
  projection: {
    kind: "ORDERED_UNIQUE_PRESENTATION" | "MISSING";
    count: number;
    officialIdExtraction: "NOT_PERFORMED";
    terminalStaticControlsMatch: boolean;
  };
  requestToApproxExportSeconds: number | null;
  gaps: string[];
}

export function replayManualCspcCapture(input: {
  business: unknown; now: Date; rootHtml?: string; frameHtml?: string; renderedExportedAtApprox?: string;
  savedRootArtifactPath?: string; savedFrameArtifactPath?: string;
}): ManualCspcReplay {
  const parsed = businessSchema.safeParse(input.business);
  if (!parsed.success) manualCaptureError("CSPC_MANUAL_BUSINESS_INVALID");
  const business = parsed.data;
  const startedAt = Date.parse(business.started_at);
  if (!Number.isFinite(input.now.getTime()) || startedAt > input.now.getTime()) manualCaptureError("MANUAL_CAPTURE_CLOCK_INVALID");
  if (manualCaptureSha256(business.request_form_text) !== business.request_text_sha256 ||
      manualCaptureSha256(business.response_json_text) !== business.response_text_sha256) {
    manualCaptureError("MANUAL_CAPTURE_BODY_HASH_INVALID");
  }
  const request = new URLSearchParams(business.request_form_text);
  const keys = ["channelQrId", "sortName", "peopleId", "root_id", "shareStaff", "push_request_id", "keyword", "ftl_list_stru_id"].sort();
  const candidates = (request.get("push_request_id") ?? "").split(",").map((id) => id.toLowerCase());
  if (JSON.stringify([...request.keys()].sort()) !== JSON.stringify(keys) || request.get("channelQrId") !== CHANNEL ||
      request.get("root_id") !== "cspc" || request.get("sortName") !== "zri.ext_rankNum" ||
      ["peopleId", "shareStaff", "keyword", "ftl_list_stru_id"].some((key) => request.get(key) !== "") ||
      candidates.length < 1 || candidates.length > 10_000 || candidates.some((id) => !uuid(id)) || new Set(candidates).size !== candidates.length) {
    manualCaptureError("CSPC_MANUAL_REQUEST_INVALID");
  }
  const response = z.object({ state: z.literal("1"), total: z.literal(""), jsonList: z.array(z.unknown()).min(1).max(10_000) })
    .safeParse(parseManualCaptureJson(business.response_json_text));
  if (!response.success) manualCaptureError("CSPC_MANUAL_RESPONSE_INVALID");
  const rows = response.data.jsonList.map((row) => {
    const parsedRow = rowSchema.safeParse(row);
    if (!parsedRow.success) manualCaptureError("CSPC_MANUAL_ROW_INVALID");
    return parsedRow.data;
  });
  const ids = rows.map((row) => row.REQUEST_ID.toLowerCase());
  if (ids.some((id) => !uuid(id) || !candidates.includes(id)) || new Set(ids).size !== ids.length) {
    manualCaptureError("CSPC_MANUAL_IDENTITY_INVALID");
  }
  const gaps = ["RESPONSE_TO_DOM_COHERENCE_UNPROVEN", "MAIN_CAPTURE_COMPARISON_MISSING", "SOCIAL_CHANNEL_GEOGRAPHY_REQUIRES_REVIEWED_SOURCE_BINDING"];
  let projection: ManualCspcReplay["projection"] = { kind: "MISSING", count: 0, officialIdExtraction: "NOT_PERFORMED", terminalStaticControlsMatch: false };
  if (Boolean(input.rootHtml) !== Boolean(input.frameHtml)) manualCaptureError("CSPC_MANUAL_RENDERED_INVALID");
  if (input.rootHtml && input.frameHtml) {
    const tuples = rows.map((row) => [row.PUBLISH_NAME, row.work_place, row.UPDATE_TIME].map(normalize));
    if (new Set(tuples.map((tuple) => JSON.stringify(tuple))).size !== tuples.length) {
      manualCaptureError("CSPC_MANUAL_PROJECTION_AMBIGUOUS");
    }
    const root = load(input.rootHtml); const frame = load(input.frameHtml);
    if (!input.savedRootArtifactPath || !input.savedFrameArtifactPath) manualCaptureError("CSPC_MANUAL_FRAME_BINDING_INVALID");
    if (root("base[href]").length > 0 || root("iframe#recruit-content-iframe[srcdoc]").length > 0) {
      manualCaptureError("CSPC_MANUAL_FRAME_BINDING_INVALID");
    }
    const iframeSrc = root("iframe#recruit-content-iframe").attr("src");
    let frameReferenceMatches = false;
    try {
      const rootUrl = new URL(input.savedRootArtifactPath, "https://retained-capture.invalid/");
      const expected = new URL(input.savedFrameArtifactPath, "https://retained-capture.invalid/");
      frameReferenceMatches = !!iframeSrc && new URL(iframeSrc, rootUrl).href === expected.href;
    } catch { /* A malformed or external saved-frame reference is not bound. */ }
    if (!frameReferenceMatches) manualCaptureError("CSPC_MANUAL_FRAME_BINDING_INVALID");
    const rendered = frame(".vxe-table--body tbody tr");
    const searchLeaves = frame("body *").filter((_index, element) => frame(element).children().length === 0 && normalize(frame(element).text()) === "搜索");
    if (root("iframe#recruit-content-iframe").length !== 1 || frame(".vxe-table--body").length !== 1 ||
        rendered.length !== rows.length || searchLeaves.length !== 1 ||
        frame(".vxe-pager--next-btn").length !== 1 || frame(".vxe-pager--next-btn.is--disabled").length !== 1 ||
        frame(".vxe-pager--jump-next").length !== 1 || frame(".vxe-pager--jump-next.is--disabled").length !== 1 ||
        frame("[class*='load-more']").length !== 0) manualCaptureError("CSPC_MANUAL_RENDERED_INVALID");
    rendered.each((index, element) => {
      const cells = frame(element).children("td"); const title = cells.eq(1).find("a");
      const tuple = [title.text(), cells.eq(3).text(), cells.eq(5).text()].map(normalize);
      if (cells.length !== 6 || title.length !== 1 || normalize(cells.eq(0).text()) !== String(index + 1) ||
          tuple.some((field, i) => !field || field !== tuples[index]![i])) manualCaptureError("CSPC_MANUAL_RENDERED_INVALID");
    });
    projection = { kind: "ORDERED_UNIQUE_PRESENTATION", count: rows.length,
      officialIdExtraction: "NOT_PERFORMED", terminalStaticControlsMatch: true };
    gaps.push("STATIC_SAVED_DOM_NOT_LIVE_VISIBILITY_OR_CLICKABILITY", "RESPONSE_IDS_BOUND_BY_PRESENTATION_NOT_DOM_ID_EXTRACTION");
  } else gaps.push("RENDERED_PROJECTION_MISSING");
  let requestToApproxExportSeconds: number | null = null;
  if (input.renderedExportedAtApprox !== undefined) {
    const exportedAt = Date.parse(input.renderedExportedAtApprox);
    if (!Number.isFinite(exportedAt) || exportedAt < startedAt || exportedAt > input.now.getTime()) manualCaptureError("MANUAL_CAPTURE_CLOCK_INVALID");
    requestToApproxExportSeconds = (exportedAt - startedAt) / 1000;
    gaps.push("EXPORT_TIME_APPROXIMATE_NOT_RENDER_OBSERVATION_TIME");
  }
  return {
    sourceId: "source-cspc-social", partitionIds: ["cspc-social-channel"], observedRequestStartedAt: business.started_at,
    rawCount: rows.length, officialDeclaredTotal: null, requestCandidateCount: candidates.length,
    absentRequestCandidateIds: candidates.filter((id) => !ids.includes(id)),
    responseBoundSourceIds: ids.map((id) => `${CHANNEL}:${id}`),
    canonicalResponseIdSetSha256: manualCaptureSha256(JSON.stringify([...ids].sort())),
    projection, requestToApproxExportSeconds, gaps
  };
}
