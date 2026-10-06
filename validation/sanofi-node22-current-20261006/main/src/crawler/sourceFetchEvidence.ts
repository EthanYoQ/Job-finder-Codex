import { astellasPdfCityEnvelopeSchema } from "./astellasPdfCityContract";
import { astraZenecaDetailEnvelopeSchema } from "./astraZenecaDetailContract";
import { isJnjDomListArtifact } from "./jnjCareersDomContract";
import { createHash } from "node:crypto";
import { z } from "zod";

const NON_EMPTY = z.string().trim().min(1);
const ISO_INSTANT = z.string().datetime({ offset: true });
const NETWORK_ARTIFACT_KINDS = new Set([
  "OFFICIAL_COMPANY_PAGE",
  "REDIRECT_TRACE",
  "ATS_PAGE",
  "ATS_API_RESPONSE",
  "PAGINATION_PAGE"
]);
const SENSITIVE_VALUE_FRAGMENTS = [
  "bearer", "authorization", "clientsecret", "apikey", "accesstoken", "refreshtoken",
  "password", "secret", "cookie"
] as const;
const SENSITIVE_URL_KEY_FRAGMENTS = [
  "token", "auth", "authorization", "bearer", "signature", "sig", "secret", "key",
  "credential", "password", "passwd", "pwd", "cookie", "session", "jwt", "oauth",
  "clientid", "clientsecret"
] as const;
const SENSITIVE_URL_CONTENT_FRAGMENTS = [
  "bearer", "basic", "authorization", "accesstoken", "refreshtoken", "clientsecret",
  "signature", "secret", "credential", "password", "passwd", "pwd", "cookie", "jwt", "oauth"
] as const;
const EVIDENCE_IDENTIFIER_GRAMMAR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const httpUrl = z.string().url().transform((value, context) => {
  try {
    return sanitizeEvidenceHttpUrl(value);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "network URL contains forbidden credentials or query metadata" });
    return z.NEVER;
  }
});

const captureToolSchema = z.object({
  name: NON_EMPTY,
  version: NON_EMPTY
}).strict();

const canonicalSegmentSchema = z.string().superRefine((value, context) => {
  try { assertEvidenceIdentifier(value); } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "value does not use the canonical identifier grammar" });
  }
});

const redactionDescriptorSchema = z.object({
  kind: z.enum(["CREDENTIAL_MATERIAL", "UPSTREAM_ERROR_TEXT"]),
  count: z.number().int().positive().max(10_000)
}).strict();

const artifactSchema = z.object({
  id: canonicalSegmentSchema,
  logicalKey: canonicalSegmentSchema,
  kind: z.enum([
    "OFFICIAL_COMPANY_PAGE", "REDIRECT_TRACE", "ATS_PAGE", "ATS_API_RESPONSE",
    "PAGINATION_PAGE", "SCREENSHOT", "DEDUPE_LEDGER", "ORACLE_RESULT", "COMMAND_OUTPUT"
  ]),
  channelId: NON_EMPTY.optional(),
  requestedUrl: httpUrl.optional(),
  finalUrl: httpUrl.optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  contentType: z.string().trim().min(1).max(512).regex(/^[^\u0000-\u001f\u007f]+$/).optional(),
  capturedAt: ISO_INSTANT,
  body: z.union([z.string(), z.instanceof(Uint8Array)]),
  bodyRepresentation: z.enum(["EXACT", "REDACTED"]).optional(),
  rawBodySha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  redactionDescriptors: z.array(redactionDescriptorSchema).min(1).max(16).optional(),
  extractorLocator: NON_EMPTY
}).strict().superRefine((artifact, context) => {
  if (!NETWORK_ARTIFACT_KINDS.has(artifact.kind)) return;
  for (const field of ["requestedUrl", "finalUrl", "httpStatus", "contentType"] as const) {
    if (artifact[field] === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `network artifact requires ${field}` });
    }
  }
  if (artifact.bodyRepresentation === "REDACTED") {
    if (!artifact.rawBodySha256 || !artifact.redactionDescriptors) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "redacted body requires structured raw hash and descriptors" });
    }
  } else if (artifact.bodyRepresentation === "EXACT") {
    if (artifact.rawBodySha256 || artifact.redactionDescriptors) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "exact body cannot carry redaction provenance" });
    }
  } else if (artifact.rawBodySha256 || artifact.redactionDescriptors) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "redaction provenance requires an explicit body representation" });
  }
});

const nullableText = NON_EMPTY.nullable().optional();
const nullableInt = z.number().int().nonnegative().nullable().optional();
const nullablePositiveSafeInt = z.number().int().positive().safe().nullable().optional();
const idSetSchema = (label: "raw" | "valid") => z.array(NON_EMPTY).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `${label} page ID set contains a duplicate` });
  }
});
const pageSchema = z.object({
  sequence: z.number().int().nonnegative(),
  artifactLogicalKey: NON_EMPTY,
  channelId: NON_EMPTY.optional(),
  requestedCursor: nullableText,
  returnedCursor: nullableText,
  requestedOffset: nullableInt,
  returnedOffset: nullableInt,
  requestedPage: nullableInt,
  returnedPage: nullableInt,
  requestedPageSize: nullablePositiveSafeInt,
  returnedPageSize: nullablePositiveSafeInt,
  rawJobIds: idSetSchema("raw"),
  validJobIds: idSetSchema("valid"),
  declaredTotal: nullableInt,
  declaredCount: nullableInt,
  declaredPages: nullableInt,
  nextPageSignalBefore: nullableText,
  nextPageSignalAfter: nullableText,
  responseFingerprintSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  termination: z.enum([
    "CONTINUE", "NEXT_ABSENT", "DECLARED_TOTAL_REACHED", "EMPTY_PAGE", "REPEATED_CURSOR",
    "MAX_PAGE_LIMIT", "FAILED", "ABORTED"
  ]),
  anomalyCodes: z.array(z.enum([
    "REPEATED_RESPONSE_FINGERPRINT", "REPEATED_JOB_ID_SET_WITH_NEXT",
    "CURSOR_NOT_ADVANCING", "OFFSET_NOT_ADVANCING", "INTERMEDIATE_EMPTY_PAGE",
    "TOTAL_CHANGED", "MAX_PAGES_WITH_NEXT", "EXPECTED_CHANNEL_NOT_VISITED",
    "RETURNED_PAGE_MISMATCH", "DECLARED_CAPACITY_CONTRADICTION",
    "RAW_ID_OVERLAP_ACROSS_PAGES", "INTERMEDIATE_SHORT_PAGE",
    "RETURNED_PAGE_SIZE_MISMATCH"
  ])),
  capturedAt: ISO_INSTANT
}).strict();

const completenessSchema = z.object({
  kind: z.enum(["OFFICIAL_TOTAL_COUNT", "OFFICIAL_TOTAL_PAGES", "COMPLETE_PAGE_TRAVERSAL"]),
  value: z.number().int().nonnegative(),
  artifactLogicalKey: NON_EMPTY,
  extractorLocator: NON_EMPTY,
  scope: z.enum(["SOURCE", "CHANNEL", "GLOBAL_UNFILTERED"]),
  channelId: NON_EMPTY.optional()
}).strict().superRefine((value, context) => {
  if (value.scope === "CHANNEL" && !value.channelId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "CHANNEL completeness requires channelId" });
  }
  if (value.scope !== "CHANNEL" && value.channelId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${value.scope} completeness cannot include channelId; GLOBAL_UNFILTERED must remain distinguishable`
    });
  }
});

const fetchCountsSchema = z.object({
  rawCount: z.number().int().nonnegative(),
  parsedCount: z.number().int().nonnegative(),
  validCount: z.number().int().nonnegative(),
  parseDiscardCount: z.number().int().nonnegative(),
  validationDiscardCount: z.number().int().nonnegative()
}).strict();

const MACHINE_CODE = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).superRefine(rejectSensitiveDtoValue);
const supportingArtifactOnlyFailureSchema = z.object({
  code: MACHINE_CODE
}).strict();
const MACHINE_FIELD = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/).superRefine(rejectSensitiveDtoValue);
const COLLISION_GROUP_KEY = z.string().regex(/^[0-9a-f]{64}$/);
const LOSS_DETAIL_KEYS = new Set([
  "code", "field", "pageSequence", "recordIndex", "collisionGroupKey", "noteCode"
]);
const lossDetailsSchema = z.unknown().superRefine((value, context) => {
  if (!hasStrictEnumerableDataShape(value, LOSS_DETAIL_KEYS)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "loss details must use the strict redacted DTO" });
  }
}).pipe(z.object({
  code: MACHINE_CODE,
  field: MACHINE_FIELD.optional(),
  pageSequence: z.number().int().nonnegative().safe().optional(),
  recordIndex: z.number().int().nonnegative().safe().optional(),
  collisionGroupKey: COLLISION_GROUP_KEY.optional(),
  noteCode: MACHINE_CODE.optional()
}).strict());

const lossSchema = z.object({
  stage: z.enum(["PARSE", "VALIDATION"]),
  reason: NON_EMPTY,
  rawLocator: NON_EMPTY,
  details: lossDetailsSchema,
  recordedAt: ISO_INSTANT.optional()
}).strict();

const sourceFetchEvidenceSchema = z.object({
  astraZenecaDetails: astraZenecaDetailEnvelopeSchema.optional(),
  astellasPdfLocations: astellasPdfCityEnvelopeSchema.optional(),
  captureTool: captureToolSchema,
  artifacts: z.array(artifactSchema).min(1),
  pages: z.array(pageSchema),
  declaredCompleteness: completenessSchema.optional(),
  supportingArtifactOnlyFailure: supportingArtifactOnlyFailureSchema.optional(),
  fetchCounts: fetchCountsSchema,
  fetchLosses: z.array(lossSchema)
}).strict().superRefine((evidence, context) => {
  const supportingOnly = evidence.supportingArtifactOnlyFailure !== undefined;
  if (evidence.pages.length === 0 && !supportingOnly) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "page trace is required unless this is a supporting-artifact-only failure" });
  }
  if (supportingOnly) {
    if (evidence.pages.length !== 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "supporting-artifact-only failure cannot contain page traces" });
    }
    if (evidence.declaredCompleteness !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "supporting-artifact-only failure cannot declare completeness" });
    }
    if (evidence.artifacts.some((artifact) => artifact.kind === "PAGINATION_PAGE")) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "supporting-artifact-only failure cannot contain pagination artifacts" });
    }
    const counts = evidence.fetchCounts;
    if (Object.values(counts).some((value) => value !== 0) || evidence.fetchLosses.length !== 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "supporting-artifact-only failure requires zero fetch accounting" });
    }
  }
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const artifact of evidence.artifacts) {
    if (keys.has(artifact.logicalKey)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate artifact logical key ${artifact.logicalKey}` });
    }
    if (ids.has(artifact.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate artifact id ${artifact.id}` });
    }
    keys.add(artifact.logicalKey);
    ids.add(artifact.id);
  }

  for (let index = 0; index < evidence.pages.length; index += 1) {
    const page = evidence.pages[index]!;
    if (page.sequence !== index) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "page sequence must be contiguous from zero" });
    }
    const pageArtifact = evidence.artifacts.find(
      (artifact) => artifact.logicalKey === page.artifactLogicalKey
    );
    if (!pageArtifact) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `page references missing artifact ${page.artifactLogicalKey}` });
    } else if (!NETWORK_ARTIFACT_KINDS.has(pageArtifact.kind) && !isJnjDomListArtifact(evidence.captureTool, pageArtifact)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "page must reference a network artifact" });
    } else if ((page.channelId ?? null) !== (pageArtifact.channelId ?? null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "page channel must exactly match its artifact channel" });
    }
  }

  if (evidence.declaredCompleteness) {
    const declaredArtifact = evidence.artifacts.find(
      (artifact) => artifact.logicalKey === evidence.declaredCompleteness!.artifactLogicalKey
    );
    if (!declaredArtifact) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "declared completeness references missing artifact" });
    } else if (!NETWORK_ARTIFACT_KINDS.has(declaredArtifact.kind) && !isJnjDomListArtifact(evidence.captureTool, declaredArtifact)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "declared official completeness requires a network artifact" });
    } else if (declaredArtifact.extractorLocator !== evidence.declaredCompleteness.extractorLocator) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "declared completeness locator must match the referenced artifact locator"
      });
    } else if (
      evidence.declaredCompleteness.scope === "CHANNEL" &&
      declaredArtifact.channelId !== evidence.declaredCompleteness.channelId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CHANNEL completeness must match the referenced artifact channel"
      });
    } else if (
      evidence.declaredCompleteness.scope === "SOURCE" && declaredArtifact.channelId !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SOURCE completeness requires an artifact without channel identity"
      });
    } else if (
      evidence.declaredCompleteness.scope === "GLOBAL_UNFILTERED" && declaredArtifact.channelId !== undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GLOBAL_UNFILTERED completeness requires an artifact without channel identity"
      });
    }
  }

  const c = evidence.fetchCounts;
  if (
    c.rawCount !== c.parsedCount + c.parseDiscardCount ||
    c.parsedCount !== c.validCount + c.validationDiscardCount
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "fetch-stage counts do not reconcile" });
  }
  const parseLossCount = evidence.fetchLosses.filter((loss) => loss.stage === "PARSE").length;
  const validationLossCount = evidence.fetchLosses.filter((loss) => loss.stage === "VALIDATION").length;
  if (parseLossCount !== c.parseDiscardCount || validationLossCount !== c.validationDiscardCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "fetch loss rows must exactly match discard counters" });
  }
});

export type SourceFetchArtifactDraft = z.infer<typeof artifactSchema>;
export type SourceFetchPageTrace = z.infer<typeof pageSchema>;
export type PersistentSourceFetchEvidence = z.infer<typeof sourceFetchEvidenceSchema>;
export type CaptureTool = z.infer<typeof captureToolSchema>;

export function parsePersistentSourceFetchEvidence(input: unknown): PersistentSourceFetchEvidence {
  return sourceFetchEvidenceSchema.parse(input);
}

export function parseArtifactArchiveDrafts(input: {
  captureTool: unknown;
  artifacts: unknown;
}): { captureTool: CaptureTool; artifacts: SourceFetchArtifactDraft[] } {
  return z.object({
    captureTool: captureToolSchema,
    artifacts: z.array(artifactSchema).min(1)
  }).strict().parse(input);
}

export function sha256Bytes(bytes: Uint8Array): { sha256: string; byteCount: number } {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteCount: bytes.byteLength
  };
}

export function canonicalStringSetSha256(values: readonly string[]): string {
  for (const value of values) assertUnicodeScalarString(value);
  const sorted = [...new Set(values)].sort(compareUtf8);
  return sha256Bytes(Buffer.from(JSON.stringify(sorted), "utf8")).sha256;
}

export function canonicalPageTraceSha256(pages: readonly SourceFetchPageTrace[]): string {
  for (let index = 0; index < pages.length; index += 1) {
    if (pages[index]!.sequence !== index) {
      throw new Error("page sequence must be contiguous from zero");
    }
    assertNoUnpairedSurrogatesDeep(pages[index]);
  }
  const records = pages.map((page) => ({
    ...page,
    rawJobIds: assertUniquePageIds(page.rawJobIds, "raw").sort(compareUtf8),
    validJobIds: assertUniquePageIds(page.validJobIds, "valid").sort(compareUtf8),
    anomalyCodes: [...new Set(page.anomalyCodes)].sort(compareUtf8)
  }));
  return sha256Bytes(Buffer.from(JSON.stringify(records), "utf8")).sha256;
}

function assertUniquePageIds(values: readonly string[], label: string): string[] {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} page ID set contains a duplicate`);
  }
  return [...values];
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function assertNoUnpairedSurrogatesDeep(value: unknown): void {
  if (typeof value === "string") {
    assertUnicodeScalarString(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) assertNoUnpairedSurrogatesDeep(child);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertUnicodeScalarString(key);
      assertNoUnpairedSurrogatesDeep(child);
    }
  }
}

function assertUnicodeScalarString(value: string): void {
  if (!hasOnlyUnicodeScalarValues(value)) {
    throw new Error("canonical hashing rejects unpaired Unicode surrogates");
  }
}

function hasOnlyUnicodeScalarValues(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function rejectSensitiveDtoValue(value: string, context: z.RefinementCtx): void {
  const normalized = normalizeSecurityName(value);
  if (SENSITIVE_VALUE_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "redacted DTO contains a forbidden sensitive value" });
  }
}

function hasStrictEnumerableDataShape(value: unknown, allowedKeys: ReadonlySet<string>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !allowedKeys.has(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function normalizeSecurityName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function sanitizeEvidenceHttpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL protocol is forbidden");
  if (url.username || url.password) throw new Error("URL credentials are forbidden");
  for (const [key, queryValue] of url.searchParams.entries()) {
    const normalizedKey = normalizeSecurityName(key);
    if (SENSITIVE_URL_KEY_FRAGMENTS.some((fragment) => normalizedKey.includes(fragment))) {
      throw new Error("URL sensitive query metadata is forbidden");
    }
    rejectSensitiveUrlContent(queryValue);
  }
  rejectSensitiveUrlContent(safeDecodeUrlComponent(url.hash.slice(1)));

  const sanitized = new URLSearchParams();
  for (const [key, queryValue] of url.searchParams.entries()) {
    const marker = /^sha256:[0-9a-f]{64}$/.test(queryValue)
      ? queryValue
      : `sha256:${createHash("sha256").update(Buffer.from(queryValue, "utf8")).digest("hex")}`;
    sanitized.append(key, marker);
  }
  url.search = sanitized.toString();
  url.hash = "";
  return url.toString();
}

export function assertSafeEvidenceHttpUrl(value: string): void {
  sanitizeEvidenceHttpUrl(value);
}

function rejectSensitiveUrlContent(value: string): void {
  if (!value) return;
  const normalized = normalizeSecurityName(value);
  if (SENSITIVE_URL_CONTENT_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
    throw new Error("URL sensitive content is forbidden");
  }
}

function safeDecodeUrlComponent(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export function assertEvidenceIdentifier(value: string, label = "identifier"): void {
  if (!EVIDENCE_IDENTIFIER_GRAMMAR.test(value)) {
    throw new Error(`${label} does not use the canonical identifier grammar`);
  }
  assertWindowsCanonicalSegment(value, label);
}

export function assertWindowsCanonicalSegment(value: string, label = "path segment"): void {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 128 ||
    value === "." || value === ".." || /[\u0000-\u001f\u007f<>:"/\\|?*]/.test(value) ||
    /[. ]$/.test(value) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value) ||
    !hasOnlyUnicodeScalarValues(value)
  ) {
    throw new Error(`${label} is not a Windows-safe canonical segment`);
  }
}
