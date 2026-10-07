/** End-to-end local Python review tests. Synthetic SQL text is NEVER executed. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeServierFixture, makeSyntheticRequest, rehashTerminal, sha } from './servier-b-proof.fixture.mts';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const reviewer = join(root, 'hosts/servier/host/runtime/review-publication.py');
const suite = mkdtempSync(join(here, 'synthetic-python-review-'));
const base = await makeServierFixture({ now: new Date() });
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const literal = (value: unknown) => "E'" + JSON.stringify(value).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'::jsonb";
const sqlText = (value: string) => "E'" + value.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
// Same common-object plus indexed-tuples grammar as the frozen sqlRecords helper.
function compactRecords(rows: any[]) {
  const keys = Object.keys(rows[0]), common: any = {}, varying: string[] = [];
  for (const key of keys) {
    if (rows.every(row => JSON.stringify(row[key]) === JSON.stringify(rows[0][key]))) common[key] = rows[0][key];
    else varying.push(key);
  }
  return `(SELECT jsonb_agg(${literal(common)} || jsonb_build_object(${varying.map((key, index) => `${sqlText(key)}, tuple.value->${index}`).join(', ')}) ORDER BY tuple.ordinality)\n    FROM jsonb_array_elements(${literal(rows.map(row => varying.map(key => row[key])))}) WITH ORDINALITY AS tuple(value, ordinality))`;
}
const outcomes: any[] = [];
const originalReviewerSha256 = sha(readFileSync(reviewer));
interface Scenario {
  fixture: any; losses: any[]; members: any[]; archiveBytes: Buffer;
  expiresAt: string; dispatchBefore: string; omitArchive?: boolean; compactMembers?: boolean;
}
const initial = (): Scenario => ({
  fixture: structuredClone(base), losses: JSON.parse(JSON.stringify(base.lossLedger)),
  members: structuredClone(base.terminal.completenessCertificate.members),
  archiveBytes: Buffer.from(json(base.validation)),
  expiresAt: new Date(Date.parse(base.terminal.startedAt) + 1800_000).toISOString(),
  dispatchBefore: new Date(Date.parse(base.terminal.startedAt) + 1600_000).toISOString()
});

function runScenario(name: string, mutate?: (scenario: Scenario) => void) {
  const s = initial(); mutate?.(s);
  const host = join(suite, name), run = join(host, s.fixture.terminal.batchId);
  mkdirSync(join(run, 'relay'), { recursive: true }); mkdirSync(join(run, 'artifacts'));
  const sourceId = s.fixture.terminal.sourceId, candidate = { id: s.fixture.terminal.releaseCandidateId, version: 50 };
  const build = { syntheticOnly: true, commitSha: '28402a299bb04cbf5873da66c2fe8ca76827c0d1' };
  const databaseIdentity = { syntheticOnly: true, purpose: 'NOT_A_DATABASE_BINDING' };
  writeFileSync(join(host, 'SYNTHETIC_ONLY.txt'), 'Local reviewer fixture only. No DB eligibility, no real candidate activation, no SQL execution or dispatch.\n');
  writeFileSync(join(host, 'host-config.json'), json({ root: host, repo: join(root, 'producer'), node: process.execPath,
    project: 'yiopvxysxrtrnvqxwgbx', sourceId, sourceConfigSha256: s.fixture.terminal.sourceConfigHash }));
  writeFileSync(join(host, 'activation.json'), json({ status: 'REGISTERED_VERIFIED', candidate, build, databaseIdentity }));
  writeFileSync(join(host, 'control-base.json'), json({ candidate, build, databaseIdentity }));
  const inputPath = join(host, 'synthetic-independent-input.json'), inputBytes = Buffer.from(json(s.fixture.validation));
  writeFileSync(inputPath, inputBytes);
  writeFileSync(join(run, 'bootstrap.json'), json({ schemaVersion: 1, batchId: s.fixture.terminal.batchId,
    independentValidation: { path: inputPath, sha256: sha(inputBytes) } }));
  if (!s.omitArchive) writeFileSync(join(run, 'artifacts', `${s.fixture.terminal.batchId}.independent-validation.json`), s.archiveBytes);
  writeFileSync(join(run, 'artifacts', `${s.fixture.terminal.batchId}.archive.json`), json({ syntheticOnly: true, noPublicationAuthority: true }));
  const request: any = makeSyntheticRequest(s.fixture.terminal, s.expiresAt);
  const body = [
    '-- SYNTHETIC REVIEWER PACKET ONLY: NOT EXECUTABLE OR QUALIFIED FOR DATABASE PUBLICATION',
    `INSERT INTO public."LossLedgerEntry" SELECT * FROM jsonb_populate_recordset(NULL::public."LossLedgerEntry", ${literal(s.losses)});`,
    `INSERT INTO public."LifecycleSetEvidenceMember" SELECT * FROM jsonb_populate_recordset(NULL::public."LifecycleSetEvidenceMember", ${s.compactMembers ? compactRecords(s.members) : literal(s.members)});`,
    '-- PILOT_COMMITTED_EXACT_SOURCE_REQUIRED',
    '-- PILOT_CURRENT_MEMBERS_DRIFT',
    'SET CONSTRAINTS "CrawlBatchSourceResult_verified_lifecycle_projection", "LifecycleSetEvidenceMember_exact_projection", "TransportAttemptEvidence_nonempty_refs" IMMEDIATE;',
    '-- portable-quality-sync-v1:released'
  ].join('\n');
  request.payload.sql = request.payload.sql.replace('PERFORM 1;', body);
  request.payload.dispatchBefore = s.dispatchBefore;
  const { requestSha256: _oldHash, ...unsigned } = request; request.requestSha256 = sha(JSON.stringify(unsigned));
  const requestPath = join(run, 'relay', `${request.requestId}.request.json`);
  writeFileSync(requestPath, json(request)); writeFileSync(requestPath + '.sql', request.payload.sql);
  const result = spawnSync('python3', [reviewer, host, run, request.requestId], {
    encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', TSX_DISABLE_CACHE: '1', NODE_DISABLE_COMPILE_CACHE: '1',
      NODE_OPTIONS: `--require=${join(here, 'servier-b-proof.offline.cjs')}` }
  });
  writeFileSync(join(host, 'reviewer.stdout.txt'), result.stdout); writeFileSync(join(host, 'reviewer.stderr.txt'), result.stderr);
  const report = { scenario: name, exitCode: result.status, stdoutSha256: sha(result.stdout), stderrSha256: sha(result.stderr),
    syntheticOnly: true, sqlExecuted: false, host, run };
  outcomes.push(report); writeFileSync(join(host, 'test-result.json'), json(report));
  return { ...result, run, report };
}

test('full installed Python reviewer accepts native B/delta, real synthetic loss ledger and CURRENT members', () => {
  const result = runScenario('valid'); assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.bProof.status, 'PASS'); assert.equal(report.persistedUnknownGeographyLossCount, 1);
  assert.equal(report.persistedCurrentMemberCount, 2); assert.equal(report.sourceResult.rawCount, 3);
  assert.deepEqual(JSON.parse(readFileSync(join(result.run, 'publication-review.json'), 'utf8')), report);
});
test('full Python reviewer accepts compiler-style compact member recordsets', () => {
  const result = runScenario('valid-compact-members', s => s.compactMembers = true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).persistedCurrentMemberCount, 2);
});
const cases: [string, (s: Scenario) => void, RegExp][] = [
  ['missing-loss', s => s.losses.pop(), /len\(losses\)==len\(excluded\)/],
  ['extra-loss', s => s.losses.push(structuredClone(s.losses[0])), /len\(losses\)==len\(excluded\)/],
  ['wrong-loss-reason', s => s.losses[0].reason = 'Synthetic wrong reason', /loss\['reason'\]/],
  ['wrong-loss-code', s => s.losses[0].details.code = 'SYNTHETIC_WRONG_CODE', /loss\['details'\]\['code'\]/],
  ['wrong-loss-field', s => s.losses[0].details.field = 'title', /loss\['details'\]\['field'\]/],
  ['wrong-loss-note', s => s.losses[0].details.noteCode = 'SYNTHETIC_WRONG_NOTE', /loss\['details'\]\['noteCode'\]/],
  ['wrong-loss-source-tuple', s => s.losses[0].sourceId = 'synthetic-other-source', /loss\[key\]==row\[key\]/],
  ['wrong-loss-result-tuple', s => s.losses[0].sourceResultId = 'synthetic-other-result', /loss\['sourceResultId'\]/],
  ['wrong-loss-stage', s => s.losses[0].stage = 'PARSE', /loss\['stage'\]/],
  ['missing-current-member', s => s.members.splice(s.members.findIndex(m => m.setKind === 'CURRENT'), 1), /len\(current\)/],
  ['wrong-current-set', s => s.members.find(m => m.setKind === 'CURRENT').jobKey += '-wrong', /sethash\(\[m\['jobKey'\]/],
  ['wrong-current-set-compact', s => { s.compactMembers = true; s.members.find(m => m.setKind === 'CURRENT').jobKey += '-wrong'; }, /sethash\(\[m\['jobKey'\]/],
  ['wrong-member-tuple', s => s.members[0].batchId = 'synthetic-other-batch', /member\[key\]==row\[key\]/],
  ['archive-byte-mismatch', s => s.archiveBytes = Buffer.concat([s.archiveBytes, Buffer.from(' ')]), /hashlib\.sha256\(independent_bytes\)/],
  ['missing-independent-archive', s => s.omitArchive = true, /FileNotFoundError/],
  ['a-certificate', s => { s.fixture.terminal.completenessCertificate.legacyCertificate.schemaVersion = 'a-grade-official-total-v2';
    s.fixture.terminal.completenessCertificate.legacyCertificate.grade = 'A'; rehashTerminal(s.fixture.terminal); }, /cert\['schemaVersion'\]/],
  ['expired-request', s => s.expiresAt = new Date(base.now.getTime() - 1000).toISOString(), /request\['expiresAt'\]/],
  ['expired-dispatch', s => s.dispatchBefore = new Date(base.now.getTime() - 1000).toISOString(), /request\['payload'\]\['dispatchBefore'\]/],
  ['expired-main-proof', s => s.fixture.terminal.startedAt = new Date(base.now.getTime() - 31 * 60_000).toISOString(), /SERVIER_B_PUBLICATION_EXPIRED/]
];
for (const [name, mutate, expected] of cases) {
  test(`full Python reviewer rejects ${name}`, () => {
    const result = runScenario(name, mutate); assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, expected);
  });
}
test('write bounded offline test report and confirm installed reviewer did not change', () => {
  assert.equal(sha(readFileSync(reviewer)), originalReviewerSha256);
  const report = { schemaVersion: 1, purpose: 'SYNTHETIC_PYTHON_REVIEWER_ONLY_NO_DATABASE_ELIGIBILITY',
    testedAt: new Date().toISOString(), installedReviewerSha256: originalReviewerSha256,
    scenarios: outcomes.length, expectedPasses: 2, expectedRejections: cases.length,
    actualPasses: outcomes.filter(r => r.exitCode === 0).length, actualRejections: outcomes.filter(r => r.exitCode !== 0).length,
    networkAccess: false, browserAccess: false, sqlExecution: false, hostModified: false, producerModified: false,
    syntheticHostRoot: suite, outcomes };
  assert.equal(report.actualPasses, 2); assert.equal(report.actualRejections, cases.length);
  writeFileSync(join(suite, 'PYTHON_REVIEWER_TEST_REPORT.json'), json(report));
  console.log(JSON.stringify({ syntheticReviewerReport: join(suite, 'PYTHON_REVIEWER_TEST_REPORT.json'), scenarios: outcomes.length }));
});
