/** Local proof review only. Never fetches, issues certificates, or executes SQL. */
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyNodeRuntimeProfile } from '../../../../producer/scripts/verify-node-runtime-profile.ts';
import { parseBGradeIndependentTraversalValidation, verifyBGradeTraversalCertificateReceipt } from '../../../../producer/src/crawler/traversalCertificate.ts';
import { replayServierHybridTraversal, servierHybridObservedAt, servierHybridFinishedAt } from '../../../../producer/src/crawler/servierMokaRenderedTraversal.ts';
import { canonicalStringSetSha256 } from '../../../../producer/src/crawler/sourceFetchEvidence.ts';
import { deriveDbStartedPublicationExpiry } from '../../../../producer/src/db/ingestionRepository.ts';
import { unwrapJobProjectionSourceRow } from '../../../../producer/src/db/jobProjectionDeltaCompiler.ts';
import { parseJobProjectionDeltaReceipt, canonicalProjectionJson } from '../../../../producer/src/domain/jobProjectionDeltaReceipt.ts';
import { inspectRequest,loadBoundPublicationContext } from './review-packet-envelope.mts';

const SOURCE = 'source-servier-china-social';
const CONFIG = '3c87c89d3bdc74275a0b66a9a27a9eaf76f99da8ee7aa3af835eb87e2b028e17';
const SHA = /^[a-f0-9]{64}$/;
const equal = (a: unknown, b: unknown) => canonicalProjectionJson(a) === canonicalProjectionJson(b);
function check(condition: unknown, code: string): asserts condition { if (!condition) throw Error(code); }
function instant(value: unknown): number {
  check(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value), 'SERVIER_B_TIMESTAMP');
  const ms = Date.parse(value);
  check(Number.isFinite(ms) && new Date(ms).toISOString() === value, 'SERVIER_B_TIMESTAMP');
  return ms;
}

export function verifyServierBProof(terminal: any, independentValidation: any, now: Date) {
  check(now instanceof Date && Number.isFinite(now.getTime()), 'SERVIER_B_NOW');
  check(terminal?.sourceId === SOURCE && terminal.sourceConfigHash === CONFIG, 'SERVIER_B_SOURCE_CONFIG');
  check(typeof terminal.batchId === 'string' && terminal.batchId.length > 0 &&
    typeof terminal.releaseCandidateId === 'string' && terminal.releaseCandidateId.length > 0 &&
    terminal.id === terminal.batchId + '--' + SOURCE, 'SERVIER_B_SOURCE_TUPLE');
  check(equal([terminal.transportState, terminal.adapterState, terminal.completenessState, terminal.atomicCommitState],
    ['SUCCEEDED', 'SUCCEEDED', 'VERIFIED', 'COMMITTED']), 'SERVIER_B_TERMINAL_STATE');
  const delta = parseJobProjectionDeltaReceipt(terminal.completenessCertificate, terminal.completenessCertificateSha256);
  const row = unwrapJobProjectionSourceRow(terminal) as any;
  const cert = row.completenessCertificate;
  check(cert?.schemaVersion === 'b-grade-independent-traversal-v2' && cert.grade === 'B' &&
    cert.validationPolicy?.execution === 'CURRENT_RUN', 'SERVIER_B_CURRENT_CERTIFICATE_REQUIRED');
  const validation = parseBGradeIndependentTraversalValidation(independentValidation);
  check(validation.schemaVersion === 'official-json-browser-network-traversal-v1' && validation.sourceId === SOURCE &&
    validation.companyId === 'company-servier-china' && validation.sourceConfigSha256 === CONFIG, 'SERVIER_B_INDEPENDENT_SCOPE');
  check(equal(cert.independentValidation, validation), 'SERVIER_B_BOOTSTRAP_VALIDATION_MISMATCH');
  check(equal(validation.surfaceIds, row.officialSurfaceIds) && equal(validation.channelIds, row.officialChannelIds), 'SERVIER_B_INDEPENDENT_SURFACE_CHANNEL');
  const replay = replayServierHybridTraversal(validation.pages);
  const observedAt = servierHybridObservedAt(validation.pages), independentFinishedAt = servierHybridFinishedAt(validation.pages);
  check(observedAt === validation.observedAt, 'SERVIER_B_ORIGINAL_OBSERVATION');
  const startedMs = instant(row.startedAt), finishedMs = instant(row.finishedAt);
  check(startedMs <= finishedMs && finishedMs <= now.getTime() && instant(independentFinishedAt) <= now.getTime(), 'SERVIER_B_ORIGINAL_TIME_ORDER');
  check(instant(delta.observedAt) >= startedMs, 'SERVIER_B_DELTA_OBSERVATION_ORDER');
  const verified = verifyBGradeTraversalCertificateReceipt({
    certificate: cert, certificateSha256: row.completenessCertificateSha256,
    expected: {
      releaseCandidateId: row.releaseCandidateId, batchId: row.batchId, sourceResultId: row.id,
      sourceId: SOURCE, sourceConfigSha256: CONFIG, companyId: 'company-servier-china',
      surfaceIds: row.officialSurfaceIds, channelIds: row.officialChannelIds,
      canonicalJobSetSha256: row.canonicalCurrentJobSetSha256,
      adapterReconciliationSha256: row.adapterReconciliationSha256,
      collisionLedgerSha256: row.collisionLedgerSha256,
      canonicalRawEvidenceIdSetSha256: canonicalStringSetSha256(replay.rawEvidenceIds)
    }, now
  });
  for (const key of ['rawCount', 'parsedCount', 'validCount', 'dedupeOutputCount', 'parseDiscardCount',
    'validationDiscardCount', 'normalizationDiscardCount', 'dedupeDiscardCount']) {
    check(Number.isSafeInteger(row[key]) && row[key] >= 0, 'SERVIER_B_ROW_COUNT_TYPE');
  }
  const includedCount = replay.matchKeys.length, excludedCount = replay.excludedCount;
  check(row.rawCount === replay.rawCount && row.parsedCount === replay.rawCount &&
    row.validCount === includedCount && row.dedupeOutputCount === includedCount &&
    row.validationDiscardCount === excludedCount && row.rawCount === includedCount + excludedCount &&
    cert.counts.mainUniqueJobCount === includedCount && cert.counts.independentUniqueJobCount === includedCount &&
    cert.counts.finalUniqueJobCount === includedCount && cert.counts.validationDiscardCount === excludedCount,
    'SERVIER_B_RAW_INCLUDED_EXCLUDED_COUNTS');
  check(row.parseDiscardCount === 0 && row.normalizationDiscardCount === 0 && row.dedupeDiscardCount === 0,
    'SERVIER_B_UNEXPECTED_PIPELINE_LOSS');
  check(row.expectedJobCount === null && row.expectedEvidenceKind === 'COMPLETE_PAGE_TRAVERSAL', 'SERVIER_B_TRAVERSAL_DECLARATION');
  check(row.canonicalOutputSetSha256 === row.canonicalCurrentJobSetSha256 &&
    cert.output.canonicalJobSetSha256 === row.canonicalCurrentJobSetSha256, 'SERVIER_B_OUTPUT_SET');
  const current = delta.members.filter(member => member.setKind === 'CURRENT');
  check(current.length === includedCount && new Set(current.map(member => member.jobKey)).size === includedCount &&
    canonicalStringSetSha256(current.map(member => member.jobKey)) === row.canonicalCurrentJobSetSha256, 'SERVIER_B_DELTA_CURRENT_SET');
  // Compute from the inner B proof. The outer delta alone would lose the one-hour limit.
  const expiry = deriveDbStartedPublicationExpiry({ startedAt: new Date(startedMs), completenessCertificate: cert });
  check(now.getTime() < expiry, 'SERVIER_B_PUBLICATION_EXPIRED');
  return {
    status: verified.status, grade: verified.grade, sourceId: SOURCE, sourceResultId: row.id,
    sourceConfigSha256: CONFIG, certificateSha256: row.completenessCertificateSha256,
    independentArtifactSha256: validation.artifactSha256, rawCount: replay.rawCount,
    includedMainlandCount: includedCount, unknownGeographyExcludedCount: excludedCount,
    finalUniqueJobCount: verified.finalUniqueJobCount, currentMemberCount: current.length,
    mainStartedAt: row.startedAt, mainFinishedAt: row.finishedAt,
    independentObservedAt: observedAt, independentFinishedAt,
    deltaObservedAt: delta.observedAt, deltaVerifiedAt: delta.verifiedAt,
    publicationExpiresAt: new Date(expiry).toISOString()
  };
}

/** Hash the original independent-validation bytes before parsing or reviewing the packet. */
export function reviewServierBRequest(request: any, bootstrap: any, independentBytes: Uint8Array, now: Date, origin?: any) {
  const reference = bootstrap?.independentValidation;
  check(bootstrap?.schemaVersion === 1 && typeof bootstrap.batchId === 'string' &&
    reference && typeof reference.path === 'string' && isAbsolute(reference.path) && SHA.test(reference.sha256 ?? ''),
    'SERVIER_B_BOOTSTRAP_INPUT');
  check(createHash('sha256').update(independentBytes).digest('hex') === reference.sha256, 'SERVIER_B_INDEPENDENT_FILE_HASH');
  const packet = inspectRequest(request,origin);
  check(packet.terminal.batchId === bootstrap.batchId, 'SERVIER_B_BOOTSTRAP_BATCH');
  const proof = verifyServierBProof(packet.terminal, JSON.parse(Buffer.from(independentBytes).toString('utf8')), now);
  const requestExpiry = instant(request.expiresAt);
  check(requestExpiry > now.getTime() && requestExpiry <= instant(proof.publicationExpiresAt), 'SERVIER_B_REQUEST_EXPIRY');
  return { requestId: packet.requestId, requestSha256: packet.requestSha256, sqlSha256: packet.sqlSha256,
    independentValidationSha256: reference.sha256, bProof: proof };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyNodeRuntimeProfile();
  const [requestPath, bootstrapPath, ...extra] = process.argv.slice(2);
  check(requestPath && bootstrapPath && extra.length === 0, 'SERVIER_B_REVIEW_ARGUMENTS');
  const bootstrap = JSON.parse(readFileSync(bootstrapPath, 'utf8'));
  const inputPath = bootstrap?.independentValidation?.path;
  check(typeof inputPath === 'string' && isAbsolute(inputPath) && lstatSync(inputPath).isFile(), 'SERVIER_B_INDEPENDENT_FILE');
  const request=JSON.parse(readFileSync(requestPath,'utf8'));
  const report = reviewServierBRequest(request, bootstrap, readFileSync(inputPath), new Date(), loadBoundPublicationContext(requestPath,request));
  console.log(JSON.stringify(report));
}
