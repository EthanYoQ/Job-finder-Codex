import type { Prisma } from "@prisma/client";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256, type SourceCrawlPlan } from "../crawler/sourcePlan";
import { candidateCompanies } from "../data/companyRegistry";
import { getPortableCoverageScope, PORTABLE_COVERAGE_POLICY_ID } from "../release/portableCoveragePolicy";
import { P0_LAUNCH_MANIFEST, selectLaunchCompanies, validateLaunchManifest } from "../release/launchManifest";
import { supportsPublicBGrade, selectPortableSourceSnapshots, projectPortableSourceJobs, type PortableProjectedSource, type PortablePublicJob, type PortableSnapshotOptions } from "../domain/portablePublicSnapshot";
import { SOURCE_QUALITY_POLICY_ID } from "../crawler/sourceQualityAdmission";

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
  batch: {select: {id: true, releaseCandidateId: true, kind: true, status: true}}
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
  plans: readonly SourceCrawlPlan[] = buildStagedSourceCrawlPlans(selectLaunchCompanies(P0_LAUNCH_MANIFEST, candidateCompanies))
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
  return db.$transaction(async tx => {
    const rawResults = await tx.crawlBatchSourceResult.findMany({
      where: {OR: requiredPlans.map(plan => ({sourceId: plan.source.id, sourceConfigHash: sourcePlanConfigSha256(plan)})), batch: {is: {kind: "SCHEDULED"}}},
      select: portableSourceResultSelect, orderBy: [{startedAt: "asc"}, {id: "asc"}]
    });
    if (!Array.isArray(rawResults)) throw new Error("INVALID_PORTABLE_SOURCE_RESULT_ROWS");
    const selections = selectPortableSourceSnapshots(requiredPlans, structuredClone(rawResults) as PortableSourceResultRow[], readOptions);
    const publishing = selections.filter(source => source.state === "PUBLISHING");
    let members: PortableLifecycleMemberRow[] = [];
    let jobs: PortableJobRow[] = [];
    if (publishing.length > 0) {
      const rawMembers = await tx.lifecycleSetEvidenceMember.findMany({
        where: {sourceResultId: {in: publishing.map(source => source.selectedSourceResultId!)}}, select: lifecycleMemberSelect,
        orderBy: [{sourceResultId: "asc"}, {setKind: "asc"}, {jobKey: "asc"}]
      });
      if (!Array.isArray(rawMembers)) throw new Error("INVALID_PORTABLE_LIFECYCLE_ROWS");
      members = rawMembers as PortableLifecycleMemberRow[];
      // Restrict in SQL and recheck membership, dates, ownership and lifecycle in the pure projector.
      const rawJobs = await tx.job.findMany({where: {OR: publishing.map(source => ({
        companyId: source.companyId, sourceId: source.sourceId, lifecycleStatus: "ACTIVE", visibleInFrontend: true,
        lastSeenAt: {gte: new Date(source.visibilityFloor!), lte: new Date(source.lastAcceptedAt!)},
        dedupeKey: {in: members.filter(member => member.sourceResultId === source.selectedSourceResultId && member.setKind === "VISIBLE").map(member => member.jobKey)}
      }))}, select: jobSelect, orderBy: [{sourceId: "asc"}, {dedupeKey: "asc"}]});
      if (!Array.isArray(rawJobs)) throw new Error("INVALID_PORTABLE_JOB_ROWS");
      jobs = rawJobs as PortableJobRow[];
    }
    const sources: PortableProjectedSource[] = selections.map(source => projectPortableSourceJobs(source,
      members.filter(member => member.sourceResultId === source.selectedSourceResultId), jobs, readOptions));
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
    return {schemaVersion: "portable-public-snapshot-v1", policyId: SOURCE_QUALITY_POLICY_ID, coveragePolicyId: scope.policyId, generatedAt: readOptions.currentTime.toISOString(),
      sources, companies, totalJobs: published.reduce((n, source) => n + source.jobs.length, 0),
      lastUpdatedAt: published.map(source => source.lastSuccessAt!).sort().at(-1) ?? null,
      coverage: {companyCount: companies.length, requiredCompanyCount: scope.requiredCompanyIds.length, excludedCompanyCount: scope.exclusions.length, requiredSourceCount: scope.requiredSourceIds.length, excludedSourceCount: scope.exclusions.length, expectedSourceCount: P0_LAUNCH_MANIFEST.companies.length, sourceCount: sources.length,
        unplannedSourceCount: P0_LAUNCH_MANIFEST.companies.filter(company => !sources.some(source => source.sourceId === company.source.sourceId)).length, publishingSourceCount: published.length,
        unsupportedSourceCount: sources.filter(source => source.policyId === null && source.state !== "EXCLUDED").length, heldSourceCount: sources.filter(source => source.state === "HOLD").length}};
  }, {isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 10_000});
}
