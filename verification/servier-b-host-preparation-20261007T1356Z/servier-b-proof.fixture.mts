/** Entirely synthetic fixtures. Mock responses never contact an official service. */
import assert from 'node:assert/strict';
import { createHash, createCipheriv } from 'node:crypto';
import { candidateCompanies } from '../../producer/src/data/companyRegistry.ts';
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from '../../producer/src/crawler/sourcePlan.ts';
import { createMokaSourceFetch } from '../../producer/src/crawler/mokaSourceFetch.ts';
import { runSourceCrawl } from '../../producer/src/crawler/runSourceCrawl.ts';
import { captureServierIndependentDetails } from '../../producer/src/crawler/servierMokaRenderedTraversal.ts';
import { createOfficialJsonRenderedTraversalValidation } from '../../producer/src/crawler/traversalCertificate.ts';
import { buildPendingRuntimeBatch, buildAtomicRuntimeCommit } from '../../producer/src/crawler/runtimeAtomicEvidence.ts';
import { canonicalStringSetSha256, sha256Bytes } from '../../producer/src/crawler/sourceFetchEvidence.ts';
import { buildJobProjectionDeltaReceipt } from '../../producer/src/db/jobProjectionDeltaCompiler.ts';
import { hashProjectionJson } from '../../producer/src/domain/jobProjectionDeltaReceipt.ts';
import { compileAtomicJsonDeclarations } from '../../producer/src/db/atomicJsonDeclarations.ts';

export const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function syntheticEncrypted(value: unknown) {
  const cipher = createCipheriv('aes-128-cbc', Buffer.from('abcdef0123456789'), Buffer.from('0123456789abcdef'));
  return JSON.stringify({ data: cipher.update(JSON.stringify(value), 'utf8', 'base64') + cipher.final('base64'), necromancer: 'abcdef0123456789' });
}
export function rehashTerminal(terminal: any, inner = true) {
  if (inner) terminal.completenessCertificate.legacyCertificateSha256 = hashProjectionJson(terminal.completenessCertificate.legacyCertificate);
  terminal.completenessCertificateSha256 = hashProjectionJson(terminal.completenessCertificate);
}
export async function makeServierFixture(options: {
  now?: Date; total?: number; domAgeMs?: number; mainAgeMs?: number; validationRemainingMs?: number;
} = {}) {
  const now = options.now ?? new Date('2026-10-07T14:00:00.000Z');
  const time = (before: number) => new Date(now.getTime() - before).toISOString();
  const domAt = time(options.domAgeMs ?? 15 * 60_000), mainStarted = time(options.mainAgeMs ?? 10 * 60_000);
  const mainAt = new Date(Date.parse(mainStarted) + 60_000).toISOString();
  const detailAt = new Date(Date.parse(domAt) + 30_000).toISOString(), finishedAt = time(60_000);
  const source = 'source-servier-china-social', total = options.total ?? 3;
  const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === source)!;
  assert.equal(sourcePlanConfigSha256(plan), '3c87c89d3bdc74275a0b66a9a27a9eaf76f99da8ee7aa3af835eb87e2b028e17');
  const entry = 'https://app.mokahr.com/social-recruitment/shiweiya/47734';
  const rows = Array.from({ length: total }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    orgId: 'shiweiya', title: `Synthetic role ${index + 1}`, status: 'open',
    publishedAt: '2026-10-03T12:00:00', showIsCampus: false
  }));
  const details = rows.map((row, index) => ({ ...row, showIsCampus: true, closedAt: null,
    jobDescription: 'Synthetic responsibilities and requirements. This is a local test fixture only.',
    locations: index === 0 ? [] : [{ country: '中国', countryDescription: '中国', cityName: '北京市', cityId: 110000, provinceName: '北京市' }],
    locDepCampusList: [{ locationIds: index === 0 ? [] : [110000] }], customFields: {}
  }));
  let mockRequestCount = 0;
  const mockHttp = (capturedAt: string) => async (request: any) => {
    mockRequestCount++;
    assert.ok(request.url === entry || request.url === 'https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2' || request.url === 'https://app.mokahr.com/api/outer/ats-apply/website/job');
    const offset = Number(request.body?.offset ?? 0);
    const body = request.method === 'GET'
      ? `<input id="init-data" value='${JSON.stringify({ aesIv: '0123456789abcdef', mode: 'social', siteId: '47734', org: { id: 'shiweiya' } })}'>`
      : syntheticEncrypted({ success: true, data: request.url.endsWith('jobs/v2')
        ? { jobStats: { orgId: 'shiweiya', total }, jobs: rows.slice(offset, offset + 50) }
        : details.find(row => row.id === request.body?.jobId) });
    return { status: 200, body, finalUrl: request.url, contentType: request.method === 'GET' ? 'text/html' : 'application/json', capturedAt };
  };
  const fetched = await createMokaSourceFetch({ http: mockHttp(mainAt), now: () => new Date(mainAt) })(plan);
  const result = await runSourceCrawl(plan, { fetch: async () => fetched });
  assert.equal(result.status, 'SUCCESS', result.status === 'FAILED' ? result.failureReason : undefined);
  const dom = { schemaVersion: 'servier-cua-dom-list-v1' as const, observedAt: domAt,
    pages: Array.from({ length: Math.ceil(total / 30) }, (_, index) => ({
      url: `${entry}#/jobs?page=${index + 1}&pageSize=30`, capturedAt: domAt,
      summaryText: `已选 0 条件 | ${total} 结果`, pageNumber: index + 1, pageSize: 30, selectedFilters: [],
      nextDisabled: index === Math.ceil(total / 30) - 1,
      paginationHtml: `<button class="sd-Pagination-is-active">${index + 1}</button><button class="sd-Pagination-forward"${index === Math.ceil(total / 30) - 1 ? ' disabled' : ''}></button>`,
      rows: rows.slice(index * 30, (index + 1) * 30).map(row => ({ href: `#/job/${row.id}`, titleHtml: `<span>${row.title}</span>`, publishedHtml: '<span>发布于 2026-10-03</span>' }))
    })) };
  const captured = await captureServierIndependentDetails({ dom, http: mockHttp(detailAt), now: () => new Date(detailAt) });
  const validation = createOfficialJsonRenderedTraversalValidation({ sourceId: source, companyId: plan.company.id,
    sourceConfigSha256: sourcePlanConfigSha256(plan), surfaceIds: [plan.source.surfaceId!], channelIds: plan.expectedChannels!.map(c => c.channelId),
    pages: captured.pages, observedAt: captured.observedAt,
    expiresAt: options.validationRemainingMs === undefined ? new Date(Date.parse(domAt) + 7 * 86400_000).toISOString()
      : new Date(now.getTime() + options.validationRemainingMs).toISOString() });
  const batchId = 'synthetic-servier-b-proof', digest = 'a'.repeat(64);
  const identity = { releaseCandidateId: 'synthetic-servier-candidate', commitSha: '28402a299bb04cbf5873da66c2fe8ca76827c0d1',
    rosterSha256: digest, sourcePlanSha256: digest, sourceConfigSha256: digest, adapterBundleSha256: digest,
    batchKind: 'SCHEDULED' as const, ownerId: 'synthetic-servier-owner', expectedPlannedSourceIds: [source],
    expectedPlannedSourceSetSha256: canonicalStringSetSha256([source]), expectedPlannedSourceCount: 1 };
  const pending = buildPendingRuntimeBatch(batchId, [plan], identity, new Date(mainStarted)).sources[0]!;
  const artifacts = result.fetchEvidence!.artifacts.map(a => ({
    id: a.id, logicalKey: a.logicalKey, releaseCandidateId: identity.releaseCandidateId, batchId, sourceId: source, sourceResultId: pending.id,
    kind: a.kind, ...(a.requestedUrl ? { requestedUrl: a.requestedUrl } : {}), ...(a.finalUrl ? { finalUrl: a.finalUrl } : {}),
    ...(a.httpStatus ? { httpStatus: a.httpStatus } : {}), ...(a.contentType ? { contentType: a.contentType } : {}),
    capturedAt: new Date(a.capturedAt), ...sha256Bytes(typeof a.body === 'string' ? Buffer.from(a.body) : a.body),
    path: `synthetic-only/${a.logicalKey}.json`, extractorLocator: a.extractorLocator,
    captureToolName: result.fetchEvidence!.captureTool.name, captureToolVersion: result.fetchEvidence!.captureTool.version
  }));
  const commit = buildAtomicRuntimeCommit({ plan, pending, identity, batchId, result, artifacts, previousJobs: [], baselineCompletedBeforeCrawl: false,
    independentTraversalValidation: validation, independentTraversalValidationExecution: 'CURRENT_RUN',
    independentTraversalValidationTrigger: 'INITIAL_QUALIFICATION', completedAt: new Date(finishedAt) });
  assert.equal(commit.sourceResult.completenessState, 'VERIFIED');
  const delta = buildJobProjectionDeltaReceipt({ sourceResult: commit.sourceResult, commands: commit.commands, previousAccepted: null,
    projectionForCommand: command => ({ ...command.record, dedupeKey: command.dedupeKey, city: command.record.cities[0],
      sourceJobId: command.record.sourceJobId ?? null, listUrl: command.record.listUrl ?? null,
      officialPublishedAt: command.record.officialPublishedAt ?? null, missingSuccessCount: command.missingSuccessfulCrawlCount,
      lifecycleStatus: command.lifecycleStatus, visibleInFrontend: command.visibleInFrontend, isNew: command.isNew }) });
  const terminal = JSON.parse(JSON.stringify({ ...commit.sourceResult, completenessCertificate: delta.receipt, completenessCertificateSha256: delta.sha256 }));
  return { terminal, validation, now, mockRequestCount, lossLedger: commit.lossLedger };
}

export function makeSyntheticRequest(terminal: any, expiresAt: string) {
  const label = '$atomic_' + 'a'.repeat(32) + '$';
  const sql = `SET LOCAL statement_timeout = '120000ms';\nDO ${label}\nDECLARE affected bigint; job_data jsonb; ${compileAtomicJsonDeclarations(terminal, { syntheticOnly: true })} current_context jsonb; current_count bigint; current_hash text; aggregate_hash text;\nBEGIN\nPERFORM 1;\nEND;\n${label};`;
  const body = { kind: 'PUBLISH', requestId: '00000000-0000-4000-8000-000000000001', expiresAt,
    payload: { projectId: 'yiopvxysxrtrnvqxwgbx', sql } };
  return { ...body, requestSha256: sha(JSON.stringify(body)) };
}
