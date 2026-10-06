import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Verification-only adapter over one authenticated, current, single-source export.
// This file does not fetch, create, repair or overwrite source data.
const [candidateRoot, packetPath, outputPath] = process.argv.slice(2);
assert(candidateRoot && packetPath && outputPath);
const SOURCE = 'source-sanofi-china-social';
const COMPANY = 'company-sanofi-china';
const EXPECTED_SHA = '2582afaa1900a3223812d40e08cc2ffe6d5f73e82d33e8b1ede6c6e18759d0bf';
const bytes = readFileSync(packetPath);
const sha = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');
assert.equal(sha(bytes), EXPECTED_SHA);
const envelope = JSON.parse(bytes.toString('utf8'));
// Owner-supplied refreshed export is the packet itself; no fields are invented.
const packet = envelope;
assert.equal(packet.exportStatus, 'COMPLETE_SINGLE_SOURCE_EXPORT');
assert.equal(packet.sourceId, SOURCE);
assert.equal(packet.isHistoricalFixture, false);
// Read-only acquisition metadata is retained separately in the owner evidence.
assert.equal(packet.snapshot.results.length, 21);
assert.equal(packet.snapshot.members.length, 176);
assert.equal(packet.snapshot.jobs.length, 88);
assert.equal(packet.snapshot.artifacts.length, 0);
assert.equal(packet.snapshot.results.reduce((n: number, r: any) => n + r.observations.length, 0), 2);
const data = structuredClone(packet.snapshot);
const utcDate = (v: unknown) => {
  assert.equal(typeof v, 'string');
  const text = v as string;
  const d = new Date(text + (/Z$|[+-]\d\d(?::?\d\d)?$/.test(text) ? '' : 'Z'));
  assert(Number.isFinite(d.getTime()));
  return d;
};
const revive = (row: any, fields: string[]) => {
  for (const key of fields) if (row[key] !== null && row[key] !== undefined) row[key] = utcDate(row[key]);
};
for (const row of data.results) {
  assert.equal(row.sourceId, SOURCE);
  assert.equal(row.batch.kind, 'SCHEDULED');
  revive(row, ['startedAt', 'finishedAt']);
  revive(row.batch, ['startedAt', 'finishedAt']);
  for (const observation of row.observations) revive(observation, ['observedFrom', 'observedTo', 'crawledAt']);
}
// The SQL export contains PostgreSQL enum labels. Reproduce Prisma's declared
// @map deserialization from the real generated client; never invent a category.
const requireCandidate = createRequire(resolve(candidateRoot, 'package.json'));
const { Prisma } = requireCandidate('@prisma/client');
const enumDefinition = Prisma.dmmf.datamodel.enums.find((e: any) => e.name === 'JobCategory');
assert(enumDefinition && enumDefinition.values.length === 17);
const categoryMap = new Map(enumDefinition.values.map((v: any) => [v.dbName ?? v.name, v.name]));
assert.equal(categoryMap.size, enumDefinition.values.length);
let mappedCategoryValues = 0;
for (const row of data.jobs) {
  for (const field of ['category', 'humanCorrectedCategory']) {
    if (row[field] === null) continue;
    assert(categoryMap.has(row[field]), `Unknown PostgreSQL JobCategory label in ${field}`);
    row[field] = categoryMap.get(row[field]);
    mappedCategoryValues++;
  }
  assert.equal(row.sourceId, SOURCE);
  assert.equal(row.companyId, COMPANY);
  revive(row, ['lastSeenAt', 'officialPublishedAt']);
}
const now = utcDate(packet.capturedAt);
const importSource = (file: string) => import(pathToFileURL(resolve(candidateRoot, file)).href);
const repository = await importSource('src/db/portablePublicSnapshotRepository.ts');
const { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } = await importSource('src/crawler/sourcePlan.ts');
const { candidateCompanies } = await importSource('src/data/companyRegistry.ts');
const plan = buildStagedSourceCrawlPlans(candidateCompanies).find((p: any) => p.source.id === SOURCE);
assert(plan && plan.company.id === COMPANY);
assert.equal(sourcePlanConfigSha256(plan), '2925884ffb70805a106c730a5b24a8992b0d13ce0348de28639e27d1bbfeacee');
const trace: any[] = [];
const exactKeys = (obj: any, keys: string[]) => assert.deepEqual(Object.keys(obj).sort(), [...keys].sort());
const compare = (a: unknown, b: unknown) => a instanceof Date && b instanceof Date ? a.getTime() - b.getTime()
  : Buffer.compare(Buffer.from(String(a)), Buffer.from(String(b)));
function sorted(rows: any[], orderBy: any[]) {
  assert(Array.isArray(orderBy));
  return [...rows].sort((left, right) => {
    for (const clause of orderBy) {
      assert.equal(Object.keys(clause).length, 1);
      const [field, direction] = Object.entries(clause)[0];
      assert(direction === 'asc' || direction === 'desc');
      const result = compare(left[field], right[field]);
      if (result) return direction === 'asc' ? result : -result;
    }
    return 0;
  });
}
function selectFields(row: any, select: any): any {
  return Object.fromEntries(Object.entries(select).map(([key, value]: any) => {
    assert(Object.hasOwn(row, key), `Export missing selected field ${key}`);
    if (value === true) return [key, structuredClone(row[key])];
    exactKeys(value, ['select']);
    return [key, Array.isArray(row[key]) ? row[key].map((v: any) => selectFields(v, value.select)) : selectFields(row[key], value.select)];
  }));
}
const tx = {
  crawlBatchSourceResult: { findMany: async (args: any) => {
    exactKeys(args, ['where', 'select', 'orderBy']);
    assert.deepEqual(args.where, { OR: [{ sourceId: SOURCE }], batch: { is: { kind: 'SCHEDULED' } } });
    assert.deepEqual(args.select, repository.portableSourceResultSelect);
    assert.deepEqual(args.orderBy, [{ startedAt: 'asc' }, { id: 'asc' }]);
    const rows = data.results.filter((r: any) => args.where.OR.some((q: any) => r.sourceId === q.sourceId) && r.batch.kind === args.where.batch.is.kind);
    trace.push({ operation: 'sourceResults.findMany', sourceId: SOURCE, returned: rows.length, allScheduledHistoryPreserved: true });
    return sorted(rows, args.orderBy).map(row => selectFields(row, args.select));
  } },
  lifecycleSetEvidenceMember: { findMany: async (args: any) => {
    exactKeys(args, ['where', 'select', 'orderBy']); exactKeys(args.where, ['sourceResultId']); exactKeys(args.where.sourceResultId, ['in']);
    assert(Array.isArray(args.where.sourceResultId.in));
    for (const id of args.where.sourceResultId.in) assert(data.results.some((r: any) => r.id === id));
    assert.deepEqual(args.orderBy, [{ sourceResultId: 'asc' }, { setKind: 'asc' }, { jobKey: 'asc' }]);
    const rows = data.members.filter((r: any) => args.where.sourceResultId.in.includes(r.sourceResultId));
    trace.push({ operation: 'members.findMany', resultIdsRequested: args.where.sourceResultId.in.length, returned: rows.length });
    return sorted(rows, args.orderBy).map(row => selectFields(row, args.select));
  } },
  job: { findMany: async (args: any) => {
    exactKeys(args, ['where', 'select', 'orderBy']); exactKeys(args.where, ['OR']); assert(Array.isArray(args.where.OR));
    for (const q of args.where.OR) {
      exactKeys(q, ['companyId', 'sourceId', 'lifecycleStatus', 'visibleInFrontend', 'lastSeenAt', 'dedupeKey']);
      assert.equal(q.sourceId, SOURCE); assert.equal(q.companyId, COMPANY); assert.equal(q.lifecycleStatus, 'ACTIVE'); assert.equal(q.visibleInFrontend, true);
      exactKeys(q.lastSeenAt, ['gte', 'lte']); assert(q.lastSeenAt.gte instanceof Date && q.lastSeenAt.lte instanceof Date);
      exactKeys(q.dedupeKey, ['in']); assert(Array.isArray(q.dedupeKey.in));
    }
    assert.deepEqual(args.orderBy, [{ sourceId: 'asc' }, { dedupeKey: 'asc' }]);
    const rows = data.jobs.filter((r: any) => args.where.OR.some((q: any) => r.companyId === q.companyId && r.sourceId === q.sourceId && r.lifecycleStatus === q.lifecycleStatus && r.visibleInFrontend === q.visibleInFrontend && r.lastSeenAt >= q.lastSeenAt.gte && r.lastSeenAt <= q.lastSeenAt.lte && q.dedupeKey.in.includes(r.dedupeKey)));
    trace.push({ operation: 'jobs.findMany', sourceClauses: args.where.OR.length, requestedVisibleKeys: args.where.OR.reduce((n: number, q: any) => n + q.dedupeKey.in.length, 0), returned: rows.length });
    return sorted(rows, args.orderBy).map(row => selectFields(row, args.select));
  } },
  evidenceArtifact: { findMany: async (args: any) => {
    exactKeys(args, ['where', 'select']); exactKeys(args.where, ['OR']); assert(Array.isArray(args.where.OR));
    for (const q of args.where.OR) {
      exactKeys(q, ['releaseCandidateId', 'batchId', 'sourceResultId', 'sourceId', 'extractorLocator']);
      assert.equal(q.sourceId, SOURCE); exactKeys(q.extractorLocator, ['in']); assert(Array.isArray(q.extractorLocator.in));
    }
    const rows = data.artifacts.filter((r: any) => args.where.OR.some((q: any) => r.releaseCandidateId === q.releaseCandidateId && r.batchId === q.batchId && r.sourceResultId === q.sourceResultId && r.sourceId === q.sourceId && q.extractorLocator.in.includes(r.extractorLocator)));
    trace.push({ operation: 'artifacts.findMany', resultClauses: args.where.OR.length, returned: rows.length });
    return rows.map((row: any) => selectFields(row, args.select));
  } }
};
let transactions = 0;
const db = { $transaction: async (work: (tx: any) => Promise<any>, options: any) => {
  assert.deepEqual(options, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 10000 });
  transactions++; return work(tx);
} };
// No cache argument and no $queryRawUnsafe: original reader cannot issue the global fingerprint.
const snapshot = await repository.readPortablePublicSnapshot(db, { currentTime: now }, [plan]);
assert.equal(transactions, 1);
assert.equal(snapshot.sources.length, 1);
const source = snapshot.sources.find((s: any) => s.sourceId === SOURCE);
const company = snapshot.companies.find((c: any) => c.id === COMPANY);
assert(source && company);
assert.equal(source.state, 'PUBLISHING', `Actual current source is ${source.state}: ${source.reasons.join(',')}`);
assert.equal(source.visibleJobCount, 88);
assert.equal(source.jobs.length, 88);
assert.equal(company.jobs.length, 88);
assert.equal(snapshot.totalJobs, 88);
assert.equal(new Set(source.jobs.map((j: any) => j.id)).size, 88);
const projection = { source, company, totalJobs: snapshot.totalJobs, lastUpdatedAt: snapshot.lastUpdatedAt, generatedAt: snapshot.generatedAt };
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const result = {
  scope: 'Current Sanofi only; no all-source qualification or historical fixture reconstruction',
  candidateRoot: resolve(candidateRoot), node: process.version, inputSha256: EXPECTED_SHA,
  capturedAt: packet.capturedAt, comparisonTime: now.toISOString(), state: source.state, visibleJobCount: source.visibleJobCount,
  selectedSourceResultId: source.selectedSourceResultId, lastAcceptedAt: source.lastAcceptedAt, lastSuccessAt: source.lastSuccessAt,
  visibilityFloor: source.visibilityFloor, lastUpdatedAt: snapshot.lastUpdatedAt, freshness: source.freshness, health: source.health,
  jobsSha256: sha(JSON.stringify(canonical(source.jobs))), projectionSha256: sha(JSON.stringify(canonical(projection))),
  transactions, trace, enumDeserialization: { source: "Real generated Prisma DMMF JobCategory dbName-to-name mapping", mappedValues: mappedCategoryValues, unknownValuesAccepted: false, sourceDataChanged: false }, inputUnchanged: sha(readFileSync(packetPath)) === EXPECTED_SHA,
  originalSourceHashes: Object.fromEntries(['src/db/portablePublicSnapshotRepository.ts', 'src/domain/portablePublicSnapshot.ts', 'src/domain/sanofiPublicTransition.ts', 'src/crawler/sanofiHistoricalPublicReceipt.ts'].map(f => [f, sha(readFileSync(resolve(candidateRoot, f)))])),
  // Private local comparison output. Do not upload real job data to GitHub or Drive.
  projection
};
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
const { projection: privateProjection, ...safe } = result;
console.log(JSON.stringify(safe));
