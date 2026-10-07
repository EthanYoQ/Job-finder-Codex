import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeServierFixture, makeSyntheticRequest, rehashTerminal, syntheticEncrypted, sha } from './servier-b-proof.fixture.mts';
import { verifyServierBProof, reviewServierBRequest } from '../../hosts/servier/host/runtime/verify-servier-b-proof.mts';
import { hashProjectionJson } from '../../producer/src/domain/jobProjectionDeltaReceipt.ts';
import { decodeServierArtifact } from '../../producer/src/crawler/servierMokaScope.ts';
import { parseBGradeIndependentTraversalValidation } from '../../producer/src/crawler/traversalCertificate.ts';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const base = await makeServierFixture();
const copy = () => structuredClone(base);
const cert = (f: any) => f.terminal.completenessCertificate.legacyCertificate;
const verify = (f: any) => verifyServierBProof(f.terminal, f.validation, f.now);
function bindValidation(f: any) {
  f.validation.artifactSha256 = hashProjectionJson({ sourceId: f.validation.sourceId, retrievalPath: f.validation.retrievalPath,
    matchKeyKind: f.validation.matchKeyKind, pages: f.validation.pages, observedAt: f.validation.observedAt });
  cert(f).independentValidation = structuredClone(f.validation);
  rehashTerminal(f.terminal);
}
function requestParts(f = copy()) {
  const bytes = Buffer.from(JSON.stringify(f.validation, null, 2));
  const proof = verify(f);
  const bootstrap = { schemaVersion: 1, batchId: f.terminal.batchId,
    independentValidation: { path: join(here, 'synthetic-input-only.json'), sha256: sha(bytes) } };
  return { f, bytes, bootstrap, request: makeSyntheticRequest(f.terminal, proof.publicationExpiresAt) };
}

test('native B issuer and delta builder accept raw=3, included=2, unknown=1 without modifying timestamps', () => {
  const before = JSON.stringify(base);
  const report = verify(base);
  assert.equal(report.status, 'PASS');
  assert.deepEqual([report.rawCount, report.includedMainlandCount, report.unknownGeographyExcludedCount,
    report.finalUniqueJobCount, report.currentMemberCount], [3, 2, 1, 2, 2]);
  assert.notEqual(report.independentObservedAt, report.deltaObservedAt);
  assert.equal(report.publicationExpiresAt, new Date(Date.parse(base.terminal.startedAt) + 1800_000).toISOString());
  assert.equal(base.lossLedger.length, 1);
  assert.equal(JSON.stringify(base), before);
});
test('different main and DOM page sizes remain valid across two DOM pages', async () => {
  const f = await makeServierFixture({ total: 31 });
  assert.equal(f.validation.pages.length, 2);
  assert.equal(cert(f).mainTraversal.pageCount, 1);
  assert.equal(verify(f).includedMainlandCount, 30);
});
test('empty independent object fails before any network request', () => {
  assert.throws(() => verifyServierBProof(base.terminal, {}, base.now));
});
for (const key of ['rawCount', 'parsedCount', 'validCount', 'dedupeOutputCount', 'validationDiscardCount']) {
  test(`reject terminal ${key} mismatch`, () => { const f = copy(); f.terminal[key]++; assert.throws(() => verify(f), /COUNTS/); });
}
test('reject UNKNOWN as final/main unique jobs', () => {
  const f = copy(); for (const key of ['mainUniqueJobCount', 'independentUniqueJobCount', 'finalUniqueJobCount']) cert(f).counts[key]++;
  rehashTerminal(f.terminal); assert.throws(() => verify(f));
});
test('reject introduced normalization loss', () => {
  const f = copy(); f.terminal.normalizationDiscardCount = 1; assert.throws(() => verify(f), /PIPELINE_LOSS/);
});
test('reject A official-total declaration substituted on the B row', () => {
  const f = copy(); f.terminal.expectedJobCount = 3; f.terminal.expectedEvidenceKind = 'OFFICIAL_TOTAL_COUNT';
  assert.throws(() => verify(f), /TRAVERSAL_DECLARATION/);
});
test('reject source config and source tuple drift', () => {
  const f = copy(); f.terminal.sourceConfigHash = 'f'.repeat(64); assert.throws(() => verify(f), /SOURCE_CONFIG/);
  const g = copy(); g.terminal.id += '-other'; assert.throws(() => verify(g), /SOURCE_TUPLE/);
});
test('reject a terminal state other than fully committed and verified', () => {
  const f = copy(); f.terminal.atomicCommitState = 'PENDING'; assert.throws(() => verify(f), /TERMINAL_STATE/);
});
test('reject hash-valid REUSED B proof', () => {
  const f = copy(); cert(f).validationPolicy.execution = 'REUSED'; rehashTerminal(f.terminal);
  assert.throws(() => verify(f), /CURRENT_CERTIFICATE_REQUIRED/);
});
test('reject outer delta hash drift', () => {
  const f = copy(); f.terminal.completenessCertificate.manifestSha256 = 'b'.repeat(64); assert.throws(() => verify(f), /HASH_MISMATCH/);
});
test('reject inner certificate drift even if outer hash is recomputed', () => {
  const f = copy(); cert(f).counts.mainUniqueJobCount++; rehashTerminal(f.terminal, false);
  assert.throws(() => verify(f), /certificate hash mismatch/);
});
test('reject terminal finish timestamp changed outside the delta', () => {
  const f = copy(); f.terminal.finishedAt = f.now.toISOString(); assert.throws(() => verify(f), /BASELINE_TIME_MISMATCH/);
});
test('reject current-set commitment unrelated to native output', () => {
  const f = copy(); f.terminal.canonicalCurrentJobSetSha256 = 'c'.repeat(64); assert.throws(() => verify(f), /commitment mismatch/);
});
test('reject bootstrap validation differing from the B proof', () => {
  const f = copy(); f.validation.expiresAt = new Date(Date.parse(f.validation.expiresAt) - 1000).toISOString();
  assert.throws(() => verify(f), /BOOTSTRAP_VALIDATION_MISMATCH/);
});
test('reject restamped independent observation even with recomputed artifact and certificate hashes', () => {
  const f = copy(); f.validation.observedAt = new Date(Date.parse(f.validation.observedAt) + 1000).toISOString(); bindValidation(f);
  assert.throws(() => verify(f), /first original DOM capture/);
});
test('reject independent receipt body hash mismatch', () => {
  const f = copy(); (f.validation.pages[0] as any).rawRows[0].rawPayload.detailResponse.bodySha256 = 'd'.repeat(64); bindValidation(f);
  assert.throws(() => verify(f), /receipt mismatch/);
});
for (const kind of ['closed', 'foreign']) {
  test(`reject hash-consistent ${kind} detail under unchanged Servier geography/open policy`, () => {
    const f = copy(); const receipt = (f.validation.pages[0] as any).rawRows[1].rawPayload.detailResponse;
    const body: any = decodeServierArtifact(receipt, '0123456789abcdef');
    if (kind === 'closed') body.data.status = 'closed'; else body.data.locations[0].country = '美国';
    receipt.body = syntheticEncrypted(body); receipt.bodySha256 = sha(receipt.body); bindValidation(f);
    assert.throws(() => verify(f), /unresolved|geography/);
  });
}
test('reject missing native terminal Next state', () => {
  const f = copy(); const rows = (f.validation.pages.at(-1) as any).rawRows;
  for (const row of rows) row.rawPayload.domPage.paginationHtml = row.rawPayload.domPage.paginationHtml.replace(' disabled', '');
  bindValidation(f); assert.throws(() => verify(f), /terminal control mismatch/);
});
test('reject original main 30-minute deadline at equality', () => {
  const f = copy(); f.now = new Date(Date.parse(f.terminal.startedAt) + 1800_000);
  assert.throws(() => verify(f), /PUBLICATION_EXPIRED/);
});
test('independent first DOM +1h remains binding while main remains fresh', async () => {
  const f = await makeServierFixture({ domAgeMs: 59 * 60_000, mainAgeMs: 5 * 60_000 });
  const limit = Date.parse(f.validation.observedAt) + 3600_000;
  assert.equal(verify(f).publicationExpiresAt, new Date(limit).toISOString());
  f.now = new Date(limit); assert.throws(() => verify(f), /PUBLICATION_EXPIRED/);
});
test('shorter original validation expiresAt wins without changing observedAt', async () => {
  const f = await makeServierFixture({ validationRemainingMs: 20_000 });
  assert.equal(verify(f).publicationExpiresAt, f.validation.expiresAt);
  f.now = new Date(f.validation.expiresAt); assert.throws(() => verify(f), /VALIDATION_EXPIRED|PUBLICATION_EXPIRED/);
});
test('original validation may be parsed for shape without restamping or declaring current freshness', () => {
  const before = JSON.stringify(base.validation);
  assert.deepEqual(parseBGradeIndependentTraversalValidation(base.validation), base.validation);
  assert.equal(JSON.stringify(base.validation), before);
});
test('packet inspector and byte hash work with independent-only bootstrap', () => {
  const p = requestParts(); const result = reviewServierBRequest(p.request, p.bootstrap, p.bytes, p.f.now);
  assert.equal(result.bProof.status, 'PASS'); assert.equal(result.independentValidationSha256, sha(p.bytes));
  assert.equal('currentCapture' in p.bootstrap, false);
});
test('reject byte hash mismatch before parsing malformed packet', () => {
  const p = requestParts(); assert.throws(() => reviewServierBRequest({}, p.bootstrap, Buffer.from('{}'), p.f.now), /INDEPENDENT_FILE_HASH/);
});
test('reject request hash and bootstrap batch mismatch', () => {
  const p = requestParts(); p.request.requestSha256 = 'e'.repeat(64);
  assert.throws(() => reviewServierBRequest(p.request, p.bootstrap, p.bytes, p.f.now), /PUBLICATION_REQUEST_HASH/);
  const q = requestParts(); q.bootstrap.batchId += '-wrong';
  assert.throws(() => reviewServierBRequest(q.request, q.bootstrap, q.bytes, q.f.now), /BOOTSTRAP_BATCH/);
});
test('accept shortened outer deadline and reject any extension of native proof expiry', () => {
  const p = requestParts(); const shorter = new Date(p.f.now.getTime() + 60_000).toISOString();
  assert.equal(reviewServierBRequest(makeSyntheticRequest(p.f.terminal, shorter), p.bootstrap, p.bytes, p.f.now).bProof.status, 'PASS');
  const longer = new Date(Date.parse(p.request.expiresAt) + 1).toISOString();
  assert.throws(() => reviewServierBRequest(makeSyntheticRequest(p.f.terminal, longer), p.bootstrap, p.bytes, p.f.now), /REQUEST_EXPIRY/);
});
test('installed CLI reads synthetic input, verifies its hash, and emits only the short proof envelope', async () => {
  const f = await makeServierFixture({ now: new Date() }), p = requestParts(f);
  const dir = mkdtempSync(join(here, 'synthetic-cli-'));
  const input = join(dir, 'independent-validation.json'), bootstrapPath = join(dir, 'bootstrap.json'), requestPath = join(dir, 'request.json');
  writeFileSync(input, p.bytes); p.bootstrap.independentValidation.path = input;
  writeFileSync(bootstrapPath, JSON.stringify(p.bootstrap)); writeFileSync(requestPath, JSON.stringify(p.request));
  const result = spawnSync(process.execPath, ['--require', join(here, 'servier-b-proof.offline.cjs'),
    '--import', join(root, 'producer/node_modules/tsx/dist/loader.mjs'), join(root, 'hosts/servier/host/runtime/verify-servier-b-proof.mts'),
    requestPath, bootstrapPath], { encoding: 'utf8', env: { ...process.env, TSX_DISABLE_CACHE: '1', NODE_DISABLE_COMPILE_CACHE: '1' } });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout); assert.equal(output.bProof.status, 'PASS');
  assert.equal(output.bProof.rawCount, 3); assert.equal(output.independentValidationSha256, sha(p.bytes));
  assert.equal(readFileSync(input, 'utf8'), p.bytes.toString());
  assert.equal('certificate' in output, false);
});
