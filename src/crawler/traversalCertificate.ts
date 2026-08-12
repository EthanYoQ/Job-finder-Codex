import { createHash } from "node:crypto";
import { z } from "zod";
import { assertAdapterReconciliation } from "./adapters/reconciliation";
import type { AdapterReconciliation } from "./adapters/types";
import { buildJobDedupeKey, type NormalizedJobRecord } from "./normalizedJob";
import { evaluatePaginationEvidence, type PaginationEvaluation } from "./paginationEvidence";
import { sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import {
  canonicalPageTraceSha256,
  canonicalStringSetSha256,
  parsePersistentSourceFetchEvidence,
  type PersistentSourceFetchEvidence
} from "./sourceFetchEvidence";
import { acquireBrowserSourcePermit } from "./browserSourceConcurrency";

export const B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION =
  "b-grade-independent-traversal-v1" as const;

export const REQUIRED_B_GRADE_TRAVERSAL_CERTIFICATES = Object.freeze({
  "source-viatris-social": "company-viatris"
} as const);

export const B_GRADE_VALIDATION_FRESHNESS_MAXIMUM_MS = 7 * 24 * 60 * 60 * 1000;
export const B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS = 60 * 60 * 1000;

export type BGradeValidationTrigger =
  | "INITIAL_QUALIFICATION"
  | "CONFIG_CHANGED"
  | "ANOMALY_TRIGGERED"
  | "STABLE_RUN";

export type BGradeCertificateBlockerCode =
  | "UNSUPPORTED_SOURCE"
  | "SCOPE_MISMATCH"
  | "TRANSPORT_OR_ADAPTER_FAILED"
  | "SOURCE_CONFIG_MISMATCH"
  | "MAIN_TRAVERSAL_INCOMPLETE"
  | "LOSSY_PIPELINE"
  | "OUTPUT_MISMATCH"
  | "INDEPENDENT_VALIDATION_INVALID"
  | "VALIDATOR_PATH_NOT_INDEPENDENT"
  | "INDEPENDENT_JOB_SET_MISMATCH"
  | "VALIDATION_REFRESH_REQUIRED"
  | "VALIDATION_EXPIRED";

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/u);
const NONBLANK = z.string().trim().min(1);
const ISO = z.string().datetime({ offset: true });
const browserPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  declaredTotalPages: z.number().int().positive(),
  sourceJobIds: z.array(NONBLANK),
  nextControlPresent: z.boolean()
}).strict();
const browserValidationSchema = z.object({
  schemaVersion: z.literal("viatris-browser-traversal-validator-v1"),
  sourceId: z.literal("source-viatris-social"),
  companyId: z.literal("company-viatris"),
  retrievalPath: z.literal("PLAYWRIGHT_RENDERED_UI_CLICK_PAGINATION"),
  validatorImplementationId: z.literal("viatris-playwright-ui-traversal-v1"),
  sourceConfigSha256: SHA256,
  surfaceIds: z.array(NONBLANK).min(1),
  channelIds: z.array(NONBLANK).min(1),
  pages: z.array(browserPageSchema).min(1),
  pageCount: z.number().int().positive(),
  canonicalJobIdSetSha256: SHA256,
  artifactLogicalKey: z.literal("viatris-browser-traversal-validation"),
  artifactSha256: SHA256,
  observedAt: ISO,
  expiresAt: ISO
}).strict();

export type ViatrisBrowserTraversalValidation = z.infer<typeof browserValidationSchema>;

export function readReusableViatrisTraversalValidation(input: {
  certificate: unknown;
  certificateSha256: string;
  sourceConfigSha256: string;
  now: Date;
}): ViatrisBrowserTraversalValidation {
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new Error("B-grade validation reuse requires a valid current time");
  }
  const certificate = certificateSchema.parse(input.certificate);
  if (!SHA256.safeParse(input.certificateSha256).success ||
      sha256(canonicalJson(certificate)) !== input.certificateSha256) {
    throw new Error("B-grade traversal certificate hash mismatch");
  }
  if (certificate.binding.sourceConfigSha256 !== input.sourceConfigSha256 ||
      certificate.independentValidation.sourceConfigSha256 !== input.sourceConfigSha256) {
    throw new Error("B-grade traversal certificate source config mismatch");
  }
  const observedAt = Date.parse(certificate.independentValidation.observedAt);
  const expiresAt = Date.parse(certificate.independentValidation.expiresAt);
  if (observedAt > input.now.getTime() || expiresAt < input.now.getTime() ||
      expiresAt - observedAt > B_GRADE_VALIDATION_FRESHNESS_MAXIMUM_MS) {
    throw new Error("B-grade traversal validation is expired or temporally invalid");
  }
  return certificate.independentValidation;
}

export function viatrisTraversalValidationMatchesCurrentJobs(
  validation: ViatrisBrowserTraversalValidation,
  jobs: readonly NormalizedJobRecord[]
): boolean {
  const parsed = browserValidationSchema.safeParse(validation);
  if (!parsed.success || jobs.some((job) => job.sourceId !== "source-viatris-social" || !job.sourceJobId)) {
    return false;
  }
  const sourceJobIds = canonicalStrings(jobs.map((job) => job.sourceJobId!));
  return sourceJobIds.length === jobs.length &&
    parsed.data.canonicalJobIdSetSha256 === canonicalStringSetSha256(sourceJobIds);
}

export interface ViatrisRenderedUiPageCapture {
  pageNumber: number;
  declaredTotalPages: number;
  sourceJobIds: string[];
  nextControlPresent: boolean;
}

export type ViatrisRenderedUiCapture = (input: {
  entryUrl: string;
  signal?: AbortSignal;
}) => Promise<{ observedAt: string; pages: ViatrisRenderedUiPageCapture[] }>;

const certificateSchema = z.object({
  schemaVersion: z.literal(B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION),
  grade: z.literal("B"),
  binding: z.object({
    releaseCandidateId: NONBLANK,
    batchId: NONBLANK,
    sourceResultId: NONBLANK,
    sourceId: z.literal("source-viatris-social"),
    sourceConfigSha256: SHA256
  }).strict(),
  scope: z.object({
    companyId: z.literal("company-viatris"),
    sourceId: z.literal("source-viatris-social"),
    recruitmentType: z.literal("SOCIAL"),
    geography: z.literal("MAINLAND_CHINA"),
    businessUnit: z.literal("ALL"),
    surfaceIds: z.array(NONBLANK).min(1),
    channelIds: z.array(NONBLANK).min(1)
  }).strict(),
  mainTraversal: z.object({
    retrievalPath: z.literal("HTTP_TUPU360_ENTRY_PLUS_POST"),
    pageCount: z.number().int().positive(),
    terminalEvent: z.enum(["NEXT_ABSENT", "EMPTY_PAGE"]),
    paginationTraceSha256: SHA256,
    canonicalJobIdSetSha256: SHA256
  }).strict(),
  independentValidation: browserValidationSchema,
  validationPolicy: z.object({
    trigger: z.enum(["INITIAL_QUALIFICATION", "CONFIG_CHANGED", "ANOMALY_TRIGGERED", "STABLE_RUN"]),
    execution: z.enum(["CURRENT_RUN", "REUSED"])
  }).strict(),
  counts: z.object({
    mainUniqueJobCount: z.number().int().nonnegative(),
    independentUniqueJobCount: z.number().int().nonnegative(),
    finalUniqueJobCount: z.number().int().nonnegative(),
    parseDiscardCount: z.literal(0),
    validationDiscardCount: z.literal(0),
    normalizationDiscardCount: z.literal(0),
    dedupeDiscardCount: z.literal(0)
  }).strict(),
  output: z.object({
    canonicalJobSetSha256: SHA256,
    adapterReconciliationSha256: SHA256,
    collisionLedgerSha256: SHA256
  }).strict(),
  issuedAt: ISO
}).strict();

export type BGradeTraversalCertificate = z.infer<typeof certificateSchema>;

export interface BGradeCertificateCandidate {
  binding: {
    releaseCandidateId: string;
    batchId: string;
    sourceResultId: string;
    sourceConfigSha256: string;
  };
  plan: SourceCrawlPlan;
  transportSuccess: boolean;
  adapterSuccess: boolean;
  evidence: PersistentSourceFetchEvidence;
  paginationEvaluation: PaginationEvaluation;
  reconciliation: AdapterReconciliation;
  jobs: readonly NormalizedJobRecord[];
  independentValidation: unknown;
  validationExecution: "CURRENT_RUN" | "REUSED";
  trigger: BGradeValidationTrigger;
  now: Date;
}

export type BGradeCertificateDecision =
  | { status: "CERTIFIED"; certificate: BGradeTraversalCertificate; certificateSha256: string }
  | { status: "REJECTED"; resultingGrade: "C"; blockerCodes: readonly BGradeCertificateBlockerCode[] };

export interface BGradeCertificateReceiptExpectation {
  releaseCandidateId: string;
  batchId: string;
  sourceResultId: string;
  sourceId: string;
  companyId?: string;
  sourceConfigSha256: string;
  surfaceIds?: readonly string[];
  channelIds?: readonly string[];
  canonicalJobSetSha256?: string;
  adapterReconciliationSha256?: string;
  collisionLedgerSha256?: string;
}

export function requiresBGradeTraversalCertificate(plan: SourceCrawlPlan): boolean {
  return requiresBGradeCertificateSourceId(plan.source.id);
}

export function requiresBGradeCertificateSourceId(sourceId: string): boolean {
  return Object.prototype.hasOwnProperty.call(REQUIRED_B_GRADE_TRAVERSAL_CERTIFICATES, sourceId);
}

export function createViatrisBrowserTraversalValidation(input: {
  sourceConfigSha256: string;
  surfaceIds: readonly string[];
  channelIds: readonly string[];
  pages: readonly {
    pageNumber: number;
    declaredTotalPages: number;
    sourceJobIds: readonly string[];
    nextControlPresent: boolean;
  }[];
  observedAt: string;
  expiresAt: string;
}): ViatrisBrowserTraversalValidation {
  if (input.pages.length === 0) throw new Error("Browser traversal requires at least one rendered page");
  const total = input.pages.length;
  for (let index = 0; index < total; index += 1) {
    const page = input.pages[index]!;
    if (page.pageNumber !== index + 1 || page.declaredTotalPages !== total ||
        page.nextControlPresent !== (index < total - 1)) {
      throw new Error("Browser traversal did not visit every declared UI page in order");
    }
  }
  const allIds = input.pages.flatMap((page) => [...page.sourceJobIds]);
  if (new Set(allIds).size !== allIds.length) {
    throw new Error("Browser traversal contains duplicate job IDs across rendered pages");
  }
  const canonicalPages = input.pages.map((page) => ({
    ...page,
    sourceJobIds: canonicalStrings(page.sourceJobIds)
  }));
  const artifactSha256 = sha256(canonicalJson({
    sourceId: "source-viatris-social",
    retrievalPath: "PLAYWRIGHT_RENDERED_UI_CLICK_PAGINATION",
    pages: canonicalPages,
    observedAt: input.observedAt
  }));
  return browserValidationSchema.parse({
    schemaVersion: "viatris-browser-traversal-validator-v1",
    sourceId: "source-viatris-social",
    companyId: "company-viatris",
    retrievalPath: "PLAYWRIGHT_RENDERED_UI_CLICK_PAGINATION",
    validatorImplementationId: "viatris-playwright-ui-traversal-v1",
    sourceConfigSha256: input.sourceConfigSha256,
    surfaceIds: canonicalStrings(input.surfaceIds),
    channelIds: canonicalStrings(input.channelIds),
    pages: canonicalPages,
    pageCount: total,
    canonicalJobIdSetSha256: canonicalStringSetSha256(allIds),
    artifactLogicalKey: "viatris-browser-traversal-validation",
    artifactSha256,
    observedAt: input.observedAt,
    expiresAt: input.expiresAt
  });
}

/**
 * Runs the independent Viatris verifier through the rendered public UI. The
 * default path launches Chromium and clicks the site's page controls; it does
 * not import or call the HTTP/Tupu360 adapter used by the main crawl.
 */
export async function runViatrisBrowserTraversalValidator(input: {
  entryUrl: string;
  sourceConfigSha256: string;
  surfaceIds: readonly string[];
  channelIds: readonly string[];
  signal?: AbortSignal;
  capture?: ViatrisRenderedUiCapture;
}): Promise<ViatrisBrowserTraversalValidation> {
  const expectedEntry = "https://careersite.tupu360.com/Viatris/position/index?recruitmentType=SOCIALRECRUITMENT";
  if (input.entryUrl !== expectedEntry) throw new Error("Viatris browser validator entry URL mismatch");
  const captured = await (input.capture ?? defaultViatrisRenderedUiCapture)({
    entryUrl: input.entryUrl,
    ...(input.signal ? { signal: input.signal } : {})
  });
  const observedAtMs = Date.parse(captured.observedAt);
  if (!Number.isFinite(observedAtMs)) throw new Error("Viatris browser validation observedAt is invalid");
  return createViatrisBrowserTraversalValidation({
    sourceConfigSha256: input.sourceConfigSha256,
    surfaceIds: input.surfaceIds,
    channelIds: input.channelIds,
    pages: captured.pages,
    observedAt: captured.observedAt,
    expiresAt: new Date(observedAtMs + B_GRADE_VALIDATION_FRESHNESS_MAXIMUM_MS).toISOString()
  });
}

async function defaultViatrisRenderedUiCapture(input: {
  entryUrl: string;
  signal?: AbortSignal;
}): Promise<{ observedAt: string; pages: ViatrisRenderedUiPageCapture[] }> {
  if (input.signal?.aborted) throw input.signal.reason;
  const releaseBrowserPermit = await acquireBrowserSourcePermit(input.signal);
  try {
  const { chromium } = await import("playwright-core");
  const { FORMAL_CHROMIUM_ARGS, FORMAL_CHROMIUM_PATH } = await import("../readiness/formalBrowserPreflight");
  const browser = await chromium.launch({
    ...(process.platform === "linux"
      ? { executablePath: FORMAL_CHROMIUM_PATH, args: [...FORMAL_CHROMIUM_ARGS] }
      : { channel: "chrome" as const }),
    headless: true,
    timeout: 30_000
  });
  const abort = () => { void browser.close(); };
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    const page = await browser.newPage();
    const navigation = await page.goto(input.entryUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!navigation || navigation.status() < 200 || navigation.status() >= 400 || navigation.url() !== input.entryUrl) {
      throw new Error("Viatris browser validator navigation failed");
    }
    await page.locator(".position-list-body").waitFor({ state: "attached", timeout: 30_000 });
    const totalText = await page.locator("#pageTurnUl li:first-child").first().innerText();
    const totalMatch = /^\s*共\s*([1-9]\d*)\s*页\s*$/u.exec(totalText);
    const totalPages = totalMatch ? Number(totalMatch[1]) : Number.NaN;
    if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 60) {
      throw new Error("Viatris browser validator page declaration invalid");
    }
    const pages: ViatrisRenderedUiPageCapture[] = [];
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      if (input.signal?.aborted) throw input.signal.reason;
      const hrefs = await page.locator(".position-list-body .position-item .e-title a[href*='positionId=']")
        .evaluateAll((elements) => elements.map((element) => (element as HTMLAnchorElement).href));
      const sourceJobIds = hrefs.map((href) => {
        const id = new URL(href).searchParams.get("positionId")?.trim();
        if (!id) throw new Error("Viatris browser validator rendered job ID missing");
        return id;
      });
      const controlLocator = page.locator("#pageTurnUl li[onclick]");
      const controlExpressions = await controlLocator.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("onclick") ?? ""));
      const nextIndex = controlExpressions.findIndex((expression) =>
        new RegExp(`^\\s*pageTurn\\(\\s*${pageNumber + 1}\\s*,`, "u").test(expression));
      pages.push({
        pageNumber,
        declaredTotalPages: totalPages,
        sourceJobIds,
        nextControlPresent: nextIndex >= 0
      });
      if (pageNumber < totalPages) {
        if (nextIndex < 0) throw new Error("Viatris browser validator next-page control missing");
        await controlLocator.nth(nextIndex).click({ timeout: 30_000 });
        await page.waitForFunction(({ selector, previous }) => {
          const ids = [...document.querySelectorAll<HTMLAnchorElement>(selector)]
            .map((element) => new URL(element.href).searchParams.get("positionId") ?? "")
            .filter(Boolean).sort();
          const value = JSON.stringify([...new Set(ids)]);
          return value !== previous;
        }, { selector: ".position-list-body .position-item .e-title a[href*='positionId=']",
          previous: JSON.stringify([...new Set(sourceJobIds)].sort()) }, { timeout: 30_000 });
      }
    }
    return { observedAt: new Date().toISOString(), pages };
  } finally {
    input.signal?.removeEventListener("abort", abort);
    await browser.close();
  }
  } finally {
    releaseBrowserPermit();
  }
}

export function evaluateBGradeValidationRequirement(input: {
  trigger: BGradeValidationTrigger;
  validationExecution: "CURRENT_RUN" | "REUSED";
  validation: unknown;
  now: Date;
}): { acceptable: boolean; mustRunNow: boolean; reason: string } {
  const mustRunNow = input.trigger !== "STABLE_RUN";
  if (mustRunNow && input.validationExecution !== "CURRENT_RUN") {
    return { acceptable: false, mustRunNow: true, reason: "TRIGGER_REQUIRES_CURRENT_RUN_VALIDATION" };
  }
  const validation = browserValidationSchema.safeParse(input.validation);
  if (!validation.success || !validDate(input.now)) {
    return { acceptable: false, mustRunNow, reason: "VALIDATION_INVALID" };
  }
  try {
    assertViatrisBrowserValidationEquations(validation.data);
  } catch {
    return { acceptable: false, mustRunNow, reason: "VALIDATION_INVALID" };
  }
  const observedAt = Date.parse(validation.data.observedAt);
  const expiresAt = Date.parse(validation.data.expiresAt);
  const nowMs = input.now.getTime();
  if (observedAt > nowMs || expiresAt <= nowMs || expiresAt - observedAt > B_GRADE_VALIDATION_FRESHNESS_MAXIMUM_MS) {
    return { acceptable: false, mustRunNow, reason: "VALIDATION_EXPIRED" };
  }
  if (input.validationExecution === "CURRENT_RUN" && nowMs - observedAt > B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS) {
    return { acceptable: false, mustRunNow, reason: "CURRENT_RUN_VALIDATION_TOO_OLD" };
  }
  return {
    acceptable: true,
    mustRunNow,
    reason: mustRunNow ? "CURRENT_RUN_VALIDATION_REQUIRED_AND_PRESENT" :
      input.validationExecution === "REUSED" ? "UNEXPIRED_STABLE_EVIDENCE_REUSE" : "CURRENT_STABLE_VALIDATION_PRESENT"
  };
}

export function issueBGradeTraversalCertificate(input: BGradeCertificateCandidate): BGradeCertificateDecision {
  const blockers = new Set<BGradeCertificateBlockerCode>();
  const expectedSurfaces = canonicalStrings(input.plan.source.surfaceId ? [input.plan.source.surfaceId] : []);
  const expectedChannels = canonicalStrings(input.plan.expectedChannels?.map(({ channelId }) => channelId) ?? []);
  if (!requiresBGradeTraversalCertificate(input.plan)) blockers.add("UNSUPPORTED_SOURCE");
  if (!exactViatrisScope(input.plan) || expectedSurfaces.length === 0 || expectedChannels.length === 0) {
    blockers.add("SCOPE_MISMATCH");
  }
  if (!input.transportSuccess || !input.adapterSuccess) blockers.add("TRANSPORT_OR_ADAPTER_FAILED");
  if (input.binding.sourceConfigSha256 !== sourcePlanConfigSha256(input.plan)) {
    blockers.add("SOURCE_CONFIG_MISMATCH");
  }

  let evidence: PersistentSourceFetchEvidence | undefined;
  let pagination: PaginationEvaluation | undefined;
  try {
    evidence = parsePersistentSourceFetchEvidence(input.evidence);
    pagination = evaluatePaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true });
    const declaredPages = evidence.pages[0]?.declaredPages;
    const last = evidence.pages.at(-1);
    const completeTraversal = evidence.declaredCompleteness?.kind === "COMPLETE_PAGE_TRAVERSAL" &&
      evidence.declaredCompleteness.scope === "SOURCE" &&
      evidence.declaredCompleteness.value === evidence.pages.length &&
      declaredPages === evidence.pages.length &&
      evidence.pages.every((page) => page.declaredPages === declaredPages) &&
      (last?.termination === "NEXT_ABSENT" || last?.termination === "EMPTY_PAGE") &&
      pagination.safeCompleteness && pagination.verifiedEligible &&
      pagination.paginationTraceSha256 === input.paginationEvaluation.paginationTraceSha256;
    if (!completeTraversal) blockers.add("MAIN_TRAVERSAL_INCOMPLETE");
  } catch {
    blockers.add("MAIN_TRAVERSAL_INCOMPLETE");
  }

  let ledger: AdapterReconciliation | undefined;
  try {
    ledger = assertAdapterReconciliation({
      jobs: [...input.jobs],
      observation: { structuredJobCount: input.jobs.length } as never,
      reconciliation: input.reconciliation
    });
  } catch {
    blockers.add("OUTPUT_MISMATCH");
  }
  const rawObservationIds = evidence ? canonicalStrings(evidence.pages.flatMap((page) => page.validJobIds)) : [];
  const outputIds = canonicalStrings(input.jobs.flatMap((job) => job.sourceJobId ? [job.sourceJobId] : []));
  if (evidence && (evidence.fetchLosses.length !== 0 || evidence.fetchCounts.parseDiscardCount !== 0 ||
      evidence.fetchCounts.validationDiscardCount !== 0 || evidence.fetchCounts.rawCount !== rawObservationIds.length)) {
    blockers.add("LOSSY_PIPELINE");
  }
  if (!ledger || ledger.adapterLosses.length !== 0 || ledger.collisionGroups.length !== 0 ||
      ledger.rawInputCount !== rawObservationIds.length || ledger.dedupeOutputCount !== input.jobs.length ||
      outputIds.length !== input.jobs.length ||
      canonicalStringSetSha256(input.jobs.map(buildJobDedupeKey)) !== ledger.outputJobKeySetSha256) {
    blockers.add("OUTPUT_MISMATCH");
  }

  const rawValidation = input.independentValidation as Record<string, unknown> | null;
  if (rawValidation && rawValidation.retrievalPath === "HTTP_TUPU360_ENTRY_PLUS_POST") {
    blockers.add("VALIDATOR_PATH_NOT_INDEPENDENT");
  }
  if (rawValidation && (Array.isArray(rawValidation.surfaceIds) && rawValidation.surfaceIds.length === 0 ||
      Array.isArray(rawValidation.channelIds) && rawValidation.channelIds.length === 0)) {
    blockers.add("SCOPE_MISMATCH");
  }
  const validationResult = browserValidationSchema.safeParse(input.independentValidation);
  const validation = validationResult.success ? validationResult.data : undefined;
  if (!validation) blockers.add("INDEPENDENT_VALIDATION_INVALID");
  if (validation && (validation.sourceConfigSha256 !== input.binding.sourceConfigSha256 ||
      canonicalJson(validation.surfaceIds) !== canonicalJson(expectedSurfaces) ||
      canonicalJson(validation.channelIds) !== canonicalJson(expectedChannels))) {
    blockers.add("SCOPE_MISMATCH");
  }
  if (validation && validation.canonicalJobIdSetSha256 !== canonicalStringSetSha256(outputIds)) {
    blockers.add("INDEPENDENT_JOB_SET_MISMATCH");
  }
  const requirement = evaluateBGradeValidationRequirement({
    trigger: input.trigger,
    validationExecution: input.validationExecution,
    validation: input.independentValidation,
    now: input.now
  });
  if (!requirement.acceptable) {
    blockers.add(requirement.reason === "VALIDATION_EXPIRED" ? "VALIDATION_EXPIRED" : "VALIDATION_REFRESH_REQUIRED");
  }
  if (blockers.size > 0 || !evidence || !pagination || !ledger || !validation) {
    return { status: "REJECTED", resultingGrade: "C", blockerCodes: [...blockers].sort() };
  }

  const certificate = certificateSchema.parse({
    schemaVersion: B_GRADE_TRAVERSAL_CERTIFICATE_SCHEMA_VERSION,
    grade: "B",
    binding: { ...input.binding, sourceId: input.plan.source.id },
    scope: {
      companyId: input.plan.company.id,
      sourceId: input.plan.source.id,
      recruitmentType: input.plan.source.kind,
      geography: "MAINLAND_CHINA",
      businessUnit: "ALL",
      surfaceIds: expectedSurfaces,
      channelIds: expectedChannels
    },
    mainTraversal: {
      retrievalPath: "HTTP_TUPU360_ENTRY_PLUS_POST",
      pageCount: evidence.pages.length,
      terminalEvent: evidence.pages.at(-1)!.termination,
      paginationTraceSha256: canonicalPageTraceSha256(evidence.pages),
      canonicalJobIdSetSha256: canonicalStringSetSha256(outputIds)
    },
    independentValidation: validation,
    validationPolicy: { trigger: input.trigger, execution: input.validationExecution },
    counts: {
      mainUniqueJobCount: outputIds.length,
      independentUniqueJobCount: canonicalStrings(validation.pages.flatMap((page) => page.sourceJobIds)).length,
      finalUniqueJobCount: input.jobs.length,
      parseDiscardCount: 0,
      validationDiscardCount: 0,
      normalizationDiscardCount: 0,
      dedupeDiscardCount: 0
    },
    output: {
      canonicalJobSetSha256: ledger.outputJobKeySetSha256,
      adapterReconciliationSha256: ledger.ledgerSha256,
      collisionLedgerSha256: sha256(canonicalJson(ledger.collisionGroups))
    },
    issuedAt: input.now.toISOString()
  });
  return { status: "CERTIFIED", certificate, certificateSha256: sha256(canonicalJson(certificate)) };
}

export function verifyBGradeTraversalCertificateReceipt(input: {
  certificate: unknown;
  certificateSha256: string;
  expected: BGradeCertificateReceiptExpectation;
  now: Date;
}): { status: "PASS"; grade: "B"; sourceId: string; companyId: string; certificateSha256: string; finalUniqueJobCount: number } {
  const certificate = certificateSchema.parse(input.certificate);
  if (sha256(canonicalJson(certificate)) !== input.certificateSha256) {
    throw new Error("B-grade traversal certificate hash mismatch");
  }
  if (!validDate(input.now) || Date.parse(certificate.issuedAt) > input.now.getTime()) {
    throw new Error("B-grade traversal certificate issuance time is invalid");
  }
  const expected = input.expected;
  if (certificate.binding.releaseCandidateId !== expected.releaseCandidateId ||
      certificate.binding.batchId !== expected.batchId || certificate.binding.sourceResultId !== expected.sourceResultId ||
      certificate.binding.sourceId !== expected.sourceId || certificate.binding.sourceConfigSha256 !== expected.sourceConfigSha256 ||
      certificate.scope.sourceId !== expected.sourceId ||
      (expected.companyId !== undefined && certificate.scope.companyId !== expected.companyId)) {
    throw new Error("B-grade traversal certificate Receipt binding mismatch");
  }
  if ((expected.surfaceIds && canonicalJson(certificate.scope.surfaceIds) !== canonicalJson(canonicalStrings(expected.surfaceIds))) ||
      (expected.channelIds && canonicalJson(certificate.scope.channelIds) !== canonicalJson(canonicalStrings(expected.channelIds)))) {
    throw new Error("B-grade traversal certificate scope mismatch");
  }
  if ((expected.canonicalJobSetSha256 && certificate.output.canonicalJobSetSha256 !== expected.canonicalJobSetSha256) ||
      (expected.adapterReconciliationSha256 && certificate.output.adapterReconciliationSha256 !== expected.adapterReconciliationSha256) ||
      (expected.collisionLedgerSha256 && certificate.output.collisionLedgerSha256 !== expected.collisionLedgerSha256)) {
    throw new Error("B-grade traversal certificate reconciliation commitment mismatch");
  }
  const requirement = evaluateBGradeValidationRequirement({
    trigger: "STABLE_RUN",
    validationExecution: "REUSED",
    validation: certificate.independentValidation,
    now: input.now
  });
  if (!requirement.acceptable) throw new Error(`B-grade traversal certificate validation unavailable: ${requirement.reason}`);
  const issuedAtMs = Date.parse(certificate.issuedAt);
  const observedAtMs = Date.parse(certificate.independentValidation.observedAt);
  if (observedAtMs > issuedAtMs ||
      certificate.validationPolicy.execution === "CURRENT_RUN" &&
        issuedAtMs - observedAtMs > B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS ||
      certificate.validationPolicy.trigger !== "STABLE_RUN" && certificate.validationPolicy.execution !== "CURRENT_RUN") {
    throw new Error("B-grade traversal certificate validation was not current at issuance");
  }
  if (certificate.mainTraversal.canonicalJobIdSetSha256 !== certificate.independentValidation.canonicalJobIdSetSha256 ||
      certificate.counts.mainUniqueJobCount !== certificate.counts.independentUniqueJobCount ||
      certificate.counts.mainUniqueJobCount !== certificate.counts.finalUniqueJobCount) {
    throw new Error("B-grade traversal certificate equations do not reconcile");
  }
  return {
    status: "PASS",
    grade: "B",
    sourceId: certificate.scope.sourceId,
    companyId: certificate.scope.companyId,
    certificateSha256: input.certificateSha256,
    finalUniqueJobCount: certificate.counts.finalUniqueJobCount
  };
}

function exactViatrisScope(plan: SourceCrawlPlan): boolean {
  return plan.company.id === "company-viatris" && plan.source.id === "source-viatris-social" &&
    plan.source.kind === "SOCIAL" && plan.source.surfaceId === "surface-viatris-social" &&
    plan.adapterId === "html-table" && plan.table.completenessProof?.kind === "CONFIGURED_CHANNEL_TRAVERSAL" &&
    plan.table.pagination?.ajaxMode === "tupu360";
}

function assertViatrisBrowserValidationEquations(validation: ViatrisBrowserTraversalValidation): void {
  if (canonicalJson(validation.surfaceIds) !== canonicalJson(canonicalStrings(validation.surfaceIds)) ||
      canonicalJson(validation.channelIds) !== canonicalJson(canonicalStrings(validation.channelIds)) ||
      validation.pageCount !== validation.pages.length) {
    throw new Error("Viatris browser validation canonical scope or page count mismatch");
  }
  const ids: string[] = [];
  for (let index = 0; index < validation.pages.length; index += 1) {
    const page = validation.pages[index]!;
    if (page.pageNumber !== index + 1 || page.declaredTotalPages !== validation.pages.length ||
        page.nextControlPresent !== (index < validation.pages.length - 1) ||
        canonicalJson(page.sourceJobIds) !== canonicalJson(canonicalStrings(page.sourceJobIds))) {
      throw new Error("Viatris browser validation page traversal mismatch");
    }
    ids.push(...page.sourceJobIds);
  }
  if (new Set(ids).size !== ids.length || validation.canonicalJobIdSetSha256 !== canonicalStringSetSha256(ids)) {
    throw new Error("Viatris browser validation job set mismatch");
  }
  const expectedArtifactSha256 = sha256(canonicalJson({
    sourceId: validation.sourceId,
    retrievalPath: validation.retrievalPath,
    pages: validation.pages,
    observedAt: validation.observedAt
  }));
  if (validation.artifactSha256 !== expectedArtifactSha256) {
    throw new Error("Viatris browser validation artifact hash mismatch");
  }
}

function canonicalStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}
