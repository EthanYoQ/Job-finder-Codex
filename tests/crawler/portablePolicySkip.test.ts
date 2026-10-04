import { unstartedAbort, ambiguousAbortMutations } from "../helpers/portablePublicSnapshotFixture";
import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {runP0CrawlBatch,summarizePersistedBatchSourceResults} from '../../src/crawler/runCrawlBatch';
import {acquirePortableCrawlLease,releasePortableCrawlLease} from '../../src/crawler/portableCrawlLease';
import {buildStagedSourceCrawlPlans,getPlanBySourceId} from '../../src/crawler/sourcePlan';
import {candidateCompanies} from '../../src/data/companyRegistry';
async function run(sourceId:string,portable=true){
 const plan=getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies),sourceId)!;
 const sourceRows=new Map<string,any>();let holder='';const jobWrite=vi.fn(),fetch=vi.fn(async()=>({ok:false as const,capturedAt:new Date().toISOString(),failureReason:'test transport failure'}));
 const tx:any={$queryRawUnsafe:async(sql:string,...v:any[])=>{if(sql.startsWith('INSERT'))holder=v[1];if(sql.startsWith('UPDATE')&&sql.includes('"holderId" = \'\''))holder='';return sql.startsWith('SELECT')?[{id:v[0]}]:[{holderId:holder}];},
  crawlBatch:{create:async({data}:any)=>data,update:async({data}:any)=>data},job:{upsert:jobWrite},
  crawlBatchSourceResult:{create:async({data}:any)=>{sourceRows.set(data.id,{...data});return data;},updateMany:async({where,data}:any)=>{const r=sourceRows.get(where.id);if(!r||Object.entries(where).some(([k,v])=>r[k]!==v))return{count:0};Object.assign(r,data);return{count:1}}}};
 const db:any={$transaction:async(work:any)=>work(tx),crawlBatch:tx.crawlBatch,crawlBatchSourceResult:{findMany:async()=>[...sourceRows.values()]}};
 const lease=await acquirePortableCrawlLease(db);const recent=vi.fn(async()=>[]),previous=vi.fn(async()=>[]);
 const hash=createHash('sha256').update(JSON.stringify([sourceId])).digest('hex');
 try{const result=await runP0CrawlBatch([plan],{db,now:()=>new Date(),identity:{releaseCandidateId:'skip-test',commitSha:'a'.repeat(40),rosterSha256:'a'.repeat(64),sourcePlanSha256:'a'.repeat(64),sourceConfigSha256:'a'.repeat(64),adapterBundleSha256:'a'.repeat(64),batchKind:'SCHEDULED',ownerId:'test',expectedPlannedSourceIds:[sourceId],expectedPlannedSourceSetSha256:hash,expectedPlannedSourceCount:1},
  ...(portable?{sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1' as const,portableLease:lease}:{}),fetch,force:true,
  getRecentObservations:recent,getPreviousJobs:previous,isBaselineCompleted:async()=>false,getTrustedCompletenessBaseline:async()=>null,getFirstAcceptedCurrentPolicyReceipt:async()=>null,
  runIndependentTraversalValidator:async()=>{throw Error('TEST_VALIDATOR_NOT_AVAILABLE');}});
 return{result,rows:[...sourceRows.values()],jobWrite,fetch,recent,previous};
 }finally{await releasePortableCrawlLease(db,lease);}
}
describe('portable zero-request policy skips',()=>{
 it.each([['source-united-lab-social','USER_AUTHORIZED_COVERAGE_EXCLUSION'],['source-sanofi-china-social','SOURCE_QUALITY_POLICY_NOT_REVIEWED']])('records %s as an explicit skip without network or Job reads/writes',async(source,code)=>{
  const r=await run(source);expect(r.result).toMatchObject({status:'INCOMPLETE',skippedSourceCount:1,failedSourceCount:0,transportFailedSourceCount:0,successfulSourceCount:0});
  expect(r.rows[0]).toMatchObject({transportState:'SKIPPED',adapterState:'SKIPPED',completenessState:'FAILED',atomicCommitState:'NOT_ATTEMPTED',failureCode:code,fetchAttemptCount:null,retryCount:null});
  expect(r.fetch).not.toHaveBeenCalled();expect(r.jobWrite).not.toHaveBeenCalled();expect(r.recent).not.toHaveBeenCalled();expect(r.previous).not.toHaveBeenCalled();
 });
 it('CSPC attempts the reviewed channel without converting a failed acquisition into publication',async()=>{
  const r=await run('source-cspc-social');
  expect(r.fetch).toHaveBeenCalledOnce();expect(r.jobWrite).not.toHaveBeenCalled();
  expect(r.result).toMatchObject({successfulSourceCount:0,transportFailedSourceCount:1,skippedSourceCount:0});
  expect(r.rows[0]).toMatchObject({transportState:'FAILED',completenessState:'FAILED',atomicCommitState:'NOT_ATTEMPTED'});
 });
 it('keeps the legacy non-portable path as a real transport failure',async()=>{const r=await run('source-sanofi-china-social',false);expect(r.fetch).toHaveBeenCalledOnce();expect(r.result.transportFailedSourceCount).toBe(1);expect(r.result.skippedSourceCount).toBe(0)});
 it('does not relabel existing failed states or arbitrary skip codes',()=>{
  const rows=[{sourceId:'s',transportState:'FAILED',adapterState:'SKIPPED',completenessState:'FAILED',atomicCommitState:'NOT_ATTEMPTED',failureCode:'SOURCE_QUALITY_POLICY_NOT_REVIEWED'}] as any;
  expect(summarizePersistedBatchSourceResults(['s'],rows)).toMatchObject({skippedSourceCount:0,failedSourceCount:1,transportFailedSourceCount:1});
  rows[0].transportState='SKIPPED';rows[0].failureCode='UNKNOWN_SKIP';expect(summarizePersistedBatchSourceResults(['s'],rows)).toMatchObject({skippedSourceCount:0,failedSourceCount:1});
 });
});

async function abortedBatch(portable: boolean, started: boolean) {
 const plans = ['source-hansoh-social', 'source-astellas-china-social'].map(id => getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), id)!);
 const sourceRows = new Map<string, any>(); const updates: any[] = []; let holder = '', failedTerminal = false;
 let batch: any;
 const tx: any = {$queryRawUnsafe: async (sql: string, ...values: any[]) => {
  if (sql.startsWith('INSERT')) holder = values[1];
  if (sql.startsWith('UPDATE') && sql.includes("\"holderId\" = ''")) holder = '';
  return sql.startsWith('SELECT') ? [{id: values[0]}] : [{holderId: holder}];
 }, crawlBatch: {create: async ({data}: any) => (batch = data), update: async ({data}: any) => {updates.push(data); return data;}},
 crawlBatchSourceResult: {create: async ({data}: any) => {sourceRows.set(data.id, {...data}); return data;},
 updateMany: async ({where, data}: any) => {
  if (started && !failedTerminal) {failedTerminal = true; throw new Error('TEST_TERMINAL_WRITE_FAILED');}
  const row = sourceRows.get(where.id); if (!row) return {count: 0}; Object.assign(row, data); return {count: 1};
 }}};
 const db: any = {$transaction: async (work: any) => work(tx), crawlBatch: tx.crawlBatch,
 crawlBatchSourceResult: {findMany: async () => [...sourceRows.values()].map(row => ({...row, batch,
 _count: {transportAttempts: 0, evidenceArtifacts: 0, observations: 0, paginationEvidence: 0, lossLedgerEntries: 0, lifecycleSetMembers: 0}}))}};
 const lease = await acquirePortableCrawlLease(db), ids = plans.map(plan => plan.source.id).sort();
 const fetch = vi.fn(async () => {throw new Error('TEST_FETCH_FAILED');});
 try {
 await expect(runP0CrawlBatch(plans, {db, now: () => new Date(), force: true, fetch,
 identity: {releaseCandidateId: 'abort-test', commitSha: 'a'.repeat(40), rosterSha256: 'a'.repeat(64), sourcePlanSha256: 'a'.repeat(64), sourceConfigSha256: 'a'.repeat(64), adapterBundleSha256: 'a'.repeat(64), batchKind: 'SCHEDULED', ownerId: 'test', expectedPlannedSourceIds: ids, expectedPlannedSourceSetSha256: createHash('sha256').update(JSON.stringify(ids)).digest('hex'), expectedPlannedSourceCount: ids.length},
 ...(portable ? {sourceAdmissionPolicy: 'PLAN_BOUND_SOURCE_QUALITY_V1' as const, portableLease: lease} : {}),
 getRecentObservations: async () => [], getPreviousJobs: async () => [], isBaselineCompleted: async () => false,
 getTrustedCompletenessBaseline: async () => {if (!started) throw new Error('TEST_BASELINE_READ_FAILED'); return null;},
 getFirstAcceptedCurrentPolicyReceipt: async () => null})).rejects.toThrow();
 return {rows: [...sourceRows.values()], updates, fetch};
 } finally {await releasePortableCrawlLease(db, lease);}
}
describe('unstarted portable batch closure', () => {
 it('persists zero-request sources as skipped while retaining the failed batch', async () => {
  const {rows, updates, fetch} = await abortedBatch(true, false);
  expect(fetch).not.toHaveBeenCalled();
  for (const row of rows) expect(row).toMatchObject({transportState: 'SKIPPED', adapterState: 'SKIPPED', atomicCommitState: 'NOT_ATTEMPTED', failureCode: 'BATCH_ABORTED_BEFORE_SOURCE_TERMINAL', fetchAttemptCount: 0, retryCount: 0});
  expect(updates.at(-1)).toMatchObject({status: 'FAILED', skippedSourceCount: 2, failedSourceCount: 0, transportFailedCount: 0});
 });
 it('preserves started failures and skips only later unstarted portable sources', async () => {
  const {rows, updates, fetch} = await abortedBatch(true, true);
  expect(fetch).toHaveBeenCalledOnce();
  expect(rows[0]).toMatchObject({transportState: 'FAILED', fetchAttemptCount: 1, failureDiagnosticCode: 'FETCH_EXECUTION_FAILED'});
  expect(rows[1]).toMatchObject({transportState: 'SKIPPED', fetchAttemptCount: 0});
  expect(updates.at(-1)).toMatchObject({status: 'FAILED', skippedSourceCount: 1, failedSourceCount: 1, transportFailedCount: 1});
 });
 it('keeps nonportable aborted sources failed', async () => {
  const {rows, updates} = await abortedBatch(false, false);
  for (const row of rows) expect(row.transportState).toBe('FAILED');
  expect(updates.at(-1)).toMatchObject({status: 'FAILED', skippedSourceCount: 0, failedSourceCount: 2});
 });
});

it('requires the complete unstarted proof for portable persisted skip accounting', () => {
 const row = unstartedAbort(undefined, 'SKIPPED'); row.batch.status = 'RUNNING';
 expect(summarizePersistedBatchSourceResults([row.sourceId], [row], true)).toMatchObject({skippedSourceCount: 1, failedSourceCount: 0});
 expect(summarizePersistedBatchSourceResults([row.sourceId], [row])).toMatchObject({skippedSourceCount: 0, failedSourceCount: 1});
 for (const [name, mutate] of ambiguousAbortMutations) {
  const ambiguous = structuredClone(row); mutate(ambiguous);
  expect(summarizePersistedBatchSourceResults([row.sourceId], [ambiguous], true), name).toMatchObject({skippedSourceCount: 0, failedSourceCount: 1});
 }
});
