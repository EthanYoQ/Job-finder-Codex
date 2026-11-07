import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans, sourcePlanConfigSha256} from '../src/crawler/sourcePlan.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
import {createOwnedSourceQualityFetch, issueSourceQualityAdmission, SOURCE_QUALITY_POLICY_ID} from '../src/crawler/sourceQualityAdmission.ts';
import {buildSourceQualityJobCommands} from '../src/crawler/sourceQualityPublication.ts';
import {archiveSourceEvidence} from '../src/crawler/artifactArchive.ts';
import {bindRuntimeEvidenceArtifactIds} from '../src/crawler/runtimeAtomicEvidence.ts';
import {buildJobDedupeKey} from '../src/crawler/normalizedJob.ts';
import {replayNovartisNativePartitions} from '../src/crawler/novartisNativePartitions.ts';
import {runP0CrawlBatch} from '../src/crawler/runCrawlBatch.ts';
import {withPortableCrawlLease} from '../src/crawler/portableCrawlLease.ts';
import {identityForSource} from '../scripts/direct-round.ts';
import {memoryDb} from './memory-db.mjs';
import {selectPortableSourceSnapshots, projectPortableSourceJobs} from '../../web-candidate/src/domain/portablePublicSnapshot.ts';

for (const scenario of ['same', 'renamed', 'open-rename']) test(scenario === 'open-rename'
  ? 'Novartis current renamed REQ replaces its old URL while unrelated UNKNOWN stays in grace'
  : `Novartis ${scenario} URL closure persists before later unidentified discovery`, async () => {
  const cache = fileURLToPath(new URL('../../.runtime/.cache/', import.meta.url));
  await mkdir(cache, {recursive: true});
  const workspaceRoot = await mkdtemp(join(cache, 'novartis-closed-'));
  const originalFetch = globalThis.fetch;
  const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === 'source-novartis-social');
  const ids = ['REQ-10000001', 'REQ-10000002', 'REQ-10000003', ...(scenario === 'open-rename' ? ['REQ-10000004'] : [])];
  let mode = 'present';
  const url = id => `https://www.novartis.com.cn/careers/career-search/job/details/${id.toLowerCase()}-${scenario !== 'same' && ['closed', 'renamed'].includes(mode) && id === ids[2] ? 'renamed' : 'original'}`;
  const row = id => `<tr><td class="views-field-field-job-title"><a href="${url(id)}">Job ${id}</a></td><td class="views-field-field-job-country">China</td><td class="views-field-field-job-work-location">Shanghai (Shanghai)</td></tr>`;
  const unidentified = '<tr><td class="views-field-field-job-title">Unavailable job</td><td class="views-field-field-job-country">China</td><td class="views-field-field-job-work-location">Shanghai (Shanghai)</td></tr>';
  const page = rows => `<div class="view-header">Showing ${rows.length} results</div><table class="views-table"><tbody>${rows.join('')}</tbody></table>`;
  globalThis.fetch = async request => {
    const target = new URL(String(request));
    assert.equal(target.origin, 'https://www.novartis.com.cn');
    let body;
    if (target.href === plan.source.officialEntryUrl) {
      body = page(ids.slice(0, 2).map(row)) + '<select name="functional_area[]"><option value="FCT_QA">QA</option></select><select name="country[]"><option value="LOC_CN" selected>China</option></select><select name="field_job_posted_date"><option value="All" selected>All</option></select>';
    } else if (target.searchParams.has('functional_area[0]')) {
      body = page(ids.slice(0, 2).map(row));
    } else if (target.pathname.includes('/job/details/')) {
      const id = ids.slice(2).find(id => target.href === url(id));
      assert.ok(id, target.href);
      body = `<h1>Job ${id}</h1><article>Job ID ${id}<p>${mode === 'closed' ? 'This job is no longer available' : 'A real substantive job description for this identity.'}</p>${['present', 'renamed'].includes(mode) ? `<a href="https://platform.moseeker.com/m/customize/page/novartis?job_number=${id}">Apply to Job</a>` : ''}</article>`;
    } else {
      body = page([...(mode === 'unknown' ? ids.slice(0, 2) : mode === 'renamed' ? ids.slice(0, 3) : ids).map(row), ...(mode === 'present' ? [] : [unidentified])]);
    }
    return {status: 200, url: target.href, headers: new Headers({'content-type': 'text/html'}), text: async () => body};
  };
  try {
    async function capture() {
      const result = await runSourceCrawl(plan, {fetch: createOwnedSourceQualityFetch(), isBaseline: false});
      assert.equal(result.status, 'SUCCESS', JSON.stringify(result.diagnostics));
      const binding = {releaseCandidateId: 'novartis-closure', batchId: `batch-${mode}`, sourceResultId: `result-${mode}`,
        sourceConfigSha256: sourcePlanConfigSha256(plan), adapterVersion: 'a'.repeat(64)};
      const evidenceSubdirectory = 'evidence';
      const archive = await archiveSourceEvidence({workspaceRoot, ...binding, sourceId: plan.source.id, evidenceSubdirectory,
        captureTool: result.fetchEvidence.captureTool,
        artifacts: bindRuntimeEvidenceArtifactIds({...binding, sourceId: plan.source.id, artifacts: result.fetchEvidence.artifacts})});
      const admission = await issueSourceQualityAdmission({plan, result, binding, archive: {workspaceRoot, evidenceSubdirectory, artifacts: archive.artifacts}});
      assert.equal(admission.status, 'ACCEPTED', JSON.stringify(admission));
      return {result, admission};
    }
    const prior = await capture();
    const record = prior.result.jobs.find(job => job.officialUrl === url(ids[2]));
    assert.ok(record);
    const floor = prior.admission.receipt.issuedAt;
    let previous = {record, dedupeKey: buildJobDedupeKey(record), lifecycleStatus: 'ACTIVE', missingSuccessfulCrawlCount: 0,
      firstSeenAt: floor, lastSeenAt: floor};
    const legacyRecord = {...record, officialTitle: 'Legacy job', officialUrl: url('REQ-10000005')};
    const beforeFloor = new Date(Date.parse(floor) - 1000).toISOString();
    const legacy = {record: legacyRecord, dedupeKey: buildJobDedupeKey(legacyRecord), lifecycleStatus: 'ACTIVE',
      missingSuccessfulCrawlCount: 0, firstSeenAt: beforeFloor, lastSeenAt: beforeFloor};
    const firstAcceptedCurrentPolicyReceipt = {receipt: prior.admission.receipt, receiptSha256: prior.admission.receiptSha256,
      expectedBinding: prior.admission.receipt.binding};
    if (scenario === 'open-rename') {
      const unrelatedRecord = prior.result.jobs.find(job => job.officialUrl === url(ids[3]));
      assert.ok(unrelatedRecord);
      const unrelated = {...previous, record: unrelatedRecord, dedupeKey: buildJobDedupeKey(unrelatedRecord)};
      const memory = memoryDb(), writes = [], members = [];
      memory.db.job.upsert = async args => writes.push(args);
      memory.db.lifecycleSetEvidenceMember.create = async ({data}) => members.push(data);
      const candidate = {id: 'novartis-rename', commitSha: 'a'.repeat(40), rosterHash: 'b'.repeat(64),
        sourcePlanHash: 'c'.repeat(64), sourceConfigHash: 'd'.repeat(64), adapterBundleHash: 'e'.repeat(64)};
      mode = 'renamed';
      const result = await withPortableCrawlLease(memory.db, lease => runP0CrawlBatch([plan], {
        db: memory.db, identity: identityForSource(candidate, plan.source.id), now: () => new Date(),
        workspaceRoot, evidenceSubdirectory: 'evidence', publicationPolicy: 'SOURCE_ATOMIC_LAST_GOOD_V1',
        sourceAdmissionPolicy: SOURCE_QUALITY_POLICY_ID, portableLease: lease,
        getPreviousJobs: async () => [previous, unrelated, legacy], getRecentObservations: async () => [],
        isBaselineCompleted: async () => true, getTrustedCompletenessBaseline: async () => null,
        getFirstAcceptedCurrentPolicyReceipt: async () => firstAcceptedCurrentPolicyReceipt, fetch: createOwnedSourceQualityFetch()
      }));
      assert.equal(result.status, 'SUCCESS', JSON.stringify(memory.rows));
      assert.equal(memory.rows[0].atomicCommitState, 'COMMITTED');
      const oldWrite = writes.find(write => write.where.sourceId_dedupeKey.dedupeKey === previous.dedupeKey);
      assert.equal(oldWrite?.update.lifecycleStatus, 'OFFLINE');
      assert.equal(oldWrite.update.lastSeenAt.toISOString(), floor);
      assert.deepEqual(members.filter(member => member.jobKey === previous.dedupeKey), []);
      assert.deepEqual(members.filter(member => member.jobKey === unrelated.dedupeKey).map(member => member.setKind).sort(), ['GRACE', 'VISIBLE']);
      const held = writes.find(write => write.where.sourceId_dedupeKey.dedupeKey === unrelated.dedupeKey);
      assert.equal(held.update.officialUrl, unrelatedRecord.officialUrl);
      assert.equal(held.update.lastSeenAt.toISOString(), floor);
      assert.equal(writes.some(write => write.where.sourceId_dedupeKey.dedupeKey === legacy.dedupeKey), false);
      const current = {...memory.rows[0], batch: memory.batches[0]}, binding = prior.admission.receipt.binding;
      const priorRow = {...current, id: binding.sourceResultId, releaseCandidateId: binding.releaseCandidateId, batchId: binding.batchId,
        startedAt: prior.result.observation.crawledAt, finishedAt: new Date(floor), dedupeOutputCount: prior.result.jobs.length,
        completenessCertificate: prior.admission.receipt, completenessCertificateSha256: prior.admission.receiptSha256,
        batch: {id: binding.batchId, releaseCandidateId: binding.releaseCandidateId, kind: 'SCHEDULED', status: 'SUCCESS'}};
      const options = {currentTime: new Date()};
      const selection = selectPortableSourceSnapshots([plan], [priorRow, current], options)[0];
      const projected = projectPortableSourceJobs(selection, members, writes.map((write, index) => ({id: `job-${index}`, ...write.create, ...write.update})), options);
      assert.equal(projected.state, 'PUBLISHING', projected.reasons.join(','));
      assert.deepEqual(projected.jobs.filter(job => job.officialUrl.includes(ids[2].toLowerCase())).map(job => job.officialUrl), [url(ids[2])]);
      assert.equal(projected.jobs.find(job => job.officialUrl === unrelatedRecord.officialUrl).inGrace, true);
      return;
    }
    for (mode of ['closed', 'unknown']) {
      const current = await capture();
      const replay = replayNovartisNativePartitions(plan, current.result.fetchEvidence);
      assert.equal(replay.unboundUnknown, true);
      assert.equal(replay.closedUrls.size, mode === 'closed' ? 1 : 0);
      const publication = buildSourceQualityJobCommands({plan, ...current, previousJobs: [previous, legacy],
        firstAcceptedCurrentPolicyReceipt, baselineCompletedBeforeCrawl: true});
      const write = publication.jobCommands.find(command => command.dedupeKey === previous.dedupeKey);
      assert.ok(write, `${mode} must persist the previous job lifecycle`);
      assert.equal(write.lifecycleStatus, 'OFFLINE', mode);
      assert.equal(write.visibleInFrontend, false, mode);
      assert.equal(write.lastSeenAt, floor);
      assert.equal(publication.visibilityFloor, floor);
      assert.equal(publication.jobCommands.some(command => command.dedupeKey === legacy.dedupeKey), false);
      assert.equal(publication.jobCommands.filter(command => command.lifecycleStatus === 'ACTIVE').length, 2);
      previous = {record: write.record, dedupeKey: write.dedupeKey, lifecycleStatus: write.lifecycleStatus,
        missingSuccessfulCrawlCount: write.missingSuccessfulCrawlCount, firstSeenAt: write.firstSeenAt, lastSeenAt: write.lastSeenAt};
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, {recursive: true, force: true});
  }
});
