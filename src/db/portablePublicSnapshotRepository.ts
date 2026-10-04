import { isSanofiPublicTransitionPlan, isSanofiHistoricalPublicCandidate } from "../domain/sanofiPublicTransition";
import type { Prisma } from "@prisma/client";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256, type SourceCrawlPlan } from "../crawler/sourcePlan";
import { candidateCompanies } from "../data/companyRegistry";
import { getPortableCoverageScope, PORTABLE_COVERAGE_POLICY_ID } from "../release/portableCoveragePolicy";
import { P0_LAUNCH_MANIFEST, selectLaunchCompanies, validateLaunchManifest } from "../release/launchManifest";
import { supportsPublicBGrade, selectPortableSourceSnapshots, projectPortableSourceJobs, type PortableProjectedSource, type PortablePublicJob, type PortableSnapshotOptions } from "../domain/portablePublicSnapshot";
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
export type PortableSourceResultRow = Prisma.CrawlBatchSourceResultGetPayload<{select: typeof portableSourceResultSelect}>;
const lifecycleMemberSelect = {
  releaseCandidateId: true, batchId: true, sourceId: true, sourceResultId: true, setKind: true, jobKey: true,
  jobKeySha256: true, lifecycleStatus: true, missingCount: true
} as const satisfies Prisma.LifecycleSetEvidenceMemberSelect;
export type PortableLifecycleMemberRow = Prisma.LifecycleSetEvidenceMemberGetPayload<{select: typeof lifecycleMemberSelect}>;
const jobSelect = {
  id: true, companyId: true, sourceId: true, dedupeKey: true, officialTitle: true, auxiliaryChineseTitle: true, humanCorrectedTitle: true,
  officialUrl: true, officialPublishedAt: true, city: true, cities: true, locationRaw: true, category: true, humanCorrectedCategory: true,
  isNew: true, lastSeenAt: true, lifecycleStatus: true, visibleInFrontend: true, missingSuccessCount: true
} as const satisfies Prisma.JobSelect;
export type PortableJobRow = Prisma.JobGetPayload<{select: typeof jobSelect}>;
export interface PortableSnapshotTransactionDb {
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
  const identities = new Map(requiredPlans.map(plan => [plan.source.id, {companyId: plan.company.id, config: sourcePlanConfigSha256(plan), sanofiTransition: isSanofiPublicTransitionPlan(plan)}]));
  const cacheScope = JSON.stringify({plans: immutablePlans.map(plan => [plan.company.id, plan.source.id, sourcePlanConfigSha256(plan)]),
    freshnessMaximumMs: readOptions.freshnessMaximumMs ?? DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS});
  const data = await db.$transaction(async tx => {
    // Check freshness in the same database snapshot used on a miss. No stale-while-
    // revalidate path: failure of this query rejects the public request.
    const version = cache && tx.$queryRawUnsafe
      ? portableSnapshotVersion(await tx.$queryRawUnsafe(PORTABLE_SNAPSHOT_VERSION_SQL)) : undefined;
    const cached = version === undefined ? undefined : cache!.get(version, cacheScope, readOptions.currentTime.getTime());
    if (cached) return {cached};
    // Only the HTTP display reader opts into an older verified projection. A
    // successful current version check is mandatory; errors still reject.
    const previous = version === undefined || !onRefreshRequired ? undefined :
      cache!.getPrevious(cacheScope, readOptions.currentTime.getTime());
    if (previous) return {cached: previous, refreshRequired: true};
    const rawResults = await tx.crawlBatchSourceResult.findMany({
      where: {OR: requiredPlans.map(plan => isSanofiPublicTransitionPlan(plan) ? {sourceId: plan.source.id} :
        {sourceId: plan.source.id, sourceConfigHash: sourcePlanConfigSha256(plan)}), batch: {is: {kind: "SCHEDULED"}}},
      select: portableSourceResultSelect, orderBy: [{startedAt: "asc"}, {id: "asc"}]
    });
    if (!Array.isArray(rawResults)) throw new Error("INVALID_PORTABLE_SOURCE_RESULT_ROWS");
    const results = structuredClone(rawResults) as PortableSourceResultRow[];
    // Prefetch candidates only, never publication authority. A publishing selection must be
    // the newest committed/verified row: a later invalid or unclaimed receipt forces a hold.
    // Keep all history for the verifier's true floor, latest attempt and integrity decisions.
    const candidates = new Map<string, {result: PortableSourceResultRow; floor: Date; companyId: string}>();
    for (const row of results) {
      const identity = identities.get(row.sourceId);
      if (!identity || (row.sourceConfigHash !== identity.config &&
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
      const rawMembers = await tx.lifecycleSetEvidenceMember.findMany({
        where: {sourceResultId: {in: pending.map(({result}) => result.id)}}, select: lifecycleMemberSelect,
        orderBy: [{sourceResultId: "asc"}, {setKind: "asc"}, {jobKey: "asc"}]
      });
      if (!Array.isArray(rawMembers)) throw new Error("INVALID_PORTABLE_LIFECYCLE_ROWS");
      members = structuredClone(rawMembers) as PortableLifecycleMemberRow[];
      // The conservative date envelope contains the eventual verified floor/ceiling.
      // The pure projector rechecks the exact verified bounds and all membership rules.
      const rawJobs = await tx.job.findMany({where: {OR: pending.map(({result, floor, companyId}) => ({
        companyId, sourceId: result.sourceId, lifecycleStatus: "ACTIVE", visibleInFrontend: true,
        lastSeenAt: {gte: floor, lte: result.finishedAt!},
        dedupeKey: {in: members.filter(member => member.sourceResultId === result.id && member.setKind === "VISIBLE").map(member => member.jobKey)}
      }))}, select: jobSelect, orderBy: [{sourceId: "asc"}, {dedupeKey: "asc"}]});
      if (!Array.isArray(rawJobs)) throw new Error("INVALID_PORTABLE_JOB_ROWS");
      jobs = structuredClone(rawJobs) as PortableJobRow[];
    }
    return {results, members, jobs, version};
  }, {isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 10_000});
  if (data.cached) {
    if (data.refreshRequired) onRefreshRequired!();
    return data.cached;
  }
  const {results, members, jobs, version} = data;
  // Receipt hashing, rendered evidence replay and lifecycle/job projection are pure CPU
  // work over the same owned snapshot. Release the database connection before doing them.
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
  const sources: PortableProjectedSource[] = [];
  for (const source of selections) {
    sources.push(projectPortableSourceJobs(source,
      members.filter(member => member.sourceResultId === source.selectedSourceResultId), jobs, readOptions));
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
  if (version !== undefined) cache!.set(version, cacheScope, portableSnapshotValidUntil({results, jobs},
    readOptions.currentTime.getTime(), readOptions.freshnessMaximumMs ?? DAILY_PUBLICATION_FRESHNESS_MAXIMUM_MS, snapshot), snapshot);
  return snapshot;
}
