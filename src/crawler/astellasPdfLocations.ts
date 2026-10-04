/** Source-specific helper. It does not certify list completeness,
 * register a source policy, mutate jobs, or grant owned-acquisition provenance. */
import { execFile } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { currentOfficialSourceAttemptSignal } from "./officialHttpRuntimeLimits";
import { parseArtifactArchiveDrafts, sha256Bytes, type SourceFetchArtifactDraft } from "./sourceFetchEvidence";

const EXTRACTOR = "ASTELLAS_PDF_LOCATION_V1";
const SOURCE_ID = "source-astellas-china-social";
export const ASTELLAS_PDF_LIMITS = Object.freeze({ maxBytes: 5 * 1024 * 1024, maxPages: 32, maxTextBytes: 2 * 1024 * 1024, httpTimeoutMs: 30_000, parserTimeoutMs: 10_000, parserAddressSpaceBytes: 256 * 1024 * 1024 });
const PDFINFO = "/usr/bin/pdfinfo";
const PDFTOTEXT = "/usr/bin/pdftotext";
const CITIES: Readonly<Record<string, string>> = Object.freeze({ beijing: "北京", shanghai: "上海", shenyang: "沈阳" });

export interface AstellasLocationField { page: number; line: number; rawLine: string; rawValue: string }
export interface AstellasLocationResult {
  status: "CITY_SPECIFIC" | "COUNTRY_ONLY" | "UNRESOLVED" | "UNREVIEWED_LOCATION";
  cities: string[];
  nationwide: false;
  fields: AstellasLocationField[];
  reason?: "LOCATION_MISSING" | "MULTIPLE_LOCATION_FIELDS" | "LOCATION_NOT_ON_FIRST_PAGE" | "LOCATION_VALUE_UNREVIEWED";
}
export interface AstellasPdfLocationEvidence {
  schemaVersion: "astellas-pdf-location-v1";
  sourceId: typeof SOURCE_ID;
  extractorVersion: typeof EXTRACTOR;
  requestedUrl: string;
  finalUrl: string;
  capturedAt: string;
  pdfSha256: string;
  pdfByteCount: number;
  parserVersion: string;
  textSha256: string;
  pageCount: number;
  result: AstellasLocationResult;
}
type FailureCode = "PDF_URL_INVALID" | "PDF_RESPONSE_INVALID" | "PDF_BODY_TOO_LARGE" | "PDF_MAGIC_INVALID" | "PDF_TRANSPORT_FAILED" | "PDF_PARSER_FAILED";
export type AstellasPdfLocationCapture =
  | { ok: true; artifact: SourceFetchArtifactDraft; evidence: AstellasPdfLocationEvidence }
  | { ok: false; code: FailureCode; artifact?: SourceFetchArtifactDraft };

/** Only the audited single-line field grammar; no OCR, wrapping, body search,
 * substring city matching, inferred nationwide scope or unreviewed aliases. */
export function parseAstellasLocationPages(pages: readonly string[]): AstellasLocationResult {
  const fields: AstellasLocationField[] = [];
  pages.forEach((page, pageIndex) => page.split(/\r?\n/u).forEach((rawLine, lineIndex) => {
    const match = /^[ \t]*Location[ \t]*[:：]([^\r\n]*)$/iu.exec(rawLine);
    if (match) fields.push({ page: pageIndex + 1, line: lineIndex + 1, rawLine, rawValue: match[1]! });
  }));
  const unresolved = (reason: NonNullable<AstellasLocationResult["reason"]>): AstellasLocationResult => ({ status: fields.length === 0 ? "UNRESOLVED" : "UNREVIEWED_LOCATION", cities: [], nationwide: false, fields, reason });
  if (fields.length === 0) return unresolved("LOCATION_MISSING");
  if (fields.length !== 1) return unresolved("MULTIPLE_LOCATION_FIELDS");
  if (fields[0]!.page !== 1) return unresolved("LOCATION_NOT_ON_FIRST_PAGE");
  const value = fields[0]!.rawValue.replace(/^[ \t]+|[ \t]+$/gu, "");
  if (/^(?:China|中国)$/iu.test(value)) return { status: "COUNTRY_ONLY", cities: [], nationwide: false, fields };
  const tokens = value.split("/").map(token => token.replace(/^[ \t]+|[ \t]+$/gu, "").toLowerCase());
  if (tokens.length > 2 || new Set(tokens).size !== tokens.length || tokens.some(token => !Object.hasOwn(CITIES, token))) return unresolved("LOCATION_VALUE_UNREVIEWED");
  return { status: "CITY_SPECIFIC", cities: tokens.map(token => CITIES[token]!), nationwide: false, fields };
}

export type AstellasPdfRuntimeCapability = {available:true;parserVersion:string}|{available:false;code:"PDF_RUNTIME_UNAVAILABLE"};
/** Probe the fixed, resource-limited executables before any PDF request. */
export async function inspectAstellasPdfRuntime():Promise<AstellasPdfRuntimeCapability> {
  try {
  const infoVersion = await runPoppler(PDFINFO, ["-v"]);
  const textVersion = await runPoppler(PDFTOTEXT, ["-v"]);
  const version = /(?:^|\n)pdfinfo version (\d+\.\d+\.\d+)(?:\r?\n|$)/u.exec(infoVersion.stderr)?.[1];
  const second = /(?:^|\n)pdftotext version (\d+\.\d+\.\d+)(?:\r?\n|$)/u.exec(textVersion.stderr)?.[1];
  if (!version || version !== second) throw new Error("PDF_PARSER_VERSION_INVALID");
    return {available:true,parserVersion:`poppler-${version}`};
  } catch { return {available:false,code:"PDF_RUNTIME_UNAVAILABLE"}; }
}

/** Requires official OS-provided Poppler at fixed paths. Each process has a
 * deadline/output bound; stdin bytes are never interpreted as a filename/shell.
 * The parser identity is recorded, and replay requires the same version. */
export async function extractAstellasPdfLocationEvidence(artifact: SourceFetchArtifactDraft): Promise<AstellasPdfLocationEvidence> {
  const retained = validateArtifact(artifact);
  const bytes = sha256Bytes(retained.body);
  const capability = await inspectAstellasPdfRuntime();
  if (!capability.available) throw new Error("PDF_RUNTIME_UNAVAILABLE");
  const info = await runPoppler(PDFINFO, ["-"], retained.body);
  const pageCount = Number(/^Pages:[ \t]+(\d+)[ \t]*$/mu.exec(info.stdout)?.[1]);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > ASTELLAS_PDF_LIMITS.maxPages || !/^Encrypted:[ \t]+no[ \t]*$/mu.test(info.stdout)) throw new Error("PDF_PARSER_METADATA_INVALID");
  const extracted = await runPoppler(PDFTOTEXT, ["-layout", "-enc", "UTF-8", "-eol", "unix", "-", "-"], retained.body);
  if (extracted.stderr.trim() || extracted.stdout.includes("\ufffd")) throw new Error("PDF_PARSER_TEXT_INVALID");
  const pages = extracted.stdout.split("\f");
  if (pages.at(-1)?.trim() === "") pages.pop();
  if (pages.length !== pageCount) throw new Error("PDF_PARSER_PAGE_COUNT_MISMATCH");
  return { schemaVersion: "astellas-pdf-location-v1", sourceId: SOURCE_ID, extractorVersion: EXTRACTOR,
    requestedUrl: retained.requestedUrl, finalUrl: retained.finalUrl, capturedAt: retained.capturedAt,
    pdfSha256: bytes.sha256, pdfByteCount: bytes.byteCount, parserVersion: capability.parserVersion,
    textSha256: sha256Bytes(Buffer.from(extracted.stdout, "utf8")).sha256, pageCount,
    result: parseAstellasLocationPages(pages) };
}

/** Exact byte replay, not trust in a supplied extracted-text artifact or city.
 * A true return validates the claim, which may still be UNRESOLVED/COUNTRY_ONLY. */
export async function replayAstellasPdfLocationEvidence(artifact: SourceFetchArtifactDraft, claim: unknown): Promise<boolean> {
  try { return isDeepStrictEqual(await extractAstellasPdfLocationEvidence(artifact), claim); }
  catch { return false; }
}

/** Tests may inject transport. A future owned-acquisition route must construct
 * this without overrides, retain the exact artifact and bind it to its list URL.
 * Failure never deletes the list job or provides a country/nationwide fallback. */
export async function fetchAstellasPdfLocation(url: string, deps: { fetchImpl?: typeof fetch; now?: () => Date } = {}): Promise<AstellasPdfLocationCapture> {
  if (!isAstellasPdfUrl(url)) return { ok: false, code: "PDF_URL_INVALID" };
  let artifact: SourceFetchArtifactDraft | undefined;
  try {
    const deadline = AbortSignal.timeout(ASTELLAS_PDF_LIMITS.httpTimeoutMs);
    const sourceSignal = currentOfficialSourceAttemptSignal();
    const signal = sourceSignal ? AbortSignal.any([sourceSignal, deadline]) : deadline;
    signal.throwIfAborted();
    const res = await (deps.fetchImpl ?? fetch)(url, { method: "GET", redirect: "error", credentials: "omit", headers: { Accept: "application/pdf" }, signal });
    if (res.status !== 200 || res.url !== url || !isPdfContentType(res.headers.get("content-type")) || !res.body) {
      await res.body?.cancel();
      return { ok: false, code: "PDF_RESPONSE_INVALID" };
    }
    const length = res.headers.get("content-length");
    if (length !== null && (!/^\d+$/u.test(length) || Number(length) > ASTELLAS_PDF_LIMITS.maxBytes)) {
      await res.body.cancel(); return { ok: false, code: "PDF_BODY_TOO_LARGE" };
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const aborted = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", aborted, { once: true });
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > ASTELLAS_PDF_LIMITS.maxBytes) { await reader.cancel(); return { ok: false, code: "PDF_BODY_TOO_LARGE" }; }
        chunks.push(value);
      }
    } finally { signal.removeEventListener("abort", aborted); reader.releaseLock(); }
    const body = Buffer.concat(chunks, size);
    if (!hasPdfMagic(body)) return { ok: false, code: "PDF_MAGIC_INVALID" };
    const key = artifactKey(url);
    artifact = { id: key, logicalKey: key, kind: "ATS_PAGE", requestedUrl: url, finalUrl: res.url,
      httpStatus: 200, contentType: res.headers.get("content-type")!, capturedAt: (deps.now ?? (() => new Date()))().toISOString(),
      body, bodyRepresentation: "EXACT", extractorLocator: EXTRACTOR };
    const evidence = await extractAstellasPdfLocationEvidence(artifact);
    return { ok: true, artifact, evidence };
  } catch { return artifact ? { ok: false, code: "PDF_PARSER_FAILED", artifact } : { ok: false, code: "PDF_TRANSPORT_FAILED" }; }
}

export function assertAstellasPdfArtifact(artifact: SourceFetchArtifactDraft): void { validateArtifact(artifact); }

function isAstellasPdfUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.href === input && url.origin === "https://www.astellas.com" && !url.username && !url.password && !url.search && !url.hash &&
      /^\/content\/dam\/astellas-com\/global\/zh\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.pdf$/u.test(url.pathname);
  } catch { return false; }
}
function isPdfContentType(value: string | null | undefined): boolean { return typeof value === "string" && /^application\/pdf(?:\s*;[^\r\n]*)?$/iu.test(value); }
function hasPdfMagic(bytes: Uint8Array): boolean { return bytes.byteLength >= 8 && /^%PDF-1\.[0-7][\r\n]/u.test(Buffer.from(bytes.subarray(0, 9)).toString("ascii")); }
function artifactKey(url: string): string { return `astellas-pdf-${sha256Bytes(Buffer.from(url, "utf8")).sha256}`; }
function validateArtifact(artifact: SourceFetchArtifactDraft): SourceFetchArtifactDraft & { body: Uint8Array; requestedUrl: string; finalUrl: string } {
  parseArtifactArchiveDrafts({ captureTool: { name: EXTRACTOR, version: "1" }, artifacts: [artifact] });
  if (!artifact.requestedUrl || !isAstellasPdfUrl(artifact.requestedUrl) || artifact.finalUrl !== artifact.requestedUrl ||
    artifact.id !== artifactKey(artifact.requestedUrl) || artifact.logicalKey !== artifact.id || artifact.kind !== "ATS_PAGE" ||
    artifact.channelId !== undefined || artifact.httpStatus !== 200 || !isPdfContentType(artifact.contentType) ||
    artifact.bodyRepresentation !== "EXACT" || artifact.extractorLocator !== EXTRACTOR || !(artifact.body instanceof Uint8Array) ||
    artifact.body.byteLength > ASTELLAS_PDF_LIMITS.maxBytes || !hasPdfMagic(artifact.body)) throw new Error("PDF_ARTIFACT_INVALID");
  // Copy before asynchronous parsing so a caller cannot mutate bytes mid-replay.
  return { ...artifact, body: Uint8Array.from(artifact.body), requestedUrl: artifact.requestedUrl, finalUrl: artifact.finalUrl };
}
function runPoppler(executable: typeof PDFINFO | typeof PDFTOTEXT, args: string[], input?: Uint8Array): Promise<{ stdout: string; stderr: string }> {
  const deadline = AbortSignal.timeout(ASTELLAS_PDF_LIMITS.parserTimeoutMs);
  const sourceSignal = currentOfficialSourceAttemptSignal();
  const signal = sourceSignal ? AbortSignal.any([sourceSignal, deadline]) : deadline;
  return new Promise((resolve, reject) => {
    const child = execFile("/usr/bin/prlimit", [`--as=${ASTELLAS_PDF_LIMITS.parserAddressSpaceBytes}`, "--cpu=10", "--", executable, ...args], { encoding: "utf8", maxBuffer: ASTELLAS_PDF_LIMITS.maxTextBytes,
      timeout: ASTELLAS_PDF_LIMITS.parserTimeoutMs, killSignal: "SIGKILL", signal, env: { ...process.env, LC_ALL: "C" } },
    (error, stdout, stderr) => error ? reject(new Error("PDF_PARSER_FAILED")) : resolve({ stdout, stderr }));
    child.stdin?.on("error", () => { /* The callback owns failures, including EPIPE. */ });
    child.stdin?.end(input);
  });
}
