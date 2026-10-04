// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseManualChromeCapture, replayManualChromeCapture } from "../../src/crawler/manualChromeCaptureEvidence";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const now = new Date("2026-10-01T09:00:00.000Z");
const fixture = () => ({
  schemaVersion: "chrome-cua-business-capture-v1",
  retrievalPath: "CHROME_CUA_NATIVE_UI_EXPORT_V1",
  sourceId: "source-cspc-social",
  bindingMode: "RETROSPECTIVE_DIAGNOSTIC",
  acquisitionProvenance: "UNAUTHENTICATED_RETAINED_ARTIFACTS",
  artifacts: [{ purpose: "BUSINESS", path: "capture.json", sha256: hash("{}"), bytes: 2 }]
});

describe("manual Chrome capture artifact boundary", () => {
  it("parses only the diagnostic identity and does not manufacture binding", () => {
    const parsed = parseManualChromeCapture(fixture());
    expect(parsed.bindingMode).toBe("RETROSPECTIVE_DIAGNOSTIC");
    expect(parsed).not.toHaveProperty("sourceConfigSha256");
  });
  it.each([
    ["schemaVersion", "official-json-browser-network-traversal-v1"],
    ["retrievalPath", "PLAYWRIGHT_OFFICIAL_UI_NETWORK_TRAVERSAL"],
    ["sourceId", "source-other"],
    ["bindingMode", "PREBOUND_CAPTURE"]
  ])("rejects unsupported %s rather than reinterpreting acquisition", (key, value) => {
    expect(() => parseManualChromeCapture({ ...fixture(), [key]: value })).toThrow("MANUAL_CAPTURE_SCHEMA_INVALID");
  });
  it("rejects caller-supplied certificate and eligibility fields", () => {
    expect(() => parseManualChromeCapture({ ...fixture(), qualificationEligible: true })).toThrow("MANUAL_CAPTURE_SCHEMA_INVALID");
  });
  it("rejects duplicate artifact purposes", () => {
    const input = fixture(); input.artifacts.push(input.artifacts[0]!);
    expect(() => parseManualChromeCapture(input)).toThrow("MANUAL_CAPTURE_ARTIFACT_SET_INVALID");
  });
  it("rejects path traversal before reading bytes", async () => {
    const input = fixture(); input.artifacts[0]!.path = "../capture.json";
    await expect(replayManualChromeCapture({ capture: input, evidenceRoot: tmpdir(), now })).rejects.toThrow("MANUAL_CAPTURE_ARTIFACT_PATH_INVALID");
  });
  it("rejects a symlink escaping the evidence root", async () => {
    const outer = await mkdtemp(join(tmpdir(), "manual-capture-")); roots.push(outer);
    const inner = await mkdtemp(join(outer, "inner-"));
    await writeFile(join(outer, "outside.json"), "{}"); await symlink(join(outer, "outside.json"), join(inner, "capture.json"));
    await expect(replayManualChromeCapture({ capture: fixture(), evidenceRoot: inner, now })).rejects.toThrow("MANUAL_CAPTURE_ARTIFACT_PATH_INVALID");
  });
  it("rejects modified bytes without revealing their contents", async () => {
    const root = await mkdtemp(join(tmpdir(), "manual-capture-")); roots.push(root);
    await writeFile(join(root, "capture.json"), "private-value");
    await expect(replayManualChromeCapture({ capture: fixture(), evidenceRoot: root, now })).rejects.toThrow(/^MANUAL_CAPTURE_ARTIFACT_BYTES_INVALID$/);
  });
  it("rejects duplicate JSON keys rather than trusting parsed last values", async () => {
    const root = await mkdtemp(join(tmpdir(), "manual-capture-")); roots.push(root);
    const text = '{"sourceId":"a","sourceId":"b"}'; await writeFile(join(root, "capture.json"), text);
    const input = fixture(); input.artifacts[0] = { purpose: "BUSINESS", path: "capture.json", sha256: hash(text), bytes: Buffer.byteLength(text) };
    await expect(replayManualChromeCapture({ capture: input, evidenceRoot: root, now })).rejects.toThrow("MANUAL_CAPTURE_JSON_INVALID");
  });
  it("rejects an invalid evaluation clock", async () => {
    await expect(replayManualChromeCapture({ capture: fixture(), evidenceRoot: tmpdir(), now: new Date("invalid") })).rejects.toThrow("MANUAL_CAPTURE_CLOCK_INVALID");
  });
  async function validEvidence(includeHar = false, modifyHar?: (har: any) => void) {
    const root = await mkdtemp(join(tmpdir(), "manual-capture-")); roots.push(root);
    const id = "00000000-0000-4000-8000-000000000001";
    const request = new URLSearchParams({ channelQrId: "0beb3022-3214-4333-a2e7-20786c4916d5", sortName: "zri.ext_rankNum", peopleId: "", root_id: "cspc", shareStaff: "", push_request_id: id, keyword: "", ftl_list_stru_id: "" }).toString();
    const response = JSON.stringify({ state: "1", total: "", jsonList: [{ REQUEST_ID: id, PUBLISH_NAME: "Synthetic role", work_place: "北京市", UPDATE_TIME: "2026-10-01 08:00:00" }] });
    const business = { url: "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob", method: "POST", http_status: 200, started_at: "2026-10-01T08:18:38.636Z", request_form_text: request, response_json_text: response, request_text_sha256: hash(request), response_text_sha256: hash(response) };
    const text = JSON.stringify(business); await writeFile(join(root, "capture.json"), text);
    const capture = fixture(); capture.artifacts[0] = { purpose: "BUSINESS", path: "capture.json", sha256: hash(text), bytes: Buffer.byteLength(text) };
    if (includeHar) {
      const har = { log: { entries: [{ startedDateTime: business.started_at, request: { url: business.url, method: "POST", postData: { text: request }, headers: [{ name: "Authorization", value: "private-canary" }] }, response: { status: 200, content: { text: response }, cookies: [{ name: "private-session", value: "private-cookie" }] } }] } };
      modifyHar?.(har); const bytes = JSON.stringify(har); await writeFile(join(root, "raw.har"), bytes);
      capture.artifacts.push({ purpose: "RAW_HAR", path: "raw.har", sha256: hash(bytes), bytes: Buffer.byteLength(bytes) });
    }
    return { capture, evidenceRoot: root, now };
  }
  it("runs source replay while keeping retrospective evidence permanently diagnostic", async () => {
    const result = await replayManualChromeCapture(await validEvidence());
    expect(result.decision).toBe("DIAGNOSTIC_ONLY"); expect(result.qualificationEligible).toBe(false);
    expect(result.sourceReplay.rawCount).toBe(1);
    expect(result.sourceReplay.observedRequestStartedAt).toBe("2026-10-01T08:18:38.636Z");
    expect(result.gaps).toContain("RAW_HAR_NOT_AVAILABLE"); expect(result.gaps).not.toContain("SOURCE_REPLAY_NOT_IMPLEMENTED");
  });
  it("matches retained HAR business text without leaking cookies or credentials", async () => {
    const result = await replayManualChromeCapture(await validEvidence(true));
    expect(result.rawHarBinding).toEqual({ status: "VERIFIED_STORED_BUSINESS_MATCHES", matchedEntries: 1, unselectedScopedEntries: 0 });
    expect(JSON.stringify(result)).not.toMatch(/private-canary|private-session|private-cookie|Authorization|headers|cookies/u);
    expect(result.gaps).toContain("ACQUISITION_PROVENANCE_UNAUTHENTICATED");
  });
  it("rejects a body mismatch even if both file hashes were recomputed", async () => {
    const input = await validEvidence(true, (har) => { har.log.entries[0].response.content.text += " "; });
    await expect(replayManualChromeCapture(input)).rejects.toThrow("MANUAL_CAPTURE_HAR_BINDING_INVALID");
  });
  it("rejects ambiguous duplicate HAR entries", async () => {
    const input = await validEvidence(true, (har) => { har.log.entries.push(har.log.entries[0]); });
    await expect(replayManualChromeCapture(input)).rejects.toThrow("MANUAL_CAPTURE_HAR_BINDING_INVALID");
  });
  it("does not silently drop an incomplete scoped HAR response", async () => {
    const input = await validEvidence(true, (har) => { har.log.entries.push({ startedDateTime: "2026-10-01T08:20:00Z", request: har.log.entries[0].request, response: { status: 0 } }); });
    await expect(replayManualChromeCapture(input)).rejects.toThrow("MANUAL_CAPTURE_SCOPED_HAR_ENTRY_INVALID");
  });
  it("decodes explicit HAR base64 before comparing retained business text", async () => {
    const input = await validEvidence(true, (har) => { const content = har.log.entries[0].response.content; content.text = Buffer.from(content.text).toString("base64"); content.encoding = "base64"; });
    expect((await replayManualChromeCapture(input)).rawHarBinding.matchedEntries).toBe(1);
  });
});
