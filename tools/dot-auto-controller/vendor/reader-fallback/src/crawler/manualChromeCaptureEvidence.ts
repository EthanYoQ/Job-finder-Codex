import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import type { ManualCspcReplay } from "./manualChromeCspcReplay";
import type { ManualQiluReplay } from "./manualChromeQiluReplay";

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const artifactSchema = z.object({
  purpose: z.enum(["BUSINESS", "RAW_HAR", "RAW_HAR_CONTINUATION", "CSPC_ROOT_HTML", "CSPC_FRAME_HTML"]),
  path: z.string().min(1).max(512),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES)
}).strict();
const captureSchema = z.object({
  schemaVersion: z.literal("chrome-cua-business-capture-v1"),
  retrievalPath: z.literal("CHROME_CUA_NATIVE_UI_EXPORT_V1"),
  sourceId: z.enum(["source-cspc-social", "source-qilu-social"]),
  bindingMode: z.literal("RETROSPECTIVE_DIAGNOSTIC"),
  acquisitionProvenance: z.literal("UNAUTHENTICATED_RETAINED_ARTIFACTS"),
  renderedExportedAtApprox: z.string().datetime({ offset: true }).optional(),
  artifacts: z.array(artifactSchema).min(1).max(5)
}).strict();

export type ManualChromeCapture = z.infer<typeof captureSchema>;
export interface ManualCaptureDiagnostic {
  schemaVersion: "manual-chrome-capture-diagnostic-v1";
  decision: "DIAGNOSTIC_ONLY";
  qualificationEligible: false;
  sourceId: ManualChromeCapture["sourceId"];
  evaluatedAt: string;
  gaps: string[];
  artifactIntegrity: Array<{ purpose: string; sha256: string; bytes: number }>;
  sourceReplay: ManualCspcReplay | ManualQiluReplay;
  rawHarBinding: { status: "VERIFIED_STORED_BUSINESS_MATCHES" | "MISSING"; matchedEntries: number; unselectedScopedEntries: number };
}

export function manualCaptureError(code: string): never { throw new Error(code); }
export function manualCaptureSha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
export function parseManualCaptureJson(text: string): unknown {
  if (Buffer.byteLength(text) > MAX_ARTIFACT_BYTES || !hasUniqueJsonObjectKeys(text)) {
    manualCaptureError("MANUAL_CAPTURE_JSON_INVALID");
  }
  try { return JSON.parse(text) as unknown; }
  catch { return manualCaptureError("MANUAL_CAPTURE_JSON_INVALID"); }
}

export function parseManualChromeCapture(value: unknown): ManualChromeCapture {
  const parsed = captureSchema.safeParse(value);
  if (!parsed.success) manualCaptureError("MANUAL_CAPTURE_SCHEMA_INVALID");
  const artifacts = parsed.data.artifacts;
  if (artifacts.filter(({ purpose }) => purpose === "BUSINESS").length !== 1 ||
      new Set(artifacts.map(({ purpose }) => purpose)).size !== artifacts.length ||
      new Set(artifacts.map(({ path }) => path)).size !== artifacts.length ||
      artifacts.reduce((sum, { bytes }) => sum + bytes, 0) > 64 * 1024 * 1024) {
    manualCaptureError("MANUAL_CAPTURE_ARTIFACT_SET_INVALID");
  }
  return parsed.data;
}

async function readBoundArtifact(root: string, artifact: ManualChromeCapture["artifacts"][number]): Promise<Buffer> {
  if (isAbsolute(artifact.path) || artifact.path.includes("\0") || artifact.path.includes("\\") ||
      artifact.path.split("/").some((part) => part === ".." || part === "." || part === "")) {
    manualCaptureError("MANUAL_CAPTURE_ARTIFACT_PATH_INVALID");
  }
  let canonicalRoot: string;
  let canonicalFile: string;
  try { canonicalRoot = await realpath(root); canonicalFile = await realpath(resolve(canonicalRoot, artifact.path)); }
  catch { return manualCaptureError("MANUAL_CAPTURE_ARTIFACT_UNAVAILABLE"); }
  const child = relative(canonicalRoot, canonicalFile);
  if (!child || child === ".." || child.startsWith("../") || isAbsolute(child)) {
    manualCaptureError("MANUAL_CAPTURE_ARTIFACT_PATH_INVALID");
  }
  const handle = await open(canonicalFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    .catch(() => manualCaptureError("MANUAL_CAPTURE_ARTIFACT_UNAVAILABLE"));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== artifact.bytes || stat.size > MAX_ARTIFACT_BYTES) {
      manualCaptureError("MANUAL_CAPTURE_ARTIFACT_BYTES_INVALID");
    }
    const bytes = await handle.readFile();
    if (bytes.length !== artifact.bytes || manualCaptureSha256(bytes) !== artifact.sha256) {
      manualCaptureError("MANUAL_CAPTURE_ARTIFACT_BYTES_INVALID");
    }
    return bytes;
  } finally { await handle.close(); }
}

const businessRequestSchema = z.object({
  started_at: z.string(), url: z.string(), method: z.string(), http_status: z.number(),
  request_form_text: z.string().optional(), request_json_text: z.string().optional(), response_json_text: z.string()
});
const harEntrySchema = z.object({
  startedDateTime: z.string(),
  request: z.object({ url: z.string(), method: z.string(), postData: z.object({ text: z.string() }).optional() }),
  response: z.object({ status: z.number(), content: z.object({ text: z.string().optional(), encoding: z.string().optional() }) })
});

function verifyHarBinding(business: unknown, loaded: Map<string, Buffer>): ManualCaptureDiagnostic["rawHarBinding"] {
  const harBytes = [loaded.get("RAW_HAR"), loaded.get("RAW_HAR_CONTINUATION")].filter((bytes): bytes is Buffer => bytes !== undefined);
  if (harBytes.length === 0) return { status: "MISSING", matchedEntries: 0, unselectedScopedEntries: 0 };
  const requests = z.object({ entries: z.array(businessRequestSchema) }).safeParse(business);
  const targets = requests.success ? requests.data.entries : (() => {
    const one = businessRequestSchema.safeParse(business);
    if (!one.success) manualCaptureError("MANUAL_CAPTURE_HAR_BINDING_INVALID");
    return [one.data];
  })();
  const scopedEntries: Array<z.infer<typeof harEntrySchema>> = [];
  for (const bytes of harBytes) {
    const har = z.object({ log: z.object({ entries: z.array(z.unknown()).max(50_000) }) }).safeParse(parseManualCaptureJson(bytes.toString("utf8")));
    if (!har.success) manualCaptureError("MANUAL_CAPTURE_HAR_INVALID");
    for (const entry of har.data.log.entries) {
      const requestIdentity = z.object({ request: z.object({ url: z.string(), method: z.string() }) }).safeParse(entry);
      if (!requestIdentity.success || !targets.some((target) => target.url === requestIdentity.data.request.url && target.method === requestIdentity.data.request.method)) continue;
      const parsed = harEntrySchema.safeParse(entry);
      if (!parsed.success) manualCaptureError("MANUAL_CAPTURE_SCOPED_HAR_ENTRY_INVALID");
      scopedEntries.push(parsed.data);
    }
  }
  for (const target of targets) {
    const matches = scopedEntries.filter((entry) => {
      const content = entry.response.content;
      let text = content.text;
      if (content.encoding === "base64") {
        if (text === undefined || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)) return false;
        text = Buffer.from(text, "base64").toString("utf8");
      } else if (content.encoding !== undefined) return false;
      return entry.startedDateTime === target.started_at && entry.request.url === target.url && entry.request.method === target.method &&
        entry.request.postData?.text === (target.request_form_text ?? target.request_json_text) && entry.response.status === target.http_status &&
        text === target.response_json_text;
    });
    if (matches.length !== 1) manualCaptureError("MANUAL_CAPTURE_HAR_BINDING_INVALID");
  }
  return { status: "VERIFIED_STORED_BUSINESS_MATCHES", matchedEntries: targets.length, unselectedScopedEntries: scopedEntries.length - targets.length };
}

export async function replayManualChromeCapture(input: {
  capture: unknown; evidenceRoot: string; now: Date;
}): Promise<ManualCaptureDiagnostic> {
  if (!Number.isFinite(input.now.getTime())) manualCaptureError("MANUAL_CAPTURE_CLOCK_INVALID");
  const capture = parseManualChromeCapture(input.capture);
  const loaded = new Map<string, Buffer>();
  for (const artifact of capture.artifacts) loaded.set(artifact.purpose, await readBoundArtifact(input.evidenceRoot, artifact));
  const business = parseManualCaptureJson(loaded.get("BUSINESS")!.toString("utf8"));
  const sourceReplay = capture.sourceId === "source-cspc-social"
    ? (await import("./manualChromeCspcReplay")).replayManualCspcCapture({ business, now: input.now,
      ...(loaded.has("CSPC_ROOT_HTML") ? { rootHtml: loaded.get("CSPC_ROOT_HTML")!.toString("utf8") } : {}),
      ...(loaded.has("CSPC_FRAME_HTML") ? { frameHtml: loaded.get("CSPC_FRAME_HTML")!.toString("utf8") } : {}),
      ...(loaded.has("CSPC_ROOT_HTML") ? { savedRootArtifactPath: capture.artifacts.find(({ purpose }) => purpose === "CSPC_ROOT_HTML")!.path } : {}),
      ...(loaded.has("CSPC_FRAME_HTML") ? { savedFrameArtifactPath: capture.artifacts.find(({ purpose }) => purpose === "CSPC_FRAME_HTML")!.path } : {}),
      ...(capture.renderedExportedAtApprox ? { renderedExportedAtApprox: capture.renderedExportedAtApprox } : {}) })
    : (await import("./manualChromeQiluReplay")).replayManualQiluCapture({ business, now: input.now });
  const rawHarBinding = verifyHarBinding(business, loaded);
  const gaps = ["RETROSPECTIVE_NOT_RUN_BOUND", "ACQUISITION_PROVENANCE_UNAUTHENTICATED", ...sourceReplay.gaps];
  if (rawHarBinding.status === "MISSING") gaps.push("RAW_HAR_NOT_AVAILABLE");
  if (rawHarBinding.unselectedScopedEntries > 0) gaps.push("UNSELECTED_SCOPED_HAR_REQUESTS_PRESENT");
  return {
    schemaVersion: "manual-chrome-capture-diagnostic-v1",
    decision: "DIAGNOSTIC_ONLY", qualificationEligible: false,
    sourceId: capture.sourceId, evaluatedAt: input.now.toISOString(),
    gaps,
    artifactIntegrity: capture.artifacts.map(({ purpose, sha256, bytes }) => ({ purpose, sha256, bytes })),
    sourceReplay, rawHarBinding
  };
}
