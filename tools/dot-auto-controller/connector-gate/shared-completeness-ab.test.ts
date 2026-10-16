// @vitest-environment node
/**
 * Synthetic A/B compatibility regression through the real DB-started compiler.
 * Run this file in two separate processes, selecting one existing canonical
 * source with JOBFINDER_CLOUD_SOURCE_ID:
 *   source-lilly-china-social  (A: official-total replay)
 *   source-takeda-china-social (B: independent rendered-traversal replay)
 * SHARED_GUARD_EVIDENCE_ROOT must be an existing, external evidence directory.
 * The parent must commit the candidate and finish its private deps/dist first.
 * No network, database connection, admission/compiler/identity/lease mock,
 * database migration, installation, or production qualification is performed.
 * All generated SQL is retained locally and is deliberately NOT dispatched.
 */
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, realpath, writeFile} from 'node:fs/promises';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBuildIdentity} from '../vendor/c60-source/src/readiness/buildIdentity.ts';
import {deriveCurrentStagedScheduleExpectation, STAGED_SCHEDULE_ORACLE_VERSION} from '../vendor/c60-source/src/crawler/stagedScheduleAuthority.ts';
import {archiveSourceEvidence} from '../vendor/c60-source/src/crawler/artifactArchive.ts';
import {bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch} from '../vendor/c60-source/src/crawler/runtimeAtomicEvidence.ts';
import {hashCanonicalStringSet} from '../vendor/c60-source/src/crawler/runtimeBatchIdentity.ts';
import {createOfficialJsonSourceFetch} from '../vendor/c60-source/src/crawler/officialJsonSourceFetch.ts';
import {createHttpHtmlSourceFetch} from '../vendor/c60-source/src/crawler/httpHtmlSourceFetch.ts';
import {runSourceCrawl} from '../vendor/c60-source/src/crawler/runSourceCrawl.ts';
import {sourcePlanConfigSha256, type SourceCrawlPlan} from '../vendor/c60-source/src/crawler/sourcePlan.ts';
import {createPlanBoundHtmlBrowserTraversalValidation} from '../vendor/c60-source/src/crawler/traversalCertificate.ts';
import {evaluateCompletenessAnomalyForCrawl} from '../vendor/c60-source/src/crawler/completenessAnomalyPolicy.ts';
import {loadPilotContext} from '../vendor/c60-source/src/crawler/cloudPilotContext.ts';
import {CLOUD_PILOT_SOURCE} from '../vendor/c60-source/src/db/cloudPilotSqlControl.ts';
import {compileDbStartedCloudSourcePublication, executeIngestionCommands, type DbStartedCloudPublicationInput, type DbStartedCloudSourceInput} from '../vendor/c60-source/src/db/ingestionRepository.ts';
import {unwrapJobProjectionSourceRow} from '../vendor/c60-source/src/db/jobProjectionDeltaCompiler.ts';
import {V75_FENCE_MIGRATION_NAME, V75_FENCE_SCHEMA_SHA256} from '../vendor/c60-source/src/db/v75FenceProfile.ts';
import {fromPrismaJobCategory} from '../vendor/c60-source/src/db/prismaMappers.ts';
import {lillyBootstrap, syntheticLillyRow} from '../vendor/c60-source/tests/helpers/lillyPhenom.ts';

const ROOT = fileURLToPath(new URL('../vendor/c60-source/', import.meta.url));
const CANDIDATE_ROOT = resolve(ROOT, '../../../..');
const PINNED_NODE = '/workspace/scratch/5e9614251709/schema50-production-install-build-20261016T0340Z/pinned-runtime/node';
const SOURCE_ID = process.env.JOBFINDER_CLOUD_SOURCE_ID;
if (SOURCE_ID !== 'source-lilly-china-social' && SOURCE_ID !== 'source-takeda-china-social') {
  throw Error('SHARED_AB_REQUIRES_EXPLICIT_LILLY_OR_TAKEDA_SOURCE');
}
const GRADE = SOURCE_ID === 'source-lilly-china-social' ? 'A' : 'B';
const SCHEMA = GRADE === 'A' ? 'a-grade-official-total-v2' : 'b-grade-independent-traversal-v2';
const BASELINE_AT = '2026-10-16T09:00:00.000Z';
const CURRENT_AT = '2026-10-16T09:10:00.000Z';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const contains = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
};

let build: ReturnType<typeof createBuildIdentity>;
let expectation: ReturnType<typeof deriveCurrentStagedScheduleExpectation>;
let plan: SourceCrawlPlan;
let evidenceRoot: string;
let baseline: Awaited<ReturnType<typeof capture>>;
let baselineContext: Awaited<ReturnType<typeof contextFor>>;
let verifiedBaseline: Awaited<ReturnType<typeof loadPilotContext>>;
const candidate = {id: `synthetic-shared-ab-${GRADE.toLowerCase()}-${randomUUID()}`, goalId: 'jobfinder-portable-required-40', version: 100};
const databaseIdentity = {migrationVersion: V75_FENCE_MIGRATION_NAME, schemaHash: V75_FENCE_SCHEMA_SHA256,
  dbSnapshotHash: digest('SYNTHETIC_SHARED_AB_EXTERNAL_SQL_CONTEXT_ONLY')};

function registration() {
  return {...candidate, commitSha: build.commitSha, ...databaseIdentity,
    rosterHash: expectation.rosterSha256, sourcePlanHash: expectation.sourcePlanSha256,
    sourceConfigHash: expectation.sourceConfigSha256, adapterBundleHash: expectation.adapterBundleSha256,
    sourceTreeHash: build.sourceTreeSha256, runtimeTreeHash: build.runtimeTreeSha256,
    oracleVersion: STAGED_SCHEDULE_ORACLE_VERSION, minimumStableCompanyCount: 41, status: 'BUILDING'};
}

function identity() {
  return {releaseCandidateId: candidate.id, commitSha: expectation.commitSha,
    rosterSha256: expectation.rosterSha256, sourcePlanSha256: expectation.sourcePlanSha256,
    sourceConfigSha256: expectation.sourceConfigSha256, adapterBundleSha256: expectation.adapterBundleSha256,
    batchKind: 'SCHEDULED' as const, ownerId: CLOUD_PILOT_SOURCE.ownerId,
    expectedPlannedSourceIds: [plan.source.id], expectedPlannedSourceCount: 1,
    expectedPlannedSourceSetSha256: hashCanonicalStringSet([plan.source.id])};
}

/** Only raw HTTP is synthetic. The fetcher, adapter and evidence construction run unchanged. */
async function captureLilly(count: number, at: string) {
  const rows = Array.from({length: count}, (_, index) => syntheticLillyRow(index));
  const byUrl = new Map(rows.map(row => [String(row.applyUrl), row]));
  const fetch = createOfficialJsonSourceFetch({now: () => new Date(at), allowBrowserFallback: false,
    http: async request => {
      let body: string;
      if (request.url === plan.source.officialEntryUrl && request.method === 'GET') {
        body = `<script>var phApp=${JSON.stringify(lillyBootstrap)};</script>`;
      } else if (request.url === lillyBootstrap.widgetApiEndpoint && request.method === 'POST') {
        const requestBody = JSON.parse(String(request.body));
        if (!Number.isSafeInteger(requestBody.from) || requestBody.from < 0 || requestBody.size !== 50 ||
            JSON.stringify(requestBody.selected_fields.country) !== '["China"]') throw Error('SYNTHETIC_A_REQUEST_DRIFT');
        const page = rows.slice(requestBody.from, requestBody.from + requestBody.size);
        body = JSON.stringify({refineSearch: {status: 200, hits: page.length, totalHits: rows.length,
          from: requestBody.from, data: {jobs: page, aggregations: [], ui_selections: {country: ['China']}}}});
      } else if (byUrl.has(request.url) && request.method === 'GET') {
        const row = byUrl.get(request.url)!;
        body = `<script>window.workday = {postingAvailable: true};</script><script type="application/ld+json">${JSON.stringify({
          '@type': 'JobPosting', identifier: {value: row.reqId}, title: row.title,
          description: 'Synthetic quality role', datePosted: '2025-11-12',
          jobLocation: {address: {addressCountry: 'China', addressLocality: 'Shang Hai'}}
        })}</script>`;
      } else throw Error('SYNTHETIC_A_UNEXPECTED_REQUEST_NO_NETWORK_FALLBACK');
      return {status: 200, body, finalUrl: request.url,
        contentType: request.method === 'POST' ? 'application/json' : 'text/html', capturedAt: at};
    }});
  return {result: await runSourceCrawl(plan, {fetch}), independentTraversalValidation: undefined};
}

const takedaId = (index: number) => String(10001 + index);
/** Construct independent fixture observations from their own raw IDs, never from crawl output/counts. */
function takedaValidation(count: number, at: string, startIndex = 0) {
  const pageSize = 25, pageCount = Math.ceil(count / pageSize);
  return createPlanBoundHtmlBrowserTraversalValidation({sourceId: 'source-takeda-china-social', companyId: plan.company.id,
    sourceConfigSha256: sourcePlanConfigSha256(plan), surfaceIds: [plan.source.surfaceId!],
    channelIds: plan.expectedChannels!.map(channel => channel.channelId),
    pages: Array.from({length: pageCount}, (_, pageIndex) => ({pageNumber: pageIndex + 1, declaredTotalPages: pageCount,
      matchKeys: Array.from({length: Math.min(pageSize, count - pageIndex * pageSize)}, (_, index) =>
        `${plan.source.id}:${takedaId(startIndex + pageIndex * pageSize + index)}`),
      nextControlPresent: pageIndex + 1 < pageCount})),
    observedAt: at, expiresAt: new Date(Date.parse(at) + 24 * 60 * 60_000).toISOString()});
}

async function captureTakeda(count: number, at: string) {
  const pageSize = 25, pageCount = Math.ceil(count / pageSize);
  const attributes = `data-total-pages="${pageCount}" data-total-job-results="${count}" data-records-per-page="${pageSize}"`;
  const fetch = createHttpHtmlSourceFetch({now: () => new Date(at), http: async request => {
    if (request.url === plan.source.officialEntryUrl) return {status: 200, finalUrl: request.url, capturedAt: at,
      contentType: 'text/html', body: `<div id="search-results" data-ajax-url="/search-results" ${attributes} data-active-facet-id="0"></div><div id="search-filters"></div>`};
    const url = new URL(request.url), page = Number(url.searchParams.get('CurrentPage'));
    if (url.origin !== new URL(plan.source.officialEntryUrl).origin || url.pathname !== '/search-results' ||
        !Number.isInteger(page) || page < 1 || page > pageCount) throw Error('SYNTHETIC_B_UNEXPECTED_REQUEST_NO_NETWORK_FALLBACK');
    const rows = Array.from({length: Math.min(pageSize, count - (page - 1) * pageSize)}, (_, index) => {
      const id = takedaId((page - 1) * pageSize + index), href = `https://jobs.takeda.com/job/beijing/role/1113/${id}`;
      return `<li><button class="js-save-job-btn" data-job-id="${id}"></button><h2 class="title">Role ${id}</h2>` +
        `<a href="${href}">Role ${id}</a><span class="job-location location">Beijing, China</span></li>`;
    }).join('');
    return {status: 200, finalUrl: request.url, capturedAt: at, contentType: 'application/json',
      body: JSON.stringify({results: `<div id="search-results" data-current-page="${page}" ${attributes}><ul id="search-results-list">${rows}</ul></div>`,
        filters: '<section id="search-filters"><input class="filter-checkbox"></section>', hasJobs: true, hasContent: false})};
  }});
  return {result: await runSourceCrawl(plan, {fetch}), independentTraversalValidation: takedaValidation(count, at)};
}

async function capture(count: number, at = CURRENT_AT) {
  vi.setSystemTime(at);
  const captured = GRADE === 'A' ? await captureLilly(count, at) : await captureTakeda(count, at);
  expect(captured.result.status, JSON.stringify(captured.result.observation)).toBe('SUCCESS');
  expect(captured.result.jobs).toHaveLength(count);
  const batchId = `synthetic-shared-ab-${GRADE.toLowerCase()}-${randomUUID()}`;
  const planned = buildPendingRuntimeBatch(batchId, [plan], identity(), new Date(at));
  const pending = planned.sources[0]!;
  const tuple = {releaseCandidateId: candidate.id, batchId, sourceId: plan.source.id, sourceResultId: pending.id};
  const root = await mkdtemp(join(evidenceRoot, `shared-ab-${GRADE.toLowerCase()}-${count}-`));
  const archived = await archiveSourceEvidence({workspaceRoot: root, ...tuple, evidenceSubdirectory: 'synthetic-evidence',
    captureTool: captured.result.fetchEvidence!.captureTool,
    artifacts: bindRuntimeEvidenceArtifactIds({...tuple, artifacts: captured.result.fetchEvidence!.artifacts})});
  const source: DbStartedCloudSourceInput = {plan, pending, identity: identity(), batchId, result: captured.result,
    artifacts: archived.artifacts, publicationPolicy: 'SOURCE_ATOMIC_LAST_GOOD_V1', completedAt: new Date(at),
    ...(captured.independentTraversalValidation ? {
      independentTraversalValidation: captured.independentTraversalValidation,
      independentTraversalValidationExecution: 'CURRENT_RUN' as const,
      independentTraversalValidationTrigger: at === BASELINE_AT ? 'INITIAL_QUALIFICATION' as const : 'ANOMALY_TRIGGERED' as const
    } : {})};
  return {root, planned, source};
}

/** The supplied SQL-read rows come only from the real prior commit and mapper. */
async function contextFor(fixture: Awaited<ReturnType<typeof capture>>) {
  const commit = buildAtomicRuntimeCommit({...fixture.source, previousJobs: [], baselineCompletedBeforeCrawl: false});
  expect(commit.sourceResult).toMatchObject({dedupeOutputCount: 100, completenessState: 'VERIFIED',
    completenessCertificate: {grade: GRADE, schemaVersion: SCHEMA}});
  const sourceRow = {id: plan.source.id, companyId: plan.company.id, kind: plan.source.kind, atsKind: plan.source.atsKind,
    status: plan.source.status, officialEntryUrl: plan.source.officialEntryUrl, officialChainEvidenceUrl: plan.source.officialChainEvidenceUrl};
  const companyRow = {id: plan.company.id, officialChineseName: plan.company.officialChineseName};
  const jobs: Record<string, unknown>[] = [];
  // This is the external persistence boundary only. No compiler or lock is replaced.
  await executeIngestionCommands(commit.commands.filter(command => command.type === 'UPSERT_JOB'),
    {batchId: fixture.source.batchId}, {$transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({
      job: {upsert: async (args: {create: Record<string, unknown>}) => {
        jobs.push({...args.create, category: fromPrismaJobCategory(args.create.category as never), source: sourceRow, company: companyRow});
      }}, crawlObservation: {create: async () => {throw Error('SYNTHETIC_CONTEXT_UNEXPECTED_OBSERVATION_WRITE');}}
    })} as never);
  const observation = commit.commands.find(command => command.type === 'UPSERT_CRAWL_OBSERVATION');
  if (observation?.type !== 'UPSERT_CRAWL_OBSERVATION') throw Error('SYNTHETIC_BASELINE_OBSERVATION_MISSING');
  const row = json({...commit.sourceResult, observations: [{...observation.observation, ...commit.observationProvenance}]});
  expect(jobs).toHaveLength(100);
  const context = json({checkedAt: CURRENT_AT, sourceId: plan.source.id, sourceConfigSha256: sourcePlanConfigSha256(plan),
    jobs, firstAccepted: row, latestAccepted: row, candidateRow: registration(), sourceRow, companyRow});
  await writeFile(join(fixture.root, 'baseline-context.json'), JSON.stringify(context, null, 2), {flag: 'wx', mode: 0o600});
  return context;
}

function publication(fixture: Awaited<ReturnType<typeof capture>>, source = fixture.source,
  context = baselineContext): DbStartedCloudPublicationInput {
  return {control: {projectId: 'yiopvxysxrtrnvqxwgbx', build, candidate, databaseIdentity, planned: fixture.planned, context},
    source, jobProjectionDelta: true, publicationDeadline: Date.parse(CURRENT_AT) + 20 * 60_000};
}

async function compileAndRetain(fixture: Awaited<ReturnType<typeof capture>>, source = fixture.source) {
  const input = publication(fixture, source), before = JSON.stringify(input);
  const packet = await compileDbStartedCloudSourcePublication(input);
  expect(JSON.stringify(input)).toBe(before);
  await writeFile(join(fixture.root, 'compiled-publication.sql'), packet.sql, {flag: 'wx', mode: 0o600});
  await writeFile(join(fixture.root, 'compiled-source-result.json'), JSON.stringify(packet.commit.sourceResult, null, 2), {flag: 'wx', mode: 0o600});
  const row = unwrapJobProjectionSourceRow(packet.commit.sourceResult as unknown as Record<string, unknown>);
  expect(row).toMatchObject({completenessState: 'VERIFIED', atomicCommitState: 'COMMITTED', dedupeOutputCount: 1,
    completenessCertificate: {grade: GRADE, schemaVersion: SCHEMA}, baselinePreviousJobCount: 100,
    baselinePreviousSourceResultId: baseline.source.pending.id,
    baselineChangeReason: GRADE === 'A' ? 'OFFICIAL_EVIDENCE_CONFIRMED_DECREASE' : 'INDEPENDENT_VALIDATION_CONFIRMED_DECREASE'});
  expect(row.blockerCode ?? null).toBeNull();
  expect(packet.sql).toContain('CRAWL_LEASE_BUSY');
  expect(packet.sql).toContain('PILOT_V75_FENCE_FUNCTION_DRIFT');
  expect(packet.sql).toContain('PILOT_V75_FENCE_TRIGGER_DRIFT');
  expect(packet.sql).toContain('LOCK TABLE public."Job",public."CrawlBatchSourceResult",public."CrawlBatch"');
  expect(packet.sql).toContain(SCHEMA);
  expect(packet.sql).not.toContain('plan-bound-source-quality-v1');
  expect(packet.commit.commands.filter(command => command.type === 'UPSERT_JOB' && command.missingSuccessfulCrawlCount === 0)).toHaveLength(1);
  expect(packet.commit.commands.filter(command => command.type === 'UPSERT_JOB' && command.missingSuccessfulCrawlCount === 1)).toHaveLength(99);
  return packet;
}

beforeAll(async () => {
  const external = process.env.SHARED_GUARD_EVIDENCE_ROOT;
  if (!external || !isAbsolute(external)) throw Error('SHARED_GUARD_EXTERNAL_EVIDENCE_ROOT_REQUIRED');
  evidenceRoot = await realpath(external);
  if (contains(await realpath(CANDIDATE_ROOT), evidenceRoot)) throw Error('SHARED_GUARD_EVIDENCE_MUST_BE_OUTSIDE_CANDIDATE');
  if (await realpath(process.execPath) !== await realpath(PINNED_NODE)) throw Error('SHARED_GUARD_PINNED_RUNTIME_REQUIRED');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).trim();
  if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: ROOT, encoding: 'utf8'}).trim()) {
    throw Error('SHARED_GUARD_CLEAN_NEW_HEAD_REQUIRED');
  }
  build = createBuildIdentity(ROOT, head);
  expectation = deriveCurrentStagedScheduleExpectation(build);
  plan = expectation.plans.find(value => value.source.id === SOURCE_ID)!;
  expect(plan).toBeDefined();
  expect(CLOUD_PILOT_SOURCE.id).toBe(SOURCE_ID);
  expect(CLOUD_PILOT_SOURCE.sourceConfigSha256).toBe(sourcePlanConfigSha256(plan));
  vi.useFakeTimers({toFake: ['Date']});
  vi.stubGlobal('fetch', async () => {throw Error('SHARED_AB_NETWORK_FORBIDDEN');});
  baseline = await capture(100, BASELINE_AT);
  baselineContext = await contextFor(baseline);
  verifiedBaseline = await loadPilotContext(baselineContext, plan, true);
  // Count is read from the issued-and-reverified persisted proof, never supplied
  // directly to evaluateCompletenessAnomalyForCrawl or the DB-started compiler.
  expect(verifiedBaseline.trustedCompletenessBaseline).toMatchObject({certificateGrade: GRADE,
    certifiedJobCount: 100, sourceResultId: baseline.source.pending.id});
  await writeFile(join(baseline.root, 'run-identity.json'), JSON.stringify({syntheticOnly: true, sqlDispatched: false,
    sourceId: SOURCE_ID, grade: GRADE, build, node: process.execPath, candidate, databaseIdentity}, null, 2), {flag: 'wx', mode: 0o600});
}, 180_000);

beforeEach(() => vi.setSystemTime(CURRENT_AT));
afterAll(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

describe(`shared completeness guard: genuine ${GRADE} proof compatibility`, () => {
  it('retains the original certified A/B exception for a verified 100-to-1 drop with no caller hint', async () => {
    const current = await capture(1);
    expect(current.source).not.toHaveProperty('completenessAnomalyTriggerCodes');
    expect(current.source).not.toHaveProperty('sourceAdmissionPolicy');
    expect(evaluateCompletenessAnomalyForCrawl(plan, current.source.result, verifiedBaseline.trustedCompletenessBaseline))
      .toMatchObject({independentValidationRequired: true, triggerCodes: ['TRUSTED_COUNT_DROP'],
        countChange: {previous: 100, current: 1, decrease: 99, decreasePercent: 99}});
    await compileAndRetain(current);
  });

  it('also preserves certified A/B semantics with explicit, duplicate and additional anomaly hints', async () => {
    const current = await capture(1);
    await compileAndRetain(current, {...current.source,
      completenessAnomalyTriggerCodes: ['TRUSTED_COUNT_DROP', 'PAGINATION_MAX_PAGES_WITH_NEXT', 'TRUSTED_COUNT_DROP']});
  });

  it('retains rejection of a supplied empty anomaly list', async () => {
    const current = await capture(1);
    await expect(compileDbStartedCloudSourcePublication(publication(current,
      {...current.source, completenessAnomalyTriggerCodes: []}))).rejects.toThrow('completeness anomaly trigger codes are empty or invalid');
  });

  it.each(['hash', 'source-config', 'receipt-tuple'] as const)('does not trust a %s mismatch in either accepted SQL row', async mutation => {
    const current = await capture(1);
    for (const side of ['firstAccepted', 'latestAccepted'] as const) {
      const invalid = json(baselineContext);
      const row = invalid[side] as unknown as Record<string, unknown>;
      if (mutation === 'hash') row.completenessCertificateSha256 = 'f'.repeat(64);
      if (mutation === 'source-config') row.sourceConfigHash = 'f'.repeat(64);
      if (mutation === 'receipt-tuple') row.id = 'synthetic-mismatched-result';
      await expect(loadPilotContext(invalid, plan, true), `${side}/${mutation}`).rejects.toThrow();
      await expect(compileDbStartedCloudSourcePublication(publication(current, current.source, invalid)), `${side}/${mutation}`).rejects.toThrow();
    }
  });

  it('does not convert absent current independent proof into a successful publication', async () => {
    const current = await capture(1);
    const invalid: DbStartedCloudSourceInput = GRADE === 'A' ? {...current.source,
      artifacts: current.source.artifacts.filter(artifact => artifact.logicalKey !== current.source.result.fetchEvidence!.declaredCompleteness!.artifactLogicalKey)}
      : {...current.source, independentTraversalValidation: undefined};
    const commit = buildAtomicRuntimeCommit({...invalid, ...verifiedBaseline, completenessAnomalyTriggerCodes: ['TRUSTED_COUNT_DROP']});
    expect(commit.sourceResult.completenessState).not.toBe('VERIFIED');
    expect(commit.sourceResult).toMatchObject({blockerCode: 'COMPLETENESS_ANOMALY_UNVERIFIED', completenessCertificate: null});
    expect(commit.commands.filter(command => command.type === 'UPSERT_JOB')).toHaveLength(0);
    await expect(compileDbStartedCloudSourcePublication(publication(current, invalid))).rejects.toThrow('PILOT_REAL_CERTIFICATE_REQUIRED');
  });

  it('does not certify current evidence against a different pending source configuration', async () => {
    const current = await capture(1);
    const invalid = {...current.source, pending: {...current.source.pending, sourceConfigHash: 'f'.repeat(64)}};
    await expect(compileDbStartedCloudSourcePublication(publication(current, invalid))).rejects.toThrow('PILOT_REAL_CERTIFICATE_REQUIRED');
  });

  if (GRADE === 'B') {
    it('rejects an independently observed set that does not match the current traversal', async () => {
      const current = await capture(1);
      const invalid = {...current.source, independentTraversalValidation: takedaValidation(1, CURRENT_AT, 1)};
      await expect(compileDbStartedCloudSourcePublication(publication(current, invalid))).rejects.toThrow('PILOT_REAL_CERTIFICATE_REQUIRED');
    });

    it('requires current-run independent validation for an anomaly instead of reusing old validation', async () => {
      const current = await capture(1);
      await expect(compileDbStartedCloudSourcePublication(publication(current,
        {...current.source, independentTraversalValidationExecution: 'REUSED'}))).rejects.toThrow('PILOT_REAL_CERTIFICATE_REQUIRED');
    });

    it('does not accept a B baseline without its exact independent persisted observation', async () => {
      const current = await capture(1), invalid = json(baselineContext);
      invalid.latestAccepted.observations = [];
      await expect(compileDbStartedCloudSourcePublication(publication(current, current.source, invalid)))
        .rejects.toThrow('PILOT_B_BASELINE_OBSERVATION_REQUIRED');
    });
  }
});
