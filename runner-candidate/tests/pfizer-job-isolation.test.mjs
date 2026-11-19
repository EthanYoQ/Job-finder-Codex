import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {identityForSource, loadDirectPlans} from '../scripts/direct-round.ts';
import {runP0CrawlBatch} from '../src/crawler/runCrawlBatch.ts';
import {withPortableCrawlLease} from '../src/crawler/portableCrawlLease.ts';
import {memoryDb} from './memory-db.mjs';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
import {
  createPfizerOfficialPortalSourceFetch,
  PFIZER_OFFICIAL_PORTAL_API,
  PFIZER_OFFICIAL_PORTAL_CONFIG,
  PFIZER_OFFICIAL_PORTAL_ENTRY,
  validateStrictPfizerOfficialPortalEvidence
} from '../src/crawler/pfizerOfficialPortalSourceFetch.ts';
import {validateStrictPfizerOfficialPortalEvidence as validateStrictPfizerOfficialPortalEvidenceWeb} from '../../web-candidate/src/crawler/pfizerOfficialPortalSourceFetch.ts';
import {issueAGradeOfficialTotalCertificate,verifyAGradeCompletenessCertificateReceipt} from '../src/crawler/completenessCertificate.ts';
import {CITY_PENDING} from '../src/domain/jobLocation.ts';

const at='2026-11-06T04:00:00.000Z';
function portalRow(n, overrides = {}) {
  const reqId = String(9000000 + n);
  const externalPath = `/job/China---Shanghai/Medical-Lead_${reqId}`;
  return {
    jobRequisitionId: reqId,
    title: `Official Portal Role ${n}`,
    External_Posting: '1',
    detailPageUrl: `/about/careers/job/${reqId}?langcode=${PFIZER_OFFICIAL_PORTAL_CONFIG.langcode}`,
    Country: 'China',
    locationCountry: 'China',
    External_Posting_URL: `https://pfizer.wd1.myworkdayjobs.com/PfizerCareers${externalPath}`,
    startDate: '2026-11-18',
    jobDescription: '<p>Lead medical affairs and scientific engagement across mainland China regions.</p>',
    primaryLocation: 'China - Shanghai - STIT',
    locations: 'China - Shanghai - STIT',
    ...overrides
  };
}

function portalPagePayload(page, total, rows) {
  if (total === 0) {
    return {
      status: 200,
      data: {
        data: 'No jobs found',
        count: 0,
        total_count: 0,
        dependant_filters: page === 1 ? { region: { China: 'China (0)' } } : [],
        keyword_search: ''
      }
    };
  }
  const totalPages = Math.ceil(total / PFIZER_OFFICIAL_PORTAL_CONFIG.pageSize);
  return {
    status: 200,
    data: {
      data: rows,
      count: rows.length,
      total_count: totalPages,
      dependant_filters: { region: { China: `China (${total})` } },
      keyword_search: ''
    }
  };
}

test('Pfizer official portal multi-page fetch passes runner/web replay and A-grade certification without Workday HTTP calls', async () => {
  const { plan, sourceConfigSha256 } = (await loadDirectPlans()).find(p => p.sourceId === 'source-pfizer-china-social');
  assert.equal(plan.source.atsKind, 'OFFICIAL_JSON');
  assert.equal(plan.source.officialEntryUrl, PFIZER_OFFICIAL_PORTAL_ENTRY);

  const rows = Array.from({ length: 52 }, (_, i) => {
    if (i === 1) {
      return portalRow(i, {
        primaryLocation: 'CHN - SD - Shandong',
        locations: 'CHN - SD - Shandong'
      });
    }
    if (i === 2) {
      return portalRow(i, {
        primaryLocation: 'China - Hubei - China - Tier 3',
        locations: 'China - Hubei - China - Tier 3;China - Hubei - Wuhan'
      });
    }
    return portalRow(i);
  });

  const requestedPages = [];
  let clock = Date.parse(at);
  const fetchPortal = createPfizerOfficialPortalSourceFetch({
    now: () => new Date(clock += 50),
    http: async req => {
      assert.equal(req.url, PFIZER_OFFICIAL_PORTAL_API);
      assert.equal(req.method, 'POST');
      const { page } = JSON.parse(req.body);
      requestedPages.push(page);
      const slice = rows.slice((page - 1) * 50, page * 50);
      const body = page <= 2
        ? portalPagePayload(page, rows.length, slice)
        : portalPagePayload(page, 0, []);
      return {
        status: 200,
        finalUrl: req.url,
        contentType: 'application/json; charset=utf-8',
        capturedAt: new Date(clock += 50).toISOString(),
        body: JSON.stringify(body)
      };
    }
  });

  const result = await runSourceCrawl(plan, { fetch: fetchPortal, isBaseline: false });
  assert.deepEqual(requestedPages, [1, 2, 3]);
  assert.equal(result.status, 'SUCCESS', JSON.stringify(result.observation));
  assert.equal(result.truth.completenessVerified, true);
  assert.equal(result.jobs.length, 52);
  const firstExternalPath = new URL(rows[0].External_Posting_URL).pathname.replace(/^\/PfizerCareers/u, '');
  assert.equal(
    result.jobs[0].sourceJobId,
    `workday:sha256:${createHash('sha256').update(firstExternalPath).digest('hex')}`
  );
  assert.deepEqual(result.jobs[0].cities, ['上海']);
  assert.deepEqual(result.jobs[1].cities, [CITY_PENDING]);
  assert.deepEqual(result.jobs[2].cities, [CITY_PENDING]);

  assert.equal(validateStrictPfizerOfficialPortalEvidence(plan, result.fetchEvidence, result.jobs), true);
  assert.equal(validateStrictPfizerOfficialPortalEvidenceWeb(plan, result.fetchEvidence, result.jobs), true);

  const officialArtifact = result.fetchEvidence.artifacts.find(a => a.logicalKey === result.fetchEvidence.declaredCompleteness.artifactLogicalKey);
  const binding = { releaseCandidateId: 'synthetic-pfizer-portal', batchId: 'b-portal', sourceResultId: 'sr-portal', sourceConfigSha256 };
  const decision = issueAGradeOfficialTotalCertificate({
    binding,
    plan,
    transportSuccess: true,
    adapterSuccess: true,
    evidence: result.fetchEvidence,
    paginationEvaluation: result.paginationEvaluation,
    reconciliation: result.reconciliation,
    jobs: result.jobs,
    officialArtifactSha256: createHash('sha256').update(officialArtifact.body).digest('hex')
  });
  assert.equal(decision.status, 'CERTIFIED', JSON.stringify(decision));
  assert.equal(
    verifyAGradeCompletenessCertificateReceipt({
      certificate: JSON.parse(JSON.stringify(decision.certificate)),
      certificateSha256: decision.certificateSha256,
      expected: { ...binding, sourceId: plan.source.id }
    }).status,
    'PASS'
  );

  const tampered = structuredClone(result.fetchEvidence);
  const report = tampered.artifacts.find(a => a.logicalKey === 'pfizer-official-portal-binding-report');
  const parsedReport = JSON.parse(report.body);
  parsedReport.total = 999;
  report.body = JSON.stringify(parsedReport);
  assert.equal(validateStrictPfizerOfficialPortalEvidence(plan, tampered, result.jobs), false);
  assert.equal(validateStrictPfizerOfficialPortalEvidenceWeb(plan, tampered, result.jobs), false);
});

test('Pfizer official portal handles verified China (0) empty list without terminal page', async () => {
  const { plan, sourceConfigSha256 } = (await loadDirectPlans()).find(p => p.sourceId === 'source-pfizer-china-social');
  const requestedPages = [];
  let clock = Date.parse(at);
  const fetchPortal = createPfizerOfficialPortalSourceFetch({
    now: () => new Date(clock += 50),
    http: async req => {
      const { page } = JSON.parse(req.body);
      requestedPages.push(page);
      return {
        status: 200,
        finalUrl: req.url,
        contentType: 'application/json',
        capturedAt: new Date(clock += 50).toISOString(),
        body: JSON.stringify(portalPagePayload(1, 0, []))
      };
    }
  });

  const result = await runSourceCrawl(plan, { fetch: fetchPortal, isBaseline: false });
  assert.deepEqual(requestedPages, [1]);
  assert.equal(result.truth.completenessVerified, true);
  assert.equal(result.jobs.length, 0);
  assert.equal(validateStrictPfizerOfficialPortalEvidence(plan, result.fetchEvidence, result.jobs), true);
  assert.equal(validateStrictPfizerOfficialPortalEvidenceWeb(plan, result.fetchEvidence, result.jobs), true);

  const officialArtifact = result.fetchEvidence.artifacts.find(a => a.logicalKey === result.fetchEvidence.declaredCompleteness.artifactLogicalKey);
  const binding = { releaseCandidateId: 'synthetic-pfizer-empty', batchId: 'b-empty', sourceResultId: 'sr-empty', sourceConfigSha256 };
  const decision = issueAGradeOfficialTotalCertificate({
    binding,
    plan,
    transportSuccess: true,
    adapterSuccess: true,
    evidence: result.fetchEvidence,
    paginationEvaluation: result.paginationEvaluation,
    reconciliation: result.reconciliation,
    jobs: result.jobs,
    officialArtifactSha256: createHash('sha256').update(officialArtifact.body).digest('hex')
  });
  assert.equal(decision.status, 'CERTIFIED', JSON.stringify(decision));
});

test('Pfizer official portal surfaces retryable 429/503 transport failures and rejects oversized responses', async () => {
  const { plan } = (await loadDirectPlans()).find(p => p.sourceId === 'source-pfizer-china-social');
  const rateLimited = await createPfizerOfficialPortalSourceFetch({
    now: () => new Date(at),
    http: async req => ({
      status: 429,
      finalUrl: req.url,
      contentType: 'text/html',
      capturedAt: at,
      body: 'Rate limited',
      retryAfter: { value: '120', delayMs: 120_000 }
    })
  })(plan);
  assert.equal(rateLimited.ok, false);
  assert.deepEqual(rateLimited.transportFailure, {
    code: 'OFFICIAL_HTTP_429',
    retryable: true,
    retryAfterMs: 120_000,
    stage: 'ENTRY'
  });
  assert.equal(rateLimited.fetchEvidence.artifacts[0].httpStatus, 429);
  assert.equal(rateLimited.fetchEvidence.artifacts[0].body, 'Rate limited');

  const unavailable = await createPfizerOfficialPortalSourceFetch({
    now: () => new Date(at),
    http: async req => ({
      status: 503,
      finalUrl: req.url,
      contentType: 'text/plain',
      capturedAt: at,
      body: 'Service Unavailable'
    })
  })(plan);
  assert.equal(unavailable.ok, false);
  assert.deepEqual(unavailable.transportFailure, {
    code: 'OFFICIAL_HTTP_503',
    retryable: true,
    stage: 'ENTRY'
  });
  assert.equal(unavailable.fetchEvidence.artifacts[0].httpStatus, 503);

  const oversized = await createPfizerOfficialPortalSourceFetch({
    now: () => new Date(at),
    http: async req => ({
      status: 200,
      finalUrl: req.url,
      contentType: 'application/json',
      capturedAt: at,
      body: 'x'.repeat(4 * 1024 * 1024 + 1)
    })
  })(plan);
  assert.equal(oversized.ok, false);
  assert.equal(oversized.failureReason, 'PFIZER_OFFICIAL_PORTAL_INVALID');
});

test('Pfizer official portal rejects structural drift, duplicates, short pages, and non-empty terminals', async () => {
  const { plan } = (await loadDirectPlans()).find(p => p.sourceId === 'source-pfizer-china-social');
  const make52 = () => Array.from({ length: 52 }, (_, i) => portalRow(i));

  const cases = {
    drift: page => page === 1
      ? portalPagePayload(1, 52, make52().slice(0, 50))
      : portalPagePayload(2, 51, make52().slice(50, 51)),
    dupReqId: () => {
      const r = make52().slice(0, 2);
      r[1] = portalRow(0, { External_Posting_URL: r[1].External_Posting_URL.replace(r[1].jobRequisitionId, r[0].jobRequisitionId) });
      return portalPagePayload(1, 2, r);
    },
    dupUrl: () => ({
      status: 200,
      data: {
        data: [portalRow(0), portalRow(1, { jobRequisitionId: 'invalid', External_Posting_URL: portalRow(0).External_Posting_URL })],
        count: 2,
        total_count: 1,
        dependant_filters: { region: { China: 'China (2)' } },
        keyword_search: ''
      }
    }),
    shortPage: () => ({
      status: 200,
      data: {
        data: make52().slice(0, 49),
        count: 49,
        total_count: 2,
        dependant_filters: { region: { China: 'China (52)' } },
        keyword_search: ''
      }
    }),
    nonEmptyTerminal: page => page === 1
      ? portalPagePayload(1, 2, make52().slice(0, 2))
      : {
          status: 200,
          data: {
            data: [portalRow(99)],
            count: 1,
            total_count: 1,
            dependant_filters: [],
            keyword_search: ''
          }
        }
  };

  for (const [name, respond] of Object.entries(cases)) {
    const res = await createPfizerOfficialPortalSourceFetch({
      now: () => new Date(at),
      http: async req => {
        const { page } = JSON.parse(req.body);
        return {
          status: 200,
          finalUrl: req.url,
          contentType: 'application/json',
          capturedAt: at,
          body: JSON.stringify(respond(page))
        };
      }
    })(plan);
    assert.equal(res.ok, false, `${name} must be rejected`);
    assert.equal(res.failureReason, 'PFIZER_OFFICIAL_PORTAL_INVALID', name);
  }
});

test('Pfizer official portal isolates a single malformed/foreign row via A-grade jobQuarantineLedger', async () => {
  const { plan, sourceConfigSha256 } = (await loadDirectPlans()).find(p => p.sourceId === 'source-pfizer-china-social');
  const rows = [
    portalRow(0),
    portalRow(1, { Country: 'Japan', locationCountry: 'Japan' }),
    portalRow(2)
  ];
  let clock = Date.parse(at);
  const fetchPortal = createPfizerOfficialPortalSourceFetch({
    now: () => new Date(clock += 50),
    http: async req => {
      const { page } = JSON.parse(req.body);
      const body = page === 1 ? portalPagePayload(1, 3, rows) : portalPagePayload(2, 0, []);
      return {
        status: 200,
        finalUrl: req.url,
        contentType: 'application/json',
        capturedAt: new Date(clock += 50).toISOString(),
        body: JSON.stringify(body)
      };
    }
  });

  const result = await runSourceCrawl(plan, { fetch: fetchPortal, isBaseline: false });
  assert.equal(result.status, 'SUCCESS', JSON.stringify(result.observation));
  assert.equal(result.truth.completenessVerified, true);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.fetchEvidence.jobQuarantines?.length, 1);
  assert.equal(result.fetchEvidence.jobQuarantines[0].recordIndex, 1);
  assert.equal(validateStrictPfizerOfficialPortalEvidence(plan, result.fetchEvidence, result.jobs), true);

  const officialArtifact = result.fetchEvidence.artifacts.find(a => a.logicalKey === result.fetchEvidence.declaredCompleteness.artifactLogicalKey);
  const binding = { releaseCandidateId: 'synthetic-pfizer-quarantine', batchId: 'b-quarantine', sourceResultId: 'sr-quarantine', sourceConfigSha256 };
  const decision = issueAGradeOfficialTotalCertificate({
    binding,
    plan,
    transportSuccess: true,
    adapterSuccess: true,
    evidence: result.fetchEvidence,
    paginationEvaluation: result.paginationEvaluation,
    reconciliation: result.reconciliation,
    jobs: result.jobs,
    officialArtifactSha256: createHash('sha256').update(officialArtifact.body).digest('hex')
  });
  assert.equal(decision.status, 'CERTIFIED', JSON.stringify(decision));
  assert.equal(decision.certificate.jobQuarantineLedger?.length, 1);

  const tampered = structuredClone(result.fetchEvidence);
  tampered.jobQuarantines[0].recordIndex = 2;
  assert.equal(validateStrictPfizerOfficialPortalEvidence(plan, tampered, result.jobs), false);
});

test('Pfizer official portal batch commits A-grade snapshot and preserves last-good jobs on HTTP 429', async () => {
  const { plan } = (await loadDirectPlans()).find(p => p.sourceId === 'source-pfizer-china-social');
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'pfizer-atomic-'));
  try {
    const candidate = {
      id: 'synthetic-pfizer',
      commitSha: 'a'.repeat(40),
      rosterHash: 'b'.repeat(64),
      sourcePlanHash: 'c'.repeat(64),
      sourceConfigHash: 'd'.repeat(64),
      adapterBundleHash: 'e'.repeat(64)
    };
    let blocked = false;
    const rows = [portalRow(0), portalRow(1), portalRow(2)];
    let clock = Date.parse(at);
    const fetch = createPfizerOfficialPortalSourceFetch({
      now: () => new Date(clock += 50),
      http: async req => {
        if (blocked) {
          return {
            status: 429,
            finalUrl: req.url,
            contentType: 'text/html',
            capturedAt: new Date(clock += 50).toISOString(),
            body: 'Limited',
            retryAfter: { value: '120', delayMs: 120_000 }
          };
        }
        const { page } = JSON.parse(req.body);
        const body = page === 1 ? portalPagePayload(1, rows.length, rows) : portalPagePayload(page, 0, []);
        return {
          status: 200,
          finalUrl: req.url,
          contentType: 'application/json',
          capturedAt: new Date(clock += 50).toISOString(),
          body: JSON.stringify(body)
        };
      }
    });
    const run = (memory, batchId) => withPortableCrawlLease(memory.db, lease => runP0CrawlBatch([plan], {
      db: memory.db,
      identity: identityForSource(candidate, plan.source.id),
      publicationPolicy: 'SOURCE_ATOMIC_LAST_GOOD_V1',
      portableLease: lease,
      workspaceRoot,
      fetch,
      now: () => new Date(),
      createBatchId: () => batchId,
      evidenceSubdirectory: 'e',
      getPreviousJobs: async () => [],
      getRecentObservations: async () => [],
      isBaselineCompleted: async () => false,
      getTrustedCompletenessBaseline: async () => null,
      getFirstAcceptedCurrentPolicyReceipt: async () => null
    }));
    const memory = memoryDb();
    memory.db.crawlBatchSourceResult.findMany = async ({ where }) => memory.rows.filter(row => row.batchId === where.batchId);
    const round = await run(memory, 'b-healthy');
    assert.equal(round.status, 'SUCCESS', JSON.stringify(memory.rows));
    assert.equal(memory.rows[0].atomicCommitState, 'COMMITTED');
    assert.equal(memory.rows[0].completenessState, 'VERIFIED');
    assert.equal(memory.jobWrites(), 3);

    const lastGood = structuredClone(memory.rows[0]);
    blocked = true;
    await run(memory, 'b-blocked');
    const attempt = memory.rows.at(-1);
    assert.equal(attempt.atomicCommitState, 'NOT_ATTEMPTED');
    assert.equal(attempt.failureDiagnosticCode, 'OFFICIAL_HTTP_429');
    assert.deepEqual(memory.rows[0], lastGood);
    assert.equal(memory.jobWrites(), 3);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
