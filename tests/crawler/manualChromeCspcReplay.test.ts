// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { replayManualCspcCapture } from "../../src/crawler/manualChromeCspcReplay";

const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
const now = new Date("2026-10-01T09:00:00.000Z");
const replay = (input: Parameters<typeof replayManualCspcCapture>[0]) => replayManualCspcCapture({ ...input, savedRootArtifactPath: "capture.html", savedFrameArtifactPath: "officePage.html" });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture() {
  const request = new URLSearchParams({ channelQrId: "0beb3022-3214-4333-a2e7-20786c4916d5", sortName: "zri.ext_rankNum", peopleId: "", root_id: "cspc", shareStaff: "", push_request_id: ids.join(","), keyword: "", ftl_list_stru_id: "" }).toString();
  const response = JSON.stringify({ state: "1", total: "", jsonList: ids.slice(0, 2).map((REQUEST_ID, i) => ({ REQUEST_ID, PUBLISH_NAME: `Synthetic role ${i}`, work_place: "北京市", UPDATE_TIME: `2026-10-01 08:00:0${i}` })) });
  return { url: "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob", method: "POST", http_status: 200, started_at: "2026-10-01T08:18:38.636Z", request_form_text: request, response_json_text: response, request_text_sha256: hash(request), response_text_sha256: hash(response) };
}
function changedRequest(modify: (value: URLSearchParams) => void) {
  const business = fixture(); const request = new URLSearchParams(business.request_form_text); modify(request);
  business.request_form_text = request.toString(); business.request_text_sha256 = hash(business.request_form_text); return business;
}
function changedRows(modify: (rows: Array<Record<string, string>>) => void) {
  const business = fixture(); const response = JSON.parse(business.response_json_text); modify(response.jsonList);
  business.response_json_text = JSON.stringify(response); business.response_text_sha256 = hash(business.response_json_text); return business;
}
const rootHtml = '<iframe id="recruit-content-iframe" src="officePage.html"></iframe>';
const frameHtml = `<div><button>搜索</button><table class="vxe-table--body"><tbody>${[0, 1].map((i) => `<tr rowid="row_${i + 8}"><td>${i + 1}</td><td><a>Synthetic role ${i}</a><i class="urgent-lightning">急</i></td><td>1</td><td>北京市</td><td>--</td><td>2026-10-01 08:00:0${i}</td></tr>`).join("")}</tbody></table><button class="vxe-pager--next-btn is--disabled"></button><button class="vxe-pager--jump-next is--disabled"></button></div>`;

describe("CSPC manual evidence replay", () => {
  it("keeps candidate membership distinct from an undeclared official total", () => {
    const value = replay({ business: fixture(), now });
    expect(value.rawCount).toBe(2); expect(value.officialDeclaredTotal).toBeNull();
    expect(value.requestCandidateCount).toBe(3); expect(value.absentRequestCandidateIds).toEqual([ids[2]]);
    expect(value.gaps).toContain("RENDERED_PROJECTION_MISSING");
  });
  it("matches exact ordered field cells while never claiming rendered official IDs", () => {
    const value = replay({ business: fixture(), rootHtml, frameHtml, now, renderedExportedAtApprox: "2026-10-01T08:36:02Z" });
    expect(value.projection).toEqual({ kind: "ORDERED_UNIQUE_PRESENTATION", count: 2, officialIdExtraction: "NOT_PERFORMED", terminalStaticControlsMatch: true });
    expect(value.requestToApproxExportSeconds).toBe(1043.364);
    expect(value.gaps).toContain("RESPONSE_TO_DOM_COHERENCE_UNPROVEN");
    expect(value.observedRequestStartedAt).toBe("2026-10-01T08:18:38.636Z");
    expect(value).not.toHaveProperty("certificate"); expect(value).not.toHaveProperty("rawPayload");
  });
  it.each([
    ["root_id", "wrong"], ["keyword", "medicine"], ["peopleId", "private"], ["sortName", "wrong"], ["channelQrId", ids[0]!]
  ])("rejects changed %s scope", (key, value) => {
    expect(() => replay({ business: changedRequest((request) => request.set(key, value)), now })).toThrow("CSPC_MANUAL_REQUEST_INVALID");
  });
  it("rejects duplicate form keys", () => {
    expect(() => replay({ business: changedRequest((request) => request.append("keyword", "")), now })).toThrow("CSPC_MANUAL_REQUEST_INVALID");
  });
  it("rejects case-variant duplicate candidate UUIDs", () => {
    const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const business = changedRequest((request) => request.set("push_request_id", [...ids, uuid, uuid.toUpperCase()].join(",")));
    expect(() => replay({ business, now })).toThrow("CSPC_MANUAL_REQUEST_INVALID");
  });
  it("rejects a saved root iframe pointing at a different frame artifact", () => {
    expect(() => replay({ business: fixture(), rootHtml: rootHtml.replace("officePage.html", "other.html"), frameHtml, now })).toThrow("CSPC_MANUAL_FRAME_BINDING_INVALID");
  });
  it.each([
    `<base href="https://example.invalid/">${rootHtml}`,
    rootHtml.replace('src="officePage.html"', 'src="officePage.html" srcdoc="different rendered document"')
  ])("rejects unsupported saved-frame resolution semantics %#", (html) => {
    expect(() => replay({ business: fixture(), rootHtml: html, frameHtml, now })).toThrow("CSPC_MANUAL_FRAME_BINDING_INVALID");
  });
  it("never mistakes IDs in HTML comments for extracted official row identities", () => {
    const value = replay({ business: fixture(), rootHtml, frameHtml: frameHtml + `<!-- ${ids.join(" ")} -->`, now });
    expect(value.projection.officialIdExtraction).toBe("NOT_PERFORMED");
    expect(value.projection).not.toHaveProperty("officialIdsPresentInDom");
  });
  it("rejects a response ID outside the actual UI request", () => {
    expect(() => replay({ business: changedRows((rows) => { rows[0]!.REQUEST_ID = "10000000-0000-4000-8000-000000000001"; }), now })).toThrow("CSPC_MANUAL_IDENTITY_INVALID");
  });
  it("rejects duplicate response IDs", () => {
    expect(() => replay({ business: changedRows((rows) => { rows[1]!.REQUEST_ID = ids[0]!; }), now })).toThrow("CSPC_MANUAL_IDENTITY_INVALID");
  });
  it("rejects missing full update time", () => {
    expect(() => replay({ business: changedRows((rows) => { delete rows[0]!.UPDATE_TIME; }), now })).toThrow("CSPC_MANUAL_ROW_INVALID");
  });
  it("rejects hash-correct malformed or duplicate-key response JSON", () => {
    const business = fixture(); business.response_json_text = '{"state":"0","state":"1"}'; business.response_text_sha256 = hash(business.response_json_text);
    expect(() => replay({ business, now })).toThrow("MANUAL_CAPTURE_JSON_INVALID");
  });
  it("rejects a modified body with an old digest", () => {
    const business = fixture(); business.response_json_text += " ";
    expect(() => replay({ business, now })).toThrow("MANUAL_CAPTURE_BODY_HASH_INVALID");
  });
  it.each([
    frameHtml.replace("Synthetic role 0</a>", "Prefix Synthetic role 0</a>"),
    frameHtml.replace("2026-10-01 08:00:00", "2026-10-01"),
    frameHtml.replace("vxe-pager--next-btn is--disabled", "vxe-pager--next-btn"),
    frameHtml.replace("<td>北京市</td>", "<td></td>"),
    frameHtml.replace("<td>1</td>", "<td>2</td>")
  ])("rejects incomplete or mismatched saved rendering %#", (html) => {
    expect(() => replay({ business: fixture(), rootHtml, frameHtml: html, now })).toThrow("CSPC_MANUAL_RENDERED_INVALID");
  });
  it("rejects colliding normalized presentation tuples for distinct IDs", () => {
    const business = changedRows((rows) => { rows[1]!.PUBLISH_NAME = rows[0]!.PUBLISH_NAME!; rows[1]!.UPDATE_TIME = rows[0]!.UPDATE_TIME!; });
    expect(() => replay({ business, rootHtml, frameHtml, now })).toThrow("CSPC_MANUAL_PROJECTION_AMBIGUOUS");
  });
  it("rejects future observations without replacing their time", () => {
    expect(() => replay({ business: fixture(), now: new Date("2026-10-01T08:00:00Z") })).toThrow("MANUAL_CAPTURE_CLOCK_INVALID");
  });
});
