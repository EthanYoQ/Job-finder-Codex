import { SANOFI_HISTORICAL_PUBLIC_RECEIPT } from "../crawler/sanofiHistoricalPublicReceipt";
import {readNovoSingleClosures} from "./novoSingleClosureRepository";
import {NOVO_CLOSURE_SOURCE,NOVO_CLOSURE_COMPANY,novoSingleClosureRemoves} from "../domain/novoSingleJobClosure";
import { isJobProjectionDeltaReceipt, parseJobProjectionDeltaReceipt } from "../domain/jobProjectionDeltaReceipt";
import { portableSnapshotIdentities } from "./portableDisplayIdentity";
import { SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION, sanofiCertificateArtifactLocators, type SanofiArtifactCommitment } from "../crawler/traversalCertificate";
import { isSanofiPublicTransitionPlan, isSanofiHistoricalPublicCandidate } from "../domain/sanofiPublicTransition";
import type { PublicSnapshotRefresh } from "../domain/publicSnapshotRefresh";
import type { Prisma } from "@prisma/client";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256, type SourceCrawlPlan } from "../crawler/sourcePlan";
import { candidateCompanies } from "../data/companyRegistry";
import { getPortableCoverageScope, PORTABLE_COVERAGE_POLICY_ID } from "../release/portableCoveragePolicy";
import { P0_LAUNCH_MANIFEST, selectLaunchCompanies, validateLaunchManifest } from "../release/launchManifest";
import { portableCommittedConfigHashes, supportsPublicBGrade, compactCommittedCertificate, verifiedMembers, selectPortableSourceSnapshots, projectPortableSourceJobs, type PortableProjectedSource, type PortablePublicJob, type PortableSnapshotOptions } from "../domain/portablePublicSnapshot";
import { SOURCE_QUALITY_POLICY_ID } from "../crawler/sourceQualityAdmission";
import { DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS } from "../domain/publicationEligibility";
import { PortableSnapshotCache, PORTABLE_SNAPSHOT_VERSION_SQL, portableSnapshotVersion, portableSnapshotValidUntil } from "./portableSnapshotCache";

export const portableSourceResultSelect = {
  id: true, releaseCandidateId: true, batchId: true, sourceId: true, sourceConfigHash: true, adapterVersion: true,
  transportState: true, adapterState: true, completenessState: true, atomicCommitState: true,
  failureCategory: true, failureDiagnosticCode: true, fetchAttemptCount: true, retryCount: true, retryReasonCodes: true,
  failureCode: true, failureReason: true, blockerCode: true, blockerReason: true, startedAt: true, finishedAt: true,
  rawCount: true, parsedCount: true, validCount: true, normalizedCount: true, dedupeInputCount: true, dedupeOutputCount: true,
  parseDiscardCount: true, validationDiscardCount: true, normalizationDiscardCount: true, dedupeDiscardCount: true, collisionCount: true, discardCount: true,
  adapterInputCount: true, adapterOutputCount: true, adapterLossCount: true, adapterCollisionGroupCount: true,
  expectedSurfaceSha256: true, visitedSurfaceSha256: true, expectedChannelSha256: true, visitedChannelSha256: true,
  expectedJobCount: true, expectedEvidenceKind: true, officialSurfaceIds: true, officialChannelIds: true,
  canonicalCurrentJobSetSha256: true, canonicalGraceJobSetSha256: true, canonicalVisibleJobSetSha256: true, canonicalOutputSetSha256: true,
  adapterReconciliationSha256: true, collisionLedgerSha256: true, completenessCertificate: true, completenessCertificateSha256: true,
  observations: {select: {sourceId: true, batchId: true, releaseCandidateId: true, sourceResultId: true,
    sourceConfigSha256: true, adapterVersion: true, observedFrom: true, observedTo: true, crawledAt: true,
    successful: true, transportSucceeded: true, adapterSucceeded: true, completenessVerified: true, atomicCommitSucceeded: true,
    canonicalRawSha256: true, canonicalOutputSha256: true, paginationTraceSha256: true}},
  _count: {select: {transportAttempts: true, evidenceArtifacts: true, observations: true, paginationEvidence: true, lossLedgerEntries: true, lifecycleSetMembers: true}},
  batch: {select: {id: true, releaseCandidateId: true, kind: true, status: true, commitSha: true, rosterSha256: true,
    sourcePlanSha256: true, sourceConfigSha256: true, adapterBundleSha256: true, startedAt: true, finishedAt: true}}
} as const satisfies Prisma.CrawlBatchSourceResultSelect;
export type PortableSourceResultRow = Prisma.CrawlBatchSourceResultGetPayload<{select: typeof portableSourceResultSelect}> & {sanofiArtifacts?: readonly SanofiArtifactCommitment[]};
/** Preserve the existing in-memory review interface while production transfers only compact JSON. */
export function compactCommittedSourceResult(row: PortableSourceResultRow): PortableSourceResultRow {
  const date = (value: Date | string | null) => value == null || value instanceof Date ? value : new Date(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : value + "Z");
  return {...row, startedAt: date(row.startedAt)!, finishedAt: date(row.finishedAt),
    completenessCertificate: compactCommittedCertificate(row.completenessCertificate) as PortableSourceResultRow["completenessCertificate"],
    batch: {...row.batch, startedAt: date(row.batch.startedAt)!, finishedAt: date(row.batch.finishedAt)},
    observations: row.observations.map(o => ({...o, observedFrom: date(o.observedFrom), observedTo: date(o.observedTo), crawledAt: date(o.crawledAt)!}))};
}

/** Read only immutable publication metadata. Historical members are unnecessary:
 * their complete CURRENT/GRACE/VISIBLE commitments already live on the parent. */
export function portableCommittedResultsSql(plans: readonly SourceCrawlPlan[]): string {
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  const configScope = (plan: SourceCrawlPlan) => portableCommittedConfigHashes(plan).map(hash => `r."sourceConfigHash"=${quote(hash)}`).join(" OR ");
  const scope = plans.map(plan => `(r."sourceId"=${quote(plan.source.id)}${isSanofiPublicTransitionPlan(plan) ? "" : ` AND (${configScope(plan)})`})`).join(" OR ") || "FALSE";
  const candidateScope = plans.map(plan => `(r."sourceId"=${quote(plan.source.id)} AND (${configScope(plan)}${isSanofiPublicTransitionPlan(plan) ? ` OR r.id=${quote(SANOFI_HISTORICAL_PUBLIC_RECEIPT.binding.sourceResultId)}` : ""}))`).join(" OR ") || "FALSE";
  const scalars = Object.entries(portableSourceResultSelect).filter(([key, value]) => value === true && key !== "completenessCertificate").map(([key]) => `r."${key}"`).join(",");
  const object = (alias: string, fields: object) => `jsonb_build_object(${Object.keys(fields).map(key => `${quote(key)},${alias}."${key}"`).join(",")})`;
  const legacy = `jsonb_build_object('schemaVersion',c.value->'schemaVersion','policyId',c.value->'policyId','observedAt',c.value->'observedAt',
    'observation',CASE WHEN c.value->'observation' IS NOT NULL THEN jsonb_build_object('crawledAt',c.value#>'{observation,crawledAt}') END,
    'counts',jsonb_build_object('finalUniqueJobCount',c.value#>'{counts,finalUniqueJobCount}','validationDiscardCount',c.value#>'{counts,validationDiscardCount}',
      'quarantinedJobCount',jsonb_array_length(COALESCE(c.value->'jobQuarantineLedger','[]'::jsonb))),
    'mainTraversal',CASE WHEN c.value->'mainTraversal' IS NOT NULL THEN jsonb_build_object('matchKeyKind',c.value#>'{mainTraversal,matchKeyKind}','canonicalMatchKeySetSha256',c.value#>'{mainTraversal,canonicalMatchKeySetSha256}') END)`;
  const relations = {transportAttempts:"TransportAttemptEvidence",evidenceArtifacts:"EvidenceArtifact",observations:"CrawlObservation",paginationEvidence:"PaginationEvidence",lossLedgerEntries:"LossLedgerEntry",lifecycleSetMembers:"LifecycleSetEvidenceMember"};
  return `WITH latest AS (SELECT DISTINCT ON (r."sourceId") r.id FROM public."CrawlBatchSourceResult" r JOIN public."CrawlBatch" b ON b.id=r."batchId"
    WHERE (${candidateScope}) AND b.kind='SCHEDULED' AND r."atomicCommitState"='COMMITTED' AND r."completenessState"='VERIFIED'
    ORDER BY r."sourceId",r."finishedAt" DESC,r.id DESC)
  SELECT ${scalars},
    CASE WHEN r."completenessCertificate" IS NULL THEN NULL WHEN r."completenessCertificate"->>'schemaVersion'='job-projection-delta-receipt-v1'
      THEN jsonb_build_object('schemaVersion',r."completenessCertificate"->'schemaVersion','binding',r."completenessCertificate"->'binding',
        'verifiedAt',r."completenessCertificate"->'verifiedAt','observedAt',r."completenessCertificate"->'observedAt',
        'members',CASE WHEN r.id IN (SELECT id FROM latest) THEN r."completenessCertificate"->'members' ELSE '[]'::jsonb END,'legacyCertificate',${legacy})
      ELSE ${legacy} END AS "completenessCertificate",
    ${object("b", portableSourceResultSelect.batch.select)} AS batch,
    (SELECT coalesce(jsonb_agg(${object("o", portableSourceResultSelect.observations.select)}),'[]'::jsonb) FROM public."CrawlObservation" o WHERE o."sourceResultId"=r.id) AS observations,
    CASE WHEN r."failureCode"='BATCH_ABORTED_BEFORE_SOURCE_TERMINAL' THEN jsonb_build_object(${Object.entries(relations).map(([key, table]) => `${quote(key)},(SELECT count(*) FROM public."${table}" e WHERE e."sourceResultId"=r.id)`).join(",")}) ELSE '{}'::jsonb END AS "_count"
  FROM public."CrawlBatchSourceResult" r JOIN public."CrawlBatch" b ON b.id=r."batchId"
  CROSS JOIN LATERAL (SELECT CASE WHEN r."completenessCertificate"->>'schemaVersion'='job-projection-delta-receipt-v1' THEN r."completenessCertificate"->'legacyCertificate' ELSE r."completenessCertificate" END AS value) c
  WHERE (${scope}) AND b.kind='SCHEDULED' ORDER BY r."startedAt",r.id`;
}

const lifecycleMemberSelect = {
  releaseCandidateId: true, batchId: true, sourceId: true, sourceResultId: true, setKind: true, jobKey: true,
  jobKeySha256: true, lifecycleStatus: true, missingCount: true
} as const satisfies Prisma.LifecycleSetEvidenceMemberSelect;
export type PortableLifecycleMemberRow = Prisma.LifecycleSetEvidenceMemberGetPayload<{select: typeof lifecycleMemberSelect}>;
const jobSelect = {
  id: true, companyId: true, sourceId: true, dedupeKey: true, sourceJobId: true, listUrl: true, officialTitle: true, auxiliaryChineseTitle: true, humanCorrectedTitle: true,
  officialUrl: true, officialPublishedAt: true, city: true, cities: true, locationRaw: true, category: true, humanCorrectedCategory: true,
  isNew: true, lastSeenAt: true, lifecycleStatus: true, visibleInFrontend: true, missingSuccessCount: true
} as const satisfies Prisma.JobSelect;
export type PortableJobRow = Prisma.JobGetPayload<{select: typeof jobSelect}>;
export interface PortableSnapshotTransactionDb {
  lossLedgerEntry?: {findMany(args: unknown): PromiseLike<unknown[]>};
  evidenceArtifact?: {findMany(args: Prisma.EvidenceArtifactFindManyArgs): PromiseLike<unknown[]>};
  $queryRawUnsafe?<T = unknown>(query: string): PromiseLike<T>;
  crawlBatchSourceResult: {findMany(args: Prisma.CrawlBatchSourceResultFindManyArgs): PromiseLike<unknown[]>};
  lifecycleSetEvidenceMember: {findMany(args: Prisma.LifecycleSetEvidenceMemberFindManyArgs): PromiseLike<unknown[]>};
  job: {findMany(args: Prisma.JobFindManyArgs): PromiseLike<unknown[]>};
}
export interface PortableSnapshotDb {
  $transaction<T>(operation: (transaction: PortableSnapshotTransactionDb) => Promise<T>, options: {isolationLevel: "RepeatableRead"; maxWait: number; timeout: number}): Promise<T>;
}
export interface PortablePublicCompany {
  id: string;
  companyName: string;
  pinyin: string;
  category: "FOREIGN_PHARMA" | "DOMESTIC_PHARMA";
  sourceIds: string[];
  publishingSourceIds: string[];
  /** Partial means at least one source is visible, while others remain unavailable. */
  coverage: "COMPLETE" | "PARTIAL" | "UNVERIFIED" | "EXCLUDED";
  health: "HEALTHY" | "DEGRADED" | "UNVERIFIED" | "NOT_APPLICABLE";
  required: boolean;
  exclusionReason: "USER_AUTHORIZED_EXCLUSION" | null;
  jobs: PortablePublicJob[];
}
export interface PortablePublicSnapshot {
  schemaVersion: "portable-public-snapshot-v1";
  policyId: typeof SOURCE_QUALITY_POLICY_ID;
  coveragePolicyId: typeof PORTABLE_COVERAGE_POLICY_ID;
  generatedAt: string;
  sources: PortableProjectedSource[];
  companies: PortablePublicCompany[];
  /** Number actually listed; not a claim of complete roster/source coverage. */
  totalJobs: number;
  lastUpdatedAt: string | null;
  coverage: {companyCount: number; requiredCompanyCount: number; excludedCompanyCount: number; requiredSourceCount: number; excludedSourceCount: number; expectedSourceCount: number; sourceCount: number; unplannedSourceCount: number; publishingSourceCount: number; unsupportedSourceCount: number; heldSourceCount: number};
}

/** Sanofi compact receipts bind the complete same-tuple artifact set; legacy proofs query their original locators. No bodies,
 * paths, or independent-validation JSON are queried or exposed in the snapshot. */
export async function bindSanofiPersistedArtifacts(tx: PortableSnapshotTransactionDb, results: PortableSourceResultRow[]): Promise<void> {
  const requests: Array<{row:PortableSourceResultRow; locators:string[]|null}> = [];
  for(const row of results){
    if(row.sourceId!=="source-sanofi-china-social" || row.atomicCommitState!=="COMMITTED" || row.completenessState!=="VERIFIED") continue;
    // Never inherit caller-supplied commitments across the database read boundary.
    delete row.sanofiArtifacts;
    try {
      const certificate = isJobProjectionDeltaReceipt(row.completenessCertificate) ?
        parseJobProjectionDeltaReceipt(row.completenessCertificate, row.completenessCertificateSha256 ?? "").legacyCertificate : row.completenessCertificate;
      if ((certificate as {grade?: unknown} | null)?.grade !== "B") continue;
      requests.push({row,locators:(certificate as {schemaVersion?:unknown}).schemaVersion === SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION ? null : sanofiCertificateArtifactLocators(certificate)});
    } catch { /* The receipt reader holds invalid proofs. */ }
  }
  if(requests.length===0 || !tx.evidenceArtifact) return;
  const artifacts=await tx.evidenceArtifact.findMany({
    where:{OR:requests.map(({row,locators})=>({releaseCandidateId:row.releaseCandidateId,batchId:row.batchId,
      sourceResultId:row.id,sourceId:row.sourceId,...(locators===null?{}:{extractorLocator:{in:locators}})}))},
    select:{releaseCandidateId:true,batchId:true,sourceResultId:true,sourceId:true,kind:true,sha256:true,extractorLocator:true,byteCount:true,capturedAt:true}
  });
  if(!Array.isArray(artifacts)) throw new Error("SANOFI_CN_PERSISTED_ARTIFACT_COMMITMENTS_REQUIRED");
  for(const {row} of requests) row.sanofiArtifacts=(artifacts as SanofiArtifactCommitment[]).filter(a=>
    a.releaseCandidateId===row.releaseCandidateId && a.batchId===row.batchId && a.sourceResultId===row.id && a.sourceId===row.sourceId);
}

/** Additive opt-in API: do not inject this into the legacy eligible-source-only search reader.
 * All source receipts, lifecycle membership and mutable jobs share one repeatable-read snapshot.
 * No database writes, credential loading or production route changes occur here. */
export async function readPortablePublicSnapshot(
  db: PortableSnapshotDb,
  options: Partial<PortableSnapshotOptions> = {},
  plans: readonly SourceCrawlPlan[] = buildStagedSourceCrawlPlans(selectLaunchCompanies(P0_LAUNCH_MANIFEST, candidateCompanies)),
  cache?: PortableSnapshotCache,
  onRefreshRequired?: () => void,
  yieldAfterSource?: () => Promise<void>
): Promise<PortablePublicSnapshot> {
  return (await readPortablePublicSnapshotWithStatus(db, options, plans, cache, onRefreshRequired, yieldAfterSource)).snapshot;
}

export interface PortableSnapshotRead {
  snapshot: PortablePublicSnapshot;
  snapshotRefresh: PublicSnapshotRefresh;
}

/** Request-owned, numeric diagnostics. Never receives identities or query data. */
export type SnapshotReadTiming = (phase: string, durationMs: number) => void;

/** The response status travels with the selected projection across every await. */
export async function readPortablePublicSnapshotWithStatus(
  db: PortableSnapshotDb,
  options: Partial<PortableSnapshotOptions> = {},
  plans: readonly SourceCrawlPlan[] = buildStagedSourceCrawlPlans(selectLaunchCompanies(P0_LAUNCH_MANIFEST, candidateCompanies)),
  cache?: PortableSnapshotCache,
  onRefreshRequired?: () => Exclude<PublicSnapshotRefresh["state"], "CURRENT"> | void,
  yieldAfterSource?: () => Promise<void>,
  timing?: {startedAt: number; record: SnapshotReadTiming}
): Promise<PortableSnapshotRead> {
  if (typeof db.$transaction !== "function") throw new Error("REPEATABLE_READ_PORTABLE_SNAPSHOT_REQUIRED");
  // The old 60-company registry is a catalog; the current runtime manifest owns the public roster.
  // Historical count/evidence fields in the manifest are not used as publication authority.
  if (validateLaunchManifest(P0_LAUNCH_MANIFEST, candidateCompanies.map(company => company.id)).length > 0) throw new Error("PORTABLE_PUBLIC_ROSTER_MISMATCH");
  const scope = getPortableCoverageScope();
  const excludedSourceIds = new Set(scope.exclusions.map(exclusion => exclusion.sourceId));
  const companiesInScope = selectLaunchCompanies(P0_LAUNCH_MANIFEST, candidateCompanies);
  const immutablePlans = structuredClone([...plans]);
  const roster = new Map(companiesInScope.map(company => [company.id, company]));
  for (const plan of immutablePlans) {
    const identity = P0_LAUNCH_MANIFEST.companies.find(company => company.companyId === plan.company.id);
    if (!identity || !roster.get(plan.company.id)?.sources.some(source => source.id === plan.source.id) ||
        identity?.category !== plan.company.category || identity.source.sourceId !== plan.source.id ||
        identity.source.surfaceId !== plan.source.surfaceId ||
        (identity.source.adapterId !== plan.adapterId &&
          !(plan.source.id === "source-bayer-healthcare-social" && supportsPublicBGrade(plan)))) throw new Error("PORTABLE_PLAN_OUTSIDE_ROSTER");
  }
  const readOptions: PortableSnapshotOptions = {currentTime: new Date(options.currentTime ?? new Date()),
    ...(options.freshnessMaximumMs === undefined ? {} : {freshnessMaximumMs: options.freshnessMaximumMs})};
  // Validate the options and duplicate source ownership before starting any I/O.
  const emptySelections = selectPortableSourceSnapshots(immutablePlans, [], readOptions);
  const requiredPlans = immutablePlans.filter(plan => !excludedSourceIds.has(plan.source.id));
  const identities = new Map(requiredPlans.map(plan => [plan.source.id, {companyId: plan.company.id, configs: portableCommittedConfigHashes(plan), sanofiTransition: isSanofiPublicTransitionPlan(plan)}]));
  const cacheScope = JSON.stringify({plans: immutablePlans.map(plan => [plan.company.id, plan.source.id, sourcePlanConfigSha256(plan)]),
    freshnessMaximumMs: readOptions.freshnessMaximumMs ?? DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS});
  const transactionStartedAt = performance.now();
  timing?.record("planPrep", transactionStartedAt - timing.startedAt);
  const data = await db.$transaction(async tx => {
    timing?.record("txAcquire", performance.now() - transactionStartedAt);
    // Check freshness in the same database snapshot used on a miss. Failure of
    // this query rejects the public request, including the opt-in display path.
    let version: string | undefined;
    if (cache && tx.$queryRawUnsafe) {
      const versionStartedAt = performance.now();
      const rows = await tx.$queryRawUnsafe(PORTABLE_SNAPSHOT_VERSION_SQL);
      timing?.record("versionSQL", performance.now() - versionStartedAt);
      version = portableSnapshotVersion(rows);
    }
    const cloneStartedAt = performance.now();
    const cached = version === undefined ? undefined : cache!.getRead(version, cacheScope, readOptions.currentTime.getTime());
    if (cached) {
      timing?.record("cacheClone", performance.now() - cloneStartedAt);
      return {cached};
    }
    // Only the HTTP display reader opts into an older verified projection. A
    // successful current version check is mandatory; errors still reject.
    const previous = version === undefined || !onRefreshRequired ? undefined :
      cache!.getPreviousRead(cacheScope, readOptions.currentTime.getTime());
    if (previous) {
      timing?.record("cacheClone", performance.now() - cloneStartedAt);
      return {cached: previous, refreshRequired: true};
    }
    const rawResults = tx.$queryRawUnsafe
      ? await tx.$queryRawUnsafe(portableCommittedResultsSql(requiredPlans))
      : await tx.crawlBatchSourceResult.findMany({
        where: {OR: requiredPlans.flatMap(plan => isSanofiPublicTransitionPlan(plan) ? [{sourceId: plan.source.id}] :
          portableCommittedConfigHashes(plan).map(sourceConfigHash => ({sourceId: plan.source.id, sourceConfigHash}))), batch: {is: {kind: "SCHEDULED"}}},
        select: portableSourceResultSelect, orderBy: [{startedAt: "asc"}, {id: "asc"}]
      });
    if (!Array.isArray(rawResults)) throw new Error("INVALID_PORTABLE_SOURCE_RESULT_ROWS");
    const results = (rawResults as PortableSourceResultRow[]).map(compactCommittedSourceResult);
    const novoClosed = requiredPlans.some(plan => plan.source.id === NOVO_CLOSURE_SOURCE)
      ? await readNovoSingleClosures(tx as Parameters<typeof readNovoSingleClosures>[0],readOptions.currentTime) : [];
    // Prefetch candidates only, never publication authority. A publishing selection must be
    // the newest committed/verified row: a later invalid or unclaimed receipt forces a hold.
    // Keep compact history for the true floor, latest attempt and writer decisions.
    const candidates = new Map<string, {result: PortableSourceResultRow; floor: Date; companyId: string}>();
    for (const row of results) {
      const identity = identities.get(row.sourceId);
      if (!identity || (!identity.configs.includes(row.sourceConfigHash) &&
          !(identity.sanofiTransition && isSanofiHistoricalPublicCandidate(row))) || row.batch.kind !== "SCHEDULED" || row.atomicCommitState !== "COMMITTED" || row.completenessState !== "VERIFIED" ||
          !(row.finishedAt instanceof Date) || !Number.isFinite(row.finishedAt.getTime())) continue;
      const prior = candidates.get(row.sourceId);
      const newest = !prior || row.finishedAt > prior.result.finishedAt! ||
        row.finishedAt.getTime() === prior.result.finishedAt!.getTime() && Buffer.compare(Buffer.from(row.id), Buffer.from(prior.result.id)) > 0;
      candidates.set(row.sourceId, {result: newest ? row : prior.result, companyId: identity.companyId,
        floor: prior && prior.floor < row.finishedAt ? prior.floor : row.finishedAt});
    }
    const pending = [...candidates.values()];
    let members: PortableLifecycleMemberRow[] = [];
    let jobs: PortableJobRow[] = [];
    if (pending.length > 0) {
      // Delta GRACE references must be backed by the prior complete CURRENT set,
      // not merely by a timestamp carried in the latest receipt. Prefetch only;
      // exact receipt, identity and membership verification remains in the domain.
      const memberResultIds = new Set(pending.map(({result}) => result.id));
      for (const closure of novoClosed) memberResultIds.add(closure.previousSourceResultId);
      for (const {result} of pending) {
        if (!isJobProjectionDeltaReceipt(result.completenessCertificate)) continue;
        const receiptMembers = (result.completenessCertificate as {members?: unknown}).members;
        if (!Array.isArray(receiptMembers)) continue;
        for (const member of receiptMembers) if (member && typeof member === "object" && member.missingCount === 1 &&
            typeof member.lastPresentResultId === "string" &&
            results.some(row => row.id === member.lastPresentResultId && row.sourceId === result.sourceId)) memberResultIds.add(member.lastPresentResultId);
      }
      const rawMembers = await tx.lifecycleSetEvidenceMember.findMany({
        where: {sourceResultId: {in: [...memberResultIds]}}, select: lifecycleMemberSelect,
        orderBy: [{sourceResultId: "asc"}, {setKind: "asc"}, {jobKey: "asc"}]
      });
      if (!Array.isArray(rawMembers)) throw new Error("INVALID_PORTABLE_LIFECYCLE_ROWS");
      members = rawMembers as PortableLifecycleMemberRow[];
      // The conservative date envelope contains the eventual verified floor/ceiling.
      // The pure projector rechecks the exact verified bounds and all membership rules.
      const rawJobs = await tx.job.findMany({where: {OR: pending.map(({result, floor, companyId}) => ({
        companyId, sourceId: result.sourceId, lifecycleStatus: "ACTIVE", visibleInFrontend: true,
        ...(isJobProjectionDeltaReceipt(result.completenessCertificate) ? {} : {lastSeenAt: {gte: floor, lte: result.finishedAt!}}),
        dedupeKey: {in: members.filter(member => member.sourceResultId === result.id && member.setKind === "VISIBLE").map(member => member.jobKey)}
      }))}, select: jobSelect, orderBy: [{sourceId: "asc"}, {dedupeKey: "asc"}]});
      if (!Array.isArray(rawJobs)) throw new Error("INVALID_PORTABLE_JOB_ROWS");
      jobs = rawJobs as PortableJobRow[];
    }
    return {results, members, jobs, version, novoClosed};
  }, {isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 30_000});
  timing?.record("tx", performance.now() - transactionStartedAt);
  if (data.cached) {
    const state = data.refreshRequired ? onRefreshRequired!() ?? "UPDATING" : "CURRENT";
    const {snapshot, ...identity} = data.cached;
    return {snapshot, snapshotRefresh: {state, ...identity}};
  }
  const {results, members, jobs, version, novoClosed} = data;
  const rebuildStartedAt = performance.now();
  // Current membership and mutable Job projection checks use the same owned snapshot.
  // Original source evidence was admitted by the atomic publisher.
  let selections: ReturnType<typeof selectPortableSourceSnapshots>;
  if (yieldAfterSource) {
    selections = [];
    // Plan ownership/options were validated together before I/O. Each source
    // consumes the same owned transaction rows and fixed time, in its original
    // history order. Never expose partial work or update the cache at a yield.
    for (const plan of requiredPlans) {
      selections.push(...selectPortableSourceSnapshots([plan], results, readOptions));
      await yieldAfterSource();
    }
    selections.sort((left, right) => Buffer.compare(Buffer.from(left.sourceId), Buffer.from(right.sourceId)));
  } else selections = selectPortableSourceSnapshots(requiredPlans, results, readOptions);
  // Closure identity is backed by the original committed metadata and complete
  // membership set, not a title match or mutable Job.visible flag.
  for (const closure of novoClosed) {
    const plan = requiredPlans.find(plan => plan.source.id === NOVO_CLOSURE_SOURCE)!;
    const row = results.find(row => row.id === closure.previousSourceResultId && row.sourceId === NOVO_CLOSURE_SOURCE);
    if (!plan || !row?.finishedAt || row.finishedAt >= new Date(closure.capturedAt)) throw Error("NOVO_CLOSURE_HISTORY_REQUIRED");
    const historical = selectPortableSourceSnapshots([plan],[row],{...readOptions,currentTime:row.finishedAt})[0]!;
    if (!historical.selected || historical.state !== "PUBLISHING" ||
        !verifiedMembers(historical.selected,members.filter(m => m.sourceResultId === row.id)).has(closure.jobKey)) {
      throw Error("NOVO_CLOSURE_HISTORY_INVALID");
    }
  }
  const sources: PortableProjectedSource[] = [];
  for (const source of selections) {
    const projected = projectPortableSourceJobs(source,
      members.filter(member => member.sourceResultId === source.selectedSourceResultId), jobs, readOptions, members);
    // First verify the original complete snapshot. A separate, same-transaction
    // single-job proof can only remove its exact key; it cannot refresh a source.
    if (projected.state === "PUBLISHING" && projected.sourceId === NOVO_CLOSURE_SOURCE) {
      const applicable = novoClosed.filter(d => jobs.some(job => job.id === d.jobId && job.dedupeKey === d.jobKey &&
        job.companyId === NOVO_CLOSURE_COMPANY && job.sourceId === NOVO_CLOSURE_SOURCE));
      const shouldRemove = (job: PortablePublicJob) => applicable.some(d => novoSingleClosureRemoves(job,d));
      const removed = projected.jobs.filter(shouldRemove);
      projected.jobs = projected.jobs.filter(job => !shouldRemove(job));
      projected.visibleJobCount = projected.jobs.length;
      const maximumAge = readOptions.freshnessMaximumMs ?? DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS;
      projected.staleJobCount -= removed.filter(job => readOptions.currentTime.getTime() -
        Date.parse(job.lastConfirmedObservedAt ?? job.lastSeenAt) > maximumAge).length;
    }
    sources.push(projected);
    if (yieldAfterSource) await yieldAfterSource();
  }
  for (const excluded of emptySelections.filter(source => excludedSourceIds.has(source.sourceId))) {
    const {selected: _selected, ...status} = excluded;
    sources.push({...status, state: "EXCLUDED", health: "NOT_APPLICABLE", reasons: ["USER_AUTHORIZED_EXCLUSION"], visibleJobCount: null, staleJobCount: 0, jobs: []});
  }
  sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const companies: PortablePublicCompany[] = companiesInScope.map(company => {
    const exclusion = scope.exclusions.find(entry => entry.companyId === company.id);
    const ownSources = sources.filter(source => source.companyId === company.id);
    const available = ownSources.filter(source => source.state === "PUBLISHING");
    const sourceIds = P0_LAUNCH_MANIFEST.companies.filter(entry => entry.companyId === company.id).map(entry => entry.source.sourceId).sort();
    const allAvailable = sourceIds.length > 0 && sourceIds.every(id => available.some(source => source.sourceId === id));
    return {id: company.id, companyName: company.officialChineseName, pinyin: company.pinyinName, category: company.category,
      sourceIds, publishingSourceIds: available.map(source => source.sourceId), required: !exclusion, exclusionReason: exclusion?.reasonCode ?? null,
      coverage: exclusion ? "EXCLUDED" : allAvailable ? "COMPLETE" : available.length > 0 ? "PARTIAL" : "UNVERIFIED",
      health: exclusion ? "NOT_APPLICABLE" : allAvailable && available.every(source => source.health === "HEALTHY") ? "HEALTHY" : available.length > 0 || ownSources.some(source => source.health === "DEGRADED") ? "DEGRADED" : "UNVERIFIED",
      jobs: available.flatMap(source => source.jobs)};
  });
  const published = sources.filter(source => source.state === "PUBLISHING");
  const snapshot: PortablePublicSnapshot = {schemaVersion: "portable-public-snapshot-v1", policyId: SOURCE_QUALITY_POLICY_ID, coveragePolicyId: scope.policyId, generatedAt: readOptions.currentTime.toISOString(),
    sources, companies, totalJobs: published.reduce((n, source) => n + source.jobs.length, 0),
    lastUpdatedAt: published.map(source => source.lastSuccessAt!).sort().at(-1) ?? null,
    coverage: {companyCount: companies.length, requiredCompanyCount: scope.requiredCompanyIds.length, excludedCompanyCount: scope.exclusions.length, requiredSourceCount: scope.requiredSourceIds.length, excludedSourceCount: scope.exclusions.length, expectedSourceCount: P0_LAUNCH_MANIFEST.companies.length, sourceCount: sources.length,
      unplannedSourceCount: P0_LAUNCH_MANIFEST.companies.filter(company => !sources.some(source => source.sourceId === company.source.sourceId)).length, publishingSourceCount: published.length,
      unsupportedSourceCount: sources.filter(source => source.policyId === null && source.state !== "EXCLUDED").length, heldSourceCount: sources.filter(source => source.state === "HOLD").length}};
  const identity = version !== undefined ? cache!.setRead(version, cacheScope, portableSnapshotValidUntil({results, jobs},
    readOptions.currentTime.getTime(), readOptions.freshnessMaximumMs ?? DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS, snapshot), snapshot) : portableSnapshotIdentities(snapshot);
  timing?.record("rebuild", performance.now() - rebuildStartedAt);
  return {snapshot, snapshotRefresh: {state: "CURRENT", ...identity}};
}
