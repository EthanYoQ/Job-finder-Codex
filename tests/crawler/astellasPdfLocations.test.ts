// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { parseAstellasLocationPages, extractAstellasPdfLocationEvidence, replayAstellasPdfLocationEvidence, fetchAstellasPdfLocation, ASTELLAS_PDF_LIMITS } from "../../src/crawler/astellasPdfLocations";
import { runWithOfficialSourceCancellation } from "../../src/crawler/officialHttpRuntimeLimits";
import type { SourceFetchArtifactDraft } from "../../src/crawler/sourceFetchEvidence";

const url = "https://www.astellas.com/content/dam/astellas-com/global/zh/example.pdf";
const at = "2026-10-01T16:56:08.000Z";
const hash = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");

// A real, deliberately minimal PDF. Production extraction still runs Poppler.
function syntheticPdf(lines: string[]) {
  const text = lines.map((line, index) => `${index ? "0 -20 Td " : ""}(${line.replace(/[\\()]/gu, "\\$&")}) Tj`).join("\n");
  const stream = `BT /F1 12 Tf 50 760 Td\n${text}\nET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
function artifact(lines = ["Location: Beijing"]) : SourceFetchArtifactDraft {
  const key = `astellas-pdf-${hash(Buffer.from(url))}`;
  return { id: key, logicalKey: key, kind: "ATS_PAGE", requestedUrl: url, finalUrl: url, httpStatus: 200, contentType: "application/pdf", capturedAt: at, body: syntheticPdf(lines), bodyRepresentation: "EXACT", extractorLocator: "ASTELLAS_PDF_LOCATION_V1" };
}
function response(body: Uint8Array, options: { status?: number; contentType?: string; finalUrl?: string } = {}) {
  const res = new Response(new Uint8Array(body), { status: options.status ?? 200, headers: { "content-type": options.contentType ?? "application/pdf" } });
  Object.defineProperty(res, "url", { value: options.finalUrl ?? url });
  return res;
}

describe("Astellas anchored Location fields", () => {
  it.each([
    ["Location: Beijing", ["北京"]], ["Location: Shanghai", ["上海"]], ["Location: Shenyang", ["沈阳"]],
    ["Location: Beijing/Shanghai", ["北京", "上海"]], ["Location：Beijing/ Shanghai", ["北京", "上海"]],
    ["  lOcAtIoN : Shanghai/ Beijing  ", ["上海", "北京"]]
  ])("extracts %s without losing slash-separated cities", (line, cities) => {
    const result = parseAstellasLocationPages([line as string]);
    expect(result).toMatchObject({ status: "CITY_SPECIFIC", cities, nationwide: false, fields: [{ page: 1, line: 1, rawLine: line }] });
  });
  it("does not infer cities from allocation, role remit, title, or body text", () => {
    expect(parseAstellasLocationPages(["Affiliate Controller, China\nManage allocation for Shanghai\nLocation: Beijing\nNationwide responsibilities"])).toMatchObject({ status: "CITY_SPECIFIC", cities: ["北京"], nationwide: false });
    expect(parseAstellasLocationPages(["allocation: Beijing\nThe Location: Shanghai\nChina"])).toMatchObject({ status: "UNRESOLVED", cities: [], reason: "LOCATION_MISSING" });
  });
  it.each(["", "Location:", "Location:\nBeijing", "Location: TBD", "Location: Beijing / Remote", "Location: Nationwide (China)", "Location: Beijing /", "Location: Beijing / Beijing", "Location: Beijing Shanghai"])("fails closed for %j", line => {
    expect(parseAstellasLocationPages([line])).toMatchObject({ status: line === "" ? "UNRESOLVED" : "UNREVIEWED_LOCATION", cities: [], nationwide: false });
  });
  it.each(["Tokyo", "Beijing/Tokyo", "Tokyo /", "London", "Singapore"])("flags unreviewed explicit %s without mapping a China city", value => {
    expect(parseAstellasLocationPages([`Location: ${value}`])).toMatchObject({status:"UNREVIEWED_LOCATION",cities:[],nationwide:false,reason:"LOCATION_VALUE_UNREVIEWED"});
  });
  it.each(["China", "中国"])("keeps %s country-only", value => {
    expect(parseAstellasLocationPages([`Location: ${value}`])).toMatchObject({ status: "COUNTRY_ONLY", cities: [], nationwide: false });
  });
  it.each([["Location: Beijing\nLocation: Shanghai"], ["Location: Beijing", "Location: Shanghai"], ["Location: Beijing\nLocation: Beijing"]])("rejects duplicate/conflicting fields anywhere in the document", (...pages) => {
    expect(parseAstellasLocationPages(pages)).toMatchObject({ status: "UNREVIEWED_LOCATION", cities: [], reason: "MULTIPLE_LOCATION_FIELDS" });
  });
  it("does not accept a body-page Location field or wrapped first-page value", () => {
    expect(parseAstellasLocationPages(["Title", "Location: Beijing"])).toMatchObject({ status: "UNREVIEWED_LOCATION", cities: [], reason: "LOCATION_NOT_ON_FIRST_PAGE" });
  });
});

describe("Astellas exact PDF-byte evidence and replay", () => {
  it("reparses a genuine PDF, retaining exact byte hash and field provenance", async () => {
    const raw = artifact(["Role: China", "Location: Beijing / Shanghai", "Nationwide responsibilities"]);
    const proof = await extractAstellasPdfLocationEvidence(raw);
    expect(proof).toMatchObject({ pdfSha256: hash(raw.body as Uint8Array), pdfByteCount: raw.body.length, requestedUrl: url, finalUrl: url, capturedAt: at, pageCount: 1, result: { status: "CITY_SPECIFIC", cities: ["北京", "上海"], nationwide: false } });
    expect(proof.parserVersion).toMatch(/^poppler-\d+\.\d+\.\d+$/u);
    expect(proof.result.fields[0]).toMatchObject({ page: 1, rawLine: "Location: Beijing / Shanghai" });
    expect(await replayAstellasPdfLocationEvidence(raw, proof)).toBe(true);
  });
  it("rejects changed PDF bytes even if all claimed locations stay unchanged", async () => {
    const raw = artifact(); const proof = await extractAstellasPdfLocationEvidence(raw);
    const changed = { ...raw, body: Buffer.concat([raw.body as Uint8Array, Buffer.from("\n%changed")]) };
    expect(await replayAstellasPdfLocationEvidence(changed, proof)).toBe(false);
  });
  it("rejects tampered cities, field text, hash, parser version, URL, time, and added claim fields", async () => {
    const raw = artifact(); const proof = await extractAstellasPdfLocationEvidence(raw);
    for (const changed of [
      { ...proof, result: { ...proof.result, cities: ["上海"] } },
      { ...proof, result: { ...proof.result, fields: [] } }, { ...proof, pdfSha256: "0".repeat(64) },
      { ...proof, parserVersion: "poppler-0.0.0" }, { ...proof, requestedUrl: `${url}?changed=1` },
      { ...proof, capturedAt: "2026-10-02T00:00:00.000Z" }, { ...proof, approved: true }
    ]) expect(await replayAstellasPdfLocationEvidence(raw, changed)).toBe(false);
  });
  it("retains an unresolved PDF without fabricating cities", async () => {
    const raw = artifact(["Location: TBD", "Nationwide responsibilities in Shanghai"]);
    const proof = await extractAstellasPdfLocationEvidence(raw);
    expect(proof.result).toMatchObject({ status: "UNREVIEWED_LOCATION", cities: [], nationwide: false });
    expect(await replayAstellasPdfLocationEvidence(raw, proof)).toBe(true);
  });
  it.each([
    { body: "Location: Beijing" }, { body: Buffer.from("not a PDF") }, { bodyRepresentation: "REDACTED" },
    { finalUrl: "https://example.org/a.pdf" }, { httpStatus: 302 }, { contentType: "text/html" },
    { logicalKey: "other" }, { extractorLocator: "caller-guessed" }
  ])("rejects invalid retained artifact %j", async change => {
    await expect(extractAstellasPdfLocationEvidence({ ...artifact(), ...change } as SourceFetchArtifactDraft)).rejects.toThrow();
  });
});

describe("Astellas source-specific bounded PDF acquisition", () => {
  it("fetches once without redirects, credentials or cookies and replays its exact artifact", async () => {
    const http = vi.fn(async () => response(syntheticPdf(["Location: Shenyang"])));
    const result = await fetchAstellasPdfLocation(url, { fetchImpl: http, now: () => new Date(at) });
    expect(result.ok).toBe(true);
    expect(http).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "error", credentials: "omit", headers: { Accept: "application/pdf" } }));
    if (!result.ok) throw new Error(result.code);
    expect(result.evidence.result.cities).toEqual(["沈阳"]);
    expect(await replayAstellasPdfLocationEvidence(result.artifact, result.evidence)).toBe(true);
  });
  it.each(["http://www.astellas.com/content/dam/astellas-com/global/zh/job.pdf", "https://evil.example/job.pdf", "https://www.astellas.com.evil.example/content/dam/astellas-com/global/zh/job.pdf", `${url}?x=1`, `${url}#fragment`, url.replace("/global/zh/", "/global/en/"), url.replace("example.pdf", "%2e%2e/example.pdf"), url.replace("www.astellas.com", "user:pass@www.astellas.com")])("rejects unsafe/unreviewed URL %s before transport", async unsafe => {
    const http = vi.fn();
    expect(await fetchAstellasPdfLocation(unsafe, { fetchImpl: http })).toMatchObject({ ok: false, code: "PDF_URL_INVALID" });
    expect(http).not.toHaveBeenCalled();
  });
  it.each([{ status: 404 }, { contentType: "text/html" }, { finalUrl: "https://www.astellas.com/content/dam/astellas-com/global/zh/other.pdf" }])("rejects invalid response metadata %j", async options => {
    expect(await fetchAstellasPdfLocation(url, { fetchImpl: async () => response(syntheticPdf(["Location: Beijing"]), options) })).toMatchObject({ ok: false, code: "PDF_RESPONSE_INVALID" });
  });
  it("bounds received bytes without trusting Content-Length", async () => {
    const body = Buffer.alloc(ASTELLAS_PDF_LIMITS.maxBytes + 1);
    expect(await fetchAstellasPdfLocation(url, { fetchImpl: async () => response(body) })).toMatchObject({ ok: false, code: "PDF_BODY_TOO_LARGE" });
  });
  it("honors source cancellation while waiting for a streamed body", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const res = new Response(stream, { headers: { "content-type": "application/pdf" } });
    Object.defineProperty(res, "url", { value: url });
    const pending = runWithOfficialSourceCancellation(controller.signal, () => fetchAstellasPdfLocation(url, { fetchImpl: async () => res }));
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, code: "PDF_TRANSPORT_FAILED" });
    expect(cancelled).toBe(true);
  });
  it("cancels a response that advertises an oversized body before consuming it", async () => {
    let cancelled = false;
    const res = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }), { headers: { "content-type": "application/pdf", "content-length": String(ASTELLAS_PDF_LIMITS.maxBytes + 1) } });
    Object.defineProperty(res, "url", { value: url });
    expect(await fetchAstellasPdfLocation(url, { fetchImpl: async () => res })).toMatchObject({ ok: false, code: "PDF_BODY_TOO_LARGE" });
    expect(cancelled).toBe(true);
  });
  it("rejects a PDF with a declared page count above the reviewed limit", async () => {
    const raw = artifact();
    raw.body = Buffer.from((raw.body as Buffer).toString().replace("/Count 1", `/Count ${ASTELLAS_PDF_LIMITS.maxPages + 1}`));
    await expect(extractAstellasPdfLocationEvidence(raw)).rejects.toThrow();
  });
  it("returns a retained artifact but no city on parser failure", async () => {
    const result = await fetchAstellasPdfLocation(url, { fetchImpl: async () => response(Buffer.from("%PDF-1.4\nnot parseable")), now: () => new Date(at) });
    expect(result).toMatchObject({ ok: false, code: "PDF_PARSER_FAILED", artifact: { requestedUrl: url } });
    expect(result).not.toHaveProperty("evidence");
  });
});
