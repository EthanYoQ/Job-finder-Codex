import {
  canonicalStringSetSha256,
  parsePersistentSourceFetchEvidence,
  sha256Bytes,
  type PersistentSourceFetchEvidence,
  type SourceFetchPageTrace
} from "./sourceFetchEvidence";

const ANOMALY_CODES = [
  "REPEATED_RESPONSE_FINGERPRINT",
  "REPEATED_JOB_ID_SET_WITH_NEXT",
  "CURSOR_NOT_ADVANCING",
  "OFFSET_NOT_ADVANCING",
  "INTERMEDIATE_EMPTY_PAGE",
  "TOTAL_CHANGED",
  "MAX_PAGES_WITH_NEXT",
  "EXPECTED_CHANNEL_NOT_VISITED",
  "RETURNED_PAGE_MISMATCH",
  "DECLARED_CAPACITY_CONTRADICTION",
  "RAW_ID_OVERLAP_ACROSS_PAGES",
  "INTERMEDIATE_SHORT_PAGE",
  "RETURNED_PAGE_SIZE_MISMATCH"
] as const;

export type DerivedPaginationAnomalyCode = typeof ANOMALY_CODES[number];

export interface RepositoryPaginationDraft {
  artifactLogicalKey: string;
  sequence: number;
  channelId?: string | null;
  requestedCursor?: string | null;
  returnedCursor?: string | null;
  requestedOffset?: number | null;
  returnedOffset?: number | null;
  requestedPage?: number | null;
  returnedPage?: number | null;
  requestedPageSize?: number | null;
  returnedPageSize?: number | null;
  responseFingerprintSha256: string;
  rawJobIdSetSha256: string;
  validJobIdSetSha256: string;
  declaredTotal?: number | null;
  declaredCount?: number | null;
  declaredPages?: number | null;
  nextPageSignalBefore?: string | null;
  nextPageSignalAfter?: string | null;
  termination: SourceFetchPageTrace["termination"];
  anomalyCodes: DerivedPaginationAnomalyCode[];
  capturedAt: Date;
}

export interface PaginationEvaluation {
  pages: RepositoryPaginationDraft[];
  paginationTraceSha256: string;
  derivedAnomalyCodes: DerivedPaginationAnomalyCode[];
  visitedChannelIds: string[];
  safeCompleteness: boolean;
  verifiedEligible: boolean;
}

interface PaginationEvidenceInput {
  evidence: unknown;
  expectedChannelIds: readonly string[];
  filteredOutput: boolean;
  allowMissingReturnedPage?: boolean;
  allowLaterZeroDeclaredTotalAfterExactReconciliation?: boolean;
  allowPositiveOfficialTotalCountAfterAdapterReconciliation?: boolean;
  allowRawIdOverlapAcrossPages?: boolean;
}

export function deriveCanonicalPaginationEvidence(
  input: PaginationEvidenceInput
): PersistentSourceFetchEvidence {
  const evidence = parsePersistentSourceFetchEvidence(input.evidence);
  const evaluation = evaluatePaginationEvidenceInternal(input, false);
  return parsePersistentSourceFetchEvidence({
    ...evidence,
    pages: evidence.pages.map((page, index) => ({
      ...page,
      anomalyCodes: evaluation.pages[index]!.anomalyCodes
    }))
  });
}

export function evaluatePaginationEvidence(input: PaginationEvidenceInput): PaginationEvaluation {
  return evaluatePaginationEvidenceInternal(input, true);
}

function evaluatePaginationEvidenceInternal(
  input: PaginationEvidenceInput,
  enforceCallerLabels: boolean
): PaginationEvaluation {
  const evidence = parsePersistentSourceFetchEvidence(input.evidence);
  if (evidence.supportingArtifactOnlyFailure) {
    throw new Error("supporting-artifact-only failure evidence cannot enter D1 pagination evaluation");
  }
  const expectedChannelIds = canonicalIdentifiers(input.expectedChannelIds, "expected channel");
  const artifacts = new Map(evidence.artifacts.map((artifact) => [artifact.logicalKey, artifact]));
  const anomalies = evidence.pages.map(() => new Set<DerivedPaginationAnomalyCode>());
  const globalAnomalies = new Set<DerivedPaginationAnomalyCode>();
  const fingerprintsByScope = new Map<string, Set<string>>();
  const rawHashesByScope = new Map<string, Set<string>>();
  const validHashesByScope = new Map<string, Set<string>>();
  const rawIdsByScope = new Map<string, Set<string>>();
  const rawObservationCountByScope = new Map<string, number>();
  const pageOrdinalByScope = new Map<string, number>();
  const previousByScope = new Map<string, SourceFetchPageTrace>();
  const declaredByScope = new Map<string, { total: number | null; count: number | null; pages: number | null }>();
  const reconciledZeroDeclarations = input.allowLaterZeroDeclaredTotalAfterExactReconciliation
    ? exactReconciledLaterZeroDeclarations(evidence)
    : new Map<string, { total: number; count: number | null; pages: number | null }>();
  const visited = new Set<string>();

  const derived = evidence.pages.map((page, index) => {
    const artifact = artifacts.get(page.artifactLogicalKey)!;
    const bytes = typeof artifact.body === "string" ? Buffer.from(artifact.body, "utf8") : Buffer.from(artifact.body);
    const responseFingerprintSha256 = sha256Bytes(bytes).sha256;
    if (page.responseFingerprintSha256 !== responseFingerprintSha256) {
      throw new Error(`page ${index} response fingerprint does not match exact referenced artifact body`);
    }
    const rawJobIdSetSha256 = canonicalStringSetSha256(page.rawJobIds);
    const validJobIdSetSha256 = canonicalStringSetSha256(page.validJobIds);
    const hasNext = page.nextPageSignalAfter !== null && page.nextPageSignalAfter !== undefined;
    const scope = page.channelId ?? "__SOURCE__";
    const reconciledZeroDeclaration = reconciledZeroDeclarations.get(scope);
    const effectiveDeclaredTotal = reconciledZeroDeclaration && page.declaredTotal === 0
      ? reconciledZeroDeclaration.total
      : page.declaredTotal;
    const effectiveDeclaredPages = reconciledZeroDeclaration && page.declaredTotal === 0
      ? reconciledZeroDeclaration.pages
      : page.declaredPages;
    const pageOrdinal = (pageOrdinalByScope.get(scope) ?? 0) + 1;
    pageOrdinalByScope.set(scope, pageOrdinal);

    if (
      present(page.requestedOffset) && present(page.returnedOffset) &&
      page.requestedOffset !== page.returnedOffset
    ) {
      anomalies[index]!.add("OFFSET_NOT_ADVANCING");
    }
    const fingerprints = scopedSet(fingerprintsByScope, scope);
    const rawHashes = scopedSet(rawHashesByScope, scope);
    const validHashes = scopedSet(validHashesByScope, scope);
    const observedRawIds = scopedSet(rawIdsByScope, scope);

    if (fingerprints.has(responseFingerprintSha256)) {
      anomalies[index]!.add("REPEATED_RESPONSE_FINGERPRINT");
    }
    if (rawHashes.has(rawJobIdSetSha256) || validHashes.has(validJobIdSetSha256)) {
      anomalies[index]!.add("REPEATED_JOB_ID_SET_WITH_NEXT");
    }
    fingerprints.add(responseFingerprintSha256);
    rawHashes.add(rawJobIdSetSha256);
    validHashes.add(validJobIdSetSha256);
    if (!input.allowRawIdOverlapAcrossPages &&
      page.rawJobIds.some((rawJobId) => observedRawIds.has(rawJobId))) {
      anomalies[index]!.add("RAW_ID_OVERLAP_ACROSS_PAGES");
    }
    for (const rawJobId of page.rawJobIds) observedRawIds.add(rawJobId);
    const rowLossRecordCount = new Set(evidence.fetchLosses.flatMap((loss) =>
      loss.details.pageSequence === page.sequence && Number.isSafeInteger(loss.details.recordIndex) &&
      loss.details.recordIndex !== undefined && loss.details.recordIndex >= 0
        ? [loss.details.recordIndex]
        : [])).size;
    const observedPageRawCount = Math.max(page.rawJobIds.length, page.validJobIds.length + rowLossRecordCount);
    const cumulativeRawObservationCount = (rawObservationCountByScope.get(scope) ?? 0) + observedPageRawCount;
    rawObservationCountByScope.set(scope, cumulativeRawObservationCount);
    if (present(effectiveDeclaredTotal) && observedRawIds.size > effectiveDeclaredTotal) {
      anomalies[index]!.add("DECLARED_CAPACITY_CONTRADICTION");
    }
    if (present(page.requestedPageSize) && present(page.returnedPageSize) &&
      page.requestedPageSize !== page.returnedPageSize) {
      anomalies[index]!.add("RETURNED_PAGE_SIZE_MISMATCH");
    }
    const provenCapacity = page.returnedPageSize ?? page.requestedPageSize;
    const declaredRemainder = present(effectiveDeclaredTotal) && cumulativeRawObservationCount < effectiveDeclaredTotal;
    const declaredLaterPage = present(effectiveDeclaredPages) && pageOrdinal < effectiveDeclaredPages;
    if (observedPageRawCount > 0 && present(provenCapacity) && observedPageRawCount < provenCapacity &&
      (hasNext || declaredRemainder || declaredLaterPage)) {
      anomalies[index]!.add("INTERMEDIATE_SHORT_PAGE");
    }

    const previous = previousByScope.get(scope);
    if (previous) {
      const cursorActive = present(previous.requestedCursor) || present(previous.returnedCursor);
      if (cursorActive && (
        !present(page.requestedCursor) ||
        !present(previous.returnedCursor) ||
        (present(previous.returnedCursor) && previous.returnedCursor !== page.requestedCursor)
      )) anomalies[index]!.add("CURSOR_NOT_ADVANCING");
      if ((previous.nextPageSignalAfter ?? null) !== (page.nextPageSignalBefore ?? null)) {
        anomalies[index]!.add("CURSOR_NOT_ADVANCING");
      }
      const offsetActive = present(previous.requestedOffset) || present(previous.returnedOffset);
      const previousOffset = previous.returnedOffset ?? previous.requestedOffset;
      if (offsetActive && (
        !present(page.requestedOffset) ||
        (present(previousOffset) && present(page.requestedOffset) && page.requestedOffset <= previousOffset)
      )) anomalies[index]!.add("OFFSET_NOT_ADVANCING");
      const pageNumberActive = present(previous.requestedPage) || present(previous.returnedPage);
      if (pageNumberActive && (!present(page.requestedPage) ||
          (!input.allowMissingReturnedPage && !present(page.returnedPage)))) {
        anomalies[index]!.add("RETURNED_PAGE_MISMATCH");
      }
    }
    if (
      (!input.allowMissingReturnedPage &&
        present(page.requestedPage) !== present(page.returnedPage)) ||
      (input.allowMissingReturnedPage &&
        !present(page.requestedPage) && present(page.returnedPage)) ||
      (page.requestedPage !== null && page.requestedPage !== undefined &&
        page.returnedPage !== null && page.returnedPage !== undefined &&
        page.requestedPage !== page.returnedPage) ||
      (previous?.returnedPage !== null && previous?.returnedPage !== undefined &&
        page.returnedPage !== null && page.returnedPage !== undefined &&
        page.returnedPage <= previous.returnedPage) ||
      (previous?.requestedPage !== null && previous?.requestedPage !== undefined &&
        page.requestedPage !== null && page.requestedPage !== undefined &&
        page.requestedPage <= previous.requestedPage)
    ) {
      anomalies[index]!.add("RETURNED_PAGE_MISMATCH");
    }
    previousByScope.set(scope, page);
    if (page.rawJobIds.length === 0 && page.validJobIds.length === 0 && (previous !== undefined || hasNext)) {
      anomalies[index]!.add("INTERMEDIATE_EMPTY_PAGE");
    }
    if (page.termination === "MAX_PAGE_LIMIT" && hasNext) {
      anomalies[index]!.add("MAX_PAGES_WITH_NEXT");
    }

    if (page.channelId) visited.add(page.channelId);
    const declaration = {
      total: effectiveDeclaredTotal ?? null,
      count: page.declaredCount ?? null,
      pages: effectiveDeclaredPages ?? null
    };
    const baseline = declaredByScope.get(scope);
    if (baseline && declarationChanged(baseline, declaration)) anomalies[index]!.add("TOTAL_CHANGED");
    else if (!baseline) declaredByScope.set(scope, declaration);

    return {
      artifactLogicalKey: page.artifactLogicalKey,
      sequence: page.sequence,
      channelId: page.channelId ?? null,
      requestedCursor: page.requestedCursor ?? null,
      returnedCursor: page.returnedCursor ?? null,
      requestedOffset: page.requestedOffset ?? null,
      returnedOffset: page.returnedOffset ?? null,
      requestedPage: page.requestedPage ?? null,
      returnedPage: page.returnedPage ?? null,
      requestedPageSize: page.requestedPageSize ?? null,
      returnedPageSize: page.returnedPageSize ?? null,
      responseFingerprintSha256,
      rawJobIdSetSha256,
      validJobIdSetSha256,
      declaredTotal: page.declaredTotal ?? null,
      declaredCount: page.declaredCount ?? null,
      declaredPages: page.declaredPages ?? null,
      nextPageSignalBefore: page.nextPageSignalBefore ?? null,
      nextPageSignalAfter: page.nextPageSignalAfter ?? null,
      termination: page.termination,
      anomalyCodes: [] as DerivedPaginationAnomalyCode[],
      capturedAt: new Date(page.capturedAt)
    };
  });

  const missingChannels = expectedChannelIds.filter((channelId) => !visited.has(channelId));
  const unexpectedChannels = [...visited].filter((channelId) =>
    !expectedChannelIds.includes(channelId));
  if (unexpectedChannels.length > 0) {
    throw new Error(`unexpected visited channel: ${unexpectedChannels.sort(compareUtf8).join(",")}`);
  }
  if (missingChannels.length > 0) globalAnomalies.add("EXPECTED_CHANNEL_NOT_VISITED");

  validateTerminalEvents(evidence);
  for (let index = 0; index < evidence.pages.length; index += 1) {
    const canonical = sortAnomalies(anomalies[index]!);
    if (enforceCallerLabels && new Set(evidence.pages[index]!.anomalyCodes).size !== evidence.pages[index]!.anomalyCodes.length) {
      throw new Error(`page ${index} caller anomaly labels do not exactly match canonical evaluator result`);
    }
    const caller = sortAnomalies(new Set(evidence.pages[index]!.anomalyCodes));
    if (enforceCallerLabels && JSON.stringify(caller) !== JSON.stringify(canonical)) {
      throw new Error(`page ${index} caller anomaly labels do not exactly match canonical evaluator result`);
    }
    derived[index]!.anomalyCodes = canonical;
  }

  const derivedAnomalyCodes = sortAnomalies(new Set([
    ...derived.flatMap((page) => page.anomalyCodes),
    ...globalAnomalies
  ]));
  const safeCompleteness = derivedAnomalyCodes.length === 0 && safeTerminationsByScope(evidence);
  const declared = evidence.declaredCompleteness;
  const globalCannotCertifyFiltered = input.filteredOutput && declared?.scope === "GLOBAL_UNFILTERED";
  const declaredPageCountMatches = declarationCoversActualPages(
    evidence,
    expectedChannelIds,
    input.allowPositiveOfficialTotalCountAfterAdapterReconciliation === true
  );
  const verifiedEligible = safeCompleteness && declared !== undefined &&
    !globalCannotCertifyFiltered && declaredPageCountMatches;

  return {
    pages: derived,
    paginationTraceSha256: sha256Bytes(Buffer.from(JSON.stringify(derived.map(traceRecord)), "utf8")).sha256,
    derivedAnomalyCodes,
    visitedChannelIds: canonicalIdentifiers([...visited], "visited channel"),
    safeCompleteness,
    verifiedEligible
  };
}

function exactReconciledLaterZeroDeclarations(
  evidence: PersistentSourceFetchEvidence
): Map<string, { total: number; count: number | null; pages: number | null }> {
  const pagesByScope = new Map<string, SourceFetchPageTrace[]>();
  for (const page of evidence.pages) {
    const scope = page.channelId ?? "__SOURCE__";
    const pages = pagesByScope.get(scope) ?? [];
    pages.push(page);
    pagesByScope.set(scope, pages);
  }

  // Fetch counts are source-wide. Refuse to infer a per-channel reconciliation.
  if (pagesByScope.size !== 1) return new Map();
  const [scope, pages] = [...pagesByScope.entries()][0]!;
  if (pages.length < 2) return new Map();
  const first = pages[0]!;
  const officialTotal = first.declaredTotal;
  if (!present(officialTotal) || officialTotal <= 0) return new Map();
  if (!pages.slice(1).some((page) => page.declaredTotal === 0)) return new Map();
  if (pages.slice(1).some((page) =>
    page.rawJobIds.length === 0 || page.validJobIds.length === 0 ||
    (page.declaredTotal !== officialTotal && page.declaredTotal !== 0))) return new Map();

  const uniqueRawIds = new Set(pages.flatMap((page) => page.rawJobIds));
  const uniqueValidIds = new Set(pages.flatMap((page) => page.validJobIds));
  const declared = evidence.declaredCompleteness;
  const counts = evidence.fetchCounts;
  const losslessExactReconciliation = uniqueRawIds.size === officialTotal &&
    uniqueValidIds.size === officialTotal &&
    counts.rawCount === officialTotal && counts.parsedCount === officialTotal && counts.validCount === officialTotal &&
    counts.parseDiscardCount === 0 && counts.validationDiscardCount === 0 && evidence.fetchLosses.length === 0 &&
    declared?.kind === "OFFICIAL_TOTAL_COUNT" && declared.scope === "SOURCE" &&
    declared.value === officialTotal && declared.artifactLogicalKey === first.artifactLogicalKey;
  if (!losslessExactReconciliation) return new Map();

  return new Map([[scope, {
    total: officialTotal,
    count: first.declaredCount ?? null,
    pages: first.declaredPages ?? null
  }]]);
}

function validateTerminalEvents(evidence: PersistentSourceFetchEvidence): void {
  const pagesByScope = new Map<string, Array<{ page: SourceFetchPageTrace; index: number }>>();
  for (let index = 0; index < evidence.pages.length; index += 1) {
    const scope = evidence.pages[index]!.channelId ?? "__SOURCE__";
    const pages = pagesByScope.get(scope) ?? [];
    pages.push({ page: evidence.pages[index]!, index });
    pagesByScope.set(scope, pages);
  }
  for (const scopedPages of pagesByScope.values()) {
    for (let offset = 0; offset < scopedPages.length - 1; offset += 1) {
      const page = scopedPages[offset]!.page;
      const hasNext = page.nextPageSignalAfter !== null && page.nextPageSignalAfter !== undefined;
      if (page.termination !== "CONTINUE" || !hasNext) {
        throw new Error("non-final pagination page must use CONTINUE with a next-page signal");
      }
    }
    const { page, index } = scopedPages[scopedPages.length - 1]!;
    const hasNext = page.nextPageSignalAfter !== null && page.nextPageSignalAfter !== undefined;
    const comparable = scopedPages.map((candidate) => candidate.page);
    if (page.termination === "CONTINUE") {
      throw new Error("final pagination page cannot use CONTINUE termination");
    }
    if (comparable.length === 1 && page.rawJobIds.length === 0 && page.validJobIds.length === 0) {
      const officialZero = page.termination === "EMPTY_PAGE" && !hasNext && page.declaredTotal === 0 &&
        evidence.declaredCompleteness?.kind === "OFFICIAL_TOTAL_COUNT" &&
        evidence.declaredCompleteness.value === 0;
      const nonCertifyingFailure = page.termination === "ABORTED" || page.termination === "FAILED";
      if (!officialZero && !nonCertifyingFailure) {
        throw new Error("empty first page requires explicit official zero EMPTY_PAGE evidence or a non-certifying terminal");
      }
    }
    if (page.termination === "NEXT_ABSENT" && hasNext) {
      throw new Error("NEXT_ABSENT termination is inconsistent with a remaining next-page signal");
    }
    if (page.termination === "DECLARED_TOTAL_REACHED") {
      const observed = new Set(comparable.flatMap((candidate) => candidate.validJobIds)).size;
      if (page.declaredTotal === null || page.declaredTotal === undefined || page.declaredTotal !== observed) {
        throw new Error("DECLARED_TOTAL_REACHED termination is inconsistent with page valid-ID count");
      }
      if (hasNext) throw new Error("DECLARED_TOTAL_REACHED termination is inconsistent with a remaining next-page signal");
    }
    if (page.termination === "EMPTY_PAGE") {
      const explicitZero = comparable.length === 1 && page.declaredTotal === 0 &&
        page.rawJobIds.length === 0 && page.validJobIds.length === 0 && !hasNext;
      if (!explicitZero) throw new Error("EMPTY_PAGE is safe only for an explicit official zero first page");
    }
  }
}

function safeTerminationsByScope(evidence: PersistentSourceFetchEvidence): boolean {
  const lastByScope = new Map<string, SourceFetchPageTrace>();
  for (const page of evidence.pages) lastByScope.set(page.channelId ?? "__SOURCE__", page);
  return [...lastByScope.values()].every((page) =>
    page.termination === "NEXT_ABSENT" || page.termination === "DECLARED_TOTAL_REACHED" ||
    (page.termination === "EMPTY_PAGE" && page.declaredTotal === 0));
}

function declarationCoversActualPages(
  evidence: PersistentSourceFetchEvidence,
  expectedChannelIds: readonly string[],
  allowPositiveOfficialTotalCountAfterAdapterReconciliation: boolean
): boolean {
  const declared = evidence.declaredCompleteness;
  if (!declared) return false;
  if (declared.kind === "OFFICIAL_TOTAL_COUNT") {
    if (declared.value === 0) return evidence.fetchCounts.validCount === 0;
    if (!allowPositiveOfficialTotalCountAfterAdapterReconciliation) return false;
    // This opt-in only exposes a lossless positive declaration to a later,
    // independent adapter reconciliation gate. It does not certify the fetch.
    return declared.value === evidence.fetchCounts.rawCount &&
      declared.value === evidence.fetchCounts.parsedCount &&
      declared.value === evidence.fetchCounts.validCount &&
      evidence.fetchCounts.parseDiscardCount === 0 && evidence.fetchCounts.validationDiscardCount === 0 &&
      evidence.fetchLosses.length === 0;
  }
  let actualPages: number;
  if (declared.scope === "CHANNEL") {
    if (expectedChannelIds.length !== 1 || expectedChannelIds[0] !== declared.channelId) return false;
    actualPages = evidence.pages.filter((page) => page.channelId === declared.channelId).length;
  } else {
    actualPages = evidence.pages.length;
  }
  if (declared.value !== actualPages) return false;
  if (declared.kind === "OFFICIAL_TOTAL_PAGES") {
    const declaredPage = evidence.pages.find((page) =>
      page.artifactLogicalKey === declared.artifactLogicalKey);
    return declaredPage?.declaredPages === declared.value;
  }
  return true;
}

function present<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function declarationChanged(
  baseline: { total: number | null; count: number | null; pages: number | null },
  current: { total: number | null; count: number | null; pages: number | null }
): boolean {
  return (["total", "count", "pages"] as const).some((field) => baseline[field] !== current[field]);
}

function scopedSet(map: Map<string, Set<string>>, scope: string): Set<string> {
  let values = map.get(scope);
  if (!values) {
    values = new Set<string>();
    map.set(scope, values);
  }
  return values;
}

function canonicalIdentifiers(values: readonly string[], label: string): string[] {
  if (!Array.isArray(values)) throw new Error(`${label} IDs must be an array`);
  for (const value of values) if (typeof value !== "string" || value.trim() !== value || !value) {
    throw new Error(`${label} ID must be nonblank and canonical`);
  }
  if (new Set(values).size !== values.length) throw new Error(`${label} IDs contain duplicates`);
  return [...values].sort(compareUtf8);
}

function sortAnomalies(values: Set<string>): DerivedPaginationAnomalyCode[] {
  const result = [...values];
  for (const value of result) if (!(ANOMALY_CODES as readonly string[]).includes(value)) {
    throw new Error(`unknown pagination anomaly code ${value}`);
  }
  return result.sort(compareUtf8) as DerivedPaginationAnomalyCode[];
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function traceRecord(page: RepositoryPaginationDraft): Record<string, unknown> {
  return { ...page, capturedAt: page.capturedAt.toISOString() };
}
