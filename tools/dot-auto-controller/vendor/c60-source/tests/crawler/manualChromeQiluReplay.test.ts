// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { replayManualQiluCapture } from "../../src/crawler/manualChromeQiluReplay";

const now = new Date("2026-10-01T09:00:00Z");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function row(index: number) { return { Id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, JobAdId: index + 1,
  JobAdName: "Synthetic shared title(J00001)", CategoryId: "1", Status: 1, LocNames: ["山东省·济南市"],
  PostDate: index === 0 ? "2023-10-19T00:00:00.1234567" : "2026-09-30T12:00:00", ChangeDate: "2026-09-30T12:00:00",
  EndTime: "0001-01-01T00:00:00", EndTimeInt: 0, Channel4IsLong: index === 0 }; }
function entry(index: number, total: number) {
  const request_json_text = JSON.stringify({ PageIndex: index, PageSize: 15, Category: ["1"], KeyWords: "", SpecialType: 0, PortalId: "", DisplayFields: ["Category", "LocId", "Org", "PostDate", "WorkWeChatQrCode"] });
  const response_json_text = JSON.stringify({ Code: 200, Count: total, Data: Array.from({ length: Math.min(15, Math.max(0, total - index * 15)) }, (_, i) => row(index * 15 + i)) });
  return { started_at: `2026-10-01T08:${String(index).padStart(2, "0")}:00.000Z`, url: "https://qilu-pharma.zhiye.com/api/Jobad/GetJobAdPageList", method: "POST", http_status: 200,
    request_json_text, response_json_text, request_text_sha256: hash(request_json_text), response_text_sha256: hash(response_json_text) };
}
function fixture(total = 16) { return { entries: Array.from({ length: Math.max(1, Math.ceil(total / 15)) }, (_, i) => entry(i, total)) }; }
function requestChanged(modify: (request: Record<string, unknown>) => void) {
  const business = fixture(); const value = JSON.parse(business.entries[0]!.request_json_text); modify(value);
  business.entries[0]!.request_json_text = JSON.stringify(value); business.entries[0]!.request_text_sha256 = hash(business.entries[0]!.request_json_text); return business;
}
function responseChanged(modify: (response: { Code: number; Count: number; Data: ReturnType<typeof row>[] }) => void) {
  const business = fixture(); const value = JSON.parse(business.entries[0]!.response_json_text); modify(value);
  business.entries[0]!.response_json_text = JSON.stringify(value); business.entries[0]!.response_text_sha256 = hash(business.entries[0]!.response_json_text); return business;
}

describe("Qilu manual evidence replay", () => {
  it("replays all pages and preserves different official IDs with identical titles", () => {
    const result = replayManualQiluCapture({ business: fixture(229), now });
    expect(result.rawCount).toBe(229); expect(result.uniqueOfficialIdCount).toBe(229); expect(result.pageCount).toBe(16);
    expect(result.pageRowCounts).toEqual([...Array(15).fill(15), 4]);
    expect(result.gaps).toContain("PER_PAGE_RENDERED_PROJECTION_MISSING");
    expect(result.gaps).toContain("MARKETING_PARTITION_NOT_CAPTURED");
    expect(result).not.toHaveProperty("officialCompanyTotal");
  });
  it("keeps old pinned records and native precision without adding a cutoff", () => {
    const result = replayManualQiluCapture({ business: fixture(), now });
    expect(result.rawCount).toBe(16); expect(result.dateDiagnostics.fractionalSecondRows).toBe(1);
    expect(result.dateDiagnostics.expirySentinelRows).toBe(16); expect(result.dateDiagnostics.explicitLongTermRows).toBe(1);
    expect(result.dateDiagnostics.appliedDateFilter).toBeNull();
  });
  it("allows safe reordered and additional display fields", () => {
    const business = requestChanged((request) => { request.DisplayFields = ["LocId", "Kind", "Org"]; });
    expect(replayManualQiluCapture({ business, now }).rawCount).toBe(16);
  });
  it.each([
    ["PageSize", 20], ["PageIndex", 1], ["Category", ["2"]], ["KeyWords", "clinical"],
    ["PortalId", "other"], ["DisplayFields", ["Org"]], ["DisplayFields", ["LocId", "LocId"]]
  ])("rejects invalid %s scope/pagination", (key, value) => {
    expect(() => replayManualQiluCapture({ business: requestChanged((request) => { request[key] = value; }), now })).toThrow("QILU_MANUAL_REQUEST_INVALID");
  });
  it("rejects a missing page", () => {
    const business = fixture(); business.entries.pop();
    expect(() => replayManualQiluCapture({ business, now })).toThrow("QILU_MANUAL_PAGINATION_INVALID");
  });
  it("rejects declared total drift", () => {
    expect(() => replayManualQiluCapture({ business: responseChanged((response) => { response.Count = 17; }), now })).toThrow("QILU_MANUAL_PAGINATION_INVALID");
  });
  it("rejects duplicate UUIDs rather than collapsing them", () => {
    expect(() => replayManualQiluCapture({ business: responseChanged((response) => { response.Data[1]!.Id = response.Data[0]!.Id; }), now })).toThrow("QILU_MANUAL_IDENTITY_INVALID");
  });
  it("rejects case-variant duplicate UUIDs", () => {
    const business = responseChanged((response) => { response.Data[0]!.Id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; response.Data[1]!.Id = response.Data[0]!.Id.toUpperCase(); });
    expect(() => replayManualQiluCapture({ business, now })).toThrow("QILU_MANUAL_IDENTITY_INVALID");
  });
  it("rejects an unsafe numeric ID alias", () => {
    expect(() => replayManualQiluCapture({ business: responseChanged((response) => { response.Data[0]!.JobAdId = Number.MAX_SAFE_INTEGER + 1; }), now })).toThrow("QILU_MANUAL_ROW_INVALID");
  });
  it("rejects inactive or wrong-category records", () => {
    expect(() => replayManualQiluCapture({ business: responseChanged((response) => { response.Data[0]!.Status = 0; }), now })).toThrow("QILU_MANUAL_ROW_INVALID");
  });
  it("separates mainland, nationwide, foreign and ambiguous geography", () => {
    const business = responseChanged((response) => {
      response.Data[0]!.LocNames = ["全国"]; response.Data[1]!.LocNames = ["香港特别行政区"];
      response.Data[2]!.LocNames = ["山东省·济南市", "美国"]; response.Data[3]!.LocNames = [];
    });
    expect(replayManualQiluCapture({ business, now }).geographyCounts).toEqual({ explicitMainland: 12, nationwideOnly: 1, auditedForeignOnly: 1, unresolvedOrMixed: 2 });
  });
  it("does not treat a reported terminal checkbox as replayed UI proof", () => {
    const business = { ...fixture(), terminal_ui_observation: { at: "2026-10-01T08:30:03Z", selected_page: 2, next_page_visibly_disabled: true, final_page_rows_visible: 1 } };
    const result = replayManualQiluCapture({ business, now });
    expect(result.terminalObservationStatus).toBe("REPORTED_ONLY_NOT_ARTIFACT_REPLAYED");
    expect(result.gaps).toContain("TERMINAL_UI_ARTIFACT_NOT_REPLAYED");
  });
  it.each(["山东省·济南市 / 美国", "山东省·济南市·美国", "北京市·日本", "山东省·济南市·加拿大", "北京市·东京市"])("does not classify unreviewed scalar %s as mainland", (location) => {
    const result = replayManualQiluCapture({ business: responseChanged((response) => { response.Data[0]!.LocNames = [location]; }), now });
    expect(result.geographyCounts.unresolvedOrMixed).toBe(1); expect(result.geographyCounts.explicitMainland).toBe(15);
  });
  it("does not call an empty API response a qualified zero-company result", () => {
    const result = replayManualQiluCapture({ business: fixture(0), now });
    expect(result.rawCount).toBe(0); expect(result.gaps).toContain("EXPLICIT_RENDERED_ZERO_NOT_VERIFIED");
  });
});
