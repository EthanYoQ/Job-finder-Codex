// @vitest-environment node
// Scheduling-only fixtures: no HTTP, PostgreSQL, credentials or real relay.
// Real compiler/SQL semantics are tested in cloudPilot*DbStartedPublication.
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {setTimeout as delay} from 'node:timers/promises';
import {runDbStartedCloudPublication,requireDbStartedOuterDeadline} from '../../src/crawler/cloudDbStartedPilot';
import {runCloudSourcePilot} from '../../scripts/p0-cloud-source-pilot';
import {runCloudPortableSourcePilot} from '../../scripts/p0-cloud-portable-source-pilot';
import {FilePilotRelay,PilotSqlFailure,PILOT_BUDGET} from '../../src/crawler/cloudSourcePilotRelay';
import {compileDbStartedCloudSourcePublication} from '../../src/db/ingestionRepository';

vi.mock('node:fs/promises',async importOriginal=>({...await importOriginal<typeof import('node:fs/promises')>(),readFile:vi.fn(async()=> '{}')}));
vi.mock('node:timers/promises',()=>({setTimeout:(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))}));
vi.mock('../../src/db/cloudPilotSqlControl',async importOriginal=>({...await importOriginal<typeof import('../../src/db/cloudPilotSqlControl')>(),compileCloudPilotPublicationContextSql:()=> 'SELECT synthetic_context'}));
vi.mock('../../src/db/ingestionRepository',async importOriginal=>({
 ...await importOriginal<typeof import('../../src/db/ingestionRepository')>(),
 compileDbStartedCloudSourcePublication:vi.fn(),
 inspectPersistedAtomicCommitOutcome:vi.fn(async(_commit,db)=>({state:await db.crawlBatchSourceResult.findUnique()===null?'CONFLICT':'COMMITTED_EXACT'}))
}));
const NOW=Date.parse('2026-10-06T09:00:00Z');
const MINIMUM=2*PILOT_BUDGET.controlMs+PILOT_BUDGET.publishDbMs+PILOT_BUDGET.publishTransportMs+PILOT_BUDGET.controlCompletionMs;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks();});

type Mode='ack'|'unknown'|'no-ack'|'late-ack'|'cancelled'|'rollback'|'not-dispatched'|'ambiguous-rollback';
function fixture(mode:Mode='unknown',evidenceExpiry=NOW+31*60_000,overallDeadline=NOW+30*60_000){
 const planned={batch:{id:'synthetic-batch',releaseCandidateId:'synthetic-candidate'}};
 const commit={sourceResult:{id:'synthetic-source-result',batchId:planned.batch.id,dedupeOutputCount:7}};
 const source={pending:{startedAt:new Date(evidenceExpiry-30*60_000)}};
 const controller=new AbortController(),calls:Array<{kind:string;at:number;deadline:number;signal?:AbortSignal}>=[];
 let published!:()=>void;const publishStarted=new Promise<void>(resolve=>{published=resolve;});
 const compiler=vi.mocked(compileDbStartedCloudSourcePublication);
 compiler.mockImplementation(async input=>({sql:'SYNTHETIC_NON_EXECUTABLE_PACKET',commit,holderId:'synthetic-holder',expiresAt:new Date(Math.min(evidenceExpiry,input.publicationDeadline!)).toISOString()}) as unknown as Awaited<ReturnType<typeof compileDbStartedCloudSourcePublication>>);
 const relay=new FilePilotRelay('unused');
 const sql=vi.spyOn(relay,'sql').mockImplementation(async(kind,_sql,deadline,signal)=>{
  calls.push({kind,at:Date.now(),deadline,...(signal?{signal}:{})});
  if(kind==='READ_PUBLICATION_CONTEXT')return [{context:{checkedAt:new Date().toISOString()}}];
  if(kind==='PUBLISH'){
   published();
   if(mode==='ack')return [];
   if(mode==='late-ack'){await delay(deadline-Date.now()-1000);return [];}
   if(mode==='no-ack'){await delay(deadline-Date.now());throw Error('RELAY_DEADLINE');}
   if(mode==='cancelled'){controller.abort();throw new DOMException('cancelled','AbortError');}
   if(mode==='rollback')throw new PilotSqlFailure('ROLLED_BACK','57014');
   if(mode==='not-dispatched')throw new PilotSqlFailure('NOT_DISPATCHED','REVIEW_DENIED');
   if(mode==='ambiguous-rollback')throw new PilotSqlFailure('ROLLED_BACK','40003');
   throw new PilotSqlFailure('UNKNOWN','CONNECTION_LOST');
  }
  if(kind==='READ_OUTCOME')return [{row:null,batch:null,holderId:''}];
  throw Error('UNEXPECTED_WRITE_OR_RETRY');
 });
 const input={relay,controlPath:'synthetic-control.json',planned,source,initialCertificate:{},overallDeadline,signal:controller.signal} as unknown as Parameters<typeof runDbStartedCloudPublication>[0];
 return {input,relay,sql,calls,controller,compiler,publishStarted,cutoff:Math.min(evidenceExpiry,overallDeadline-2*PILOT_BUDGET.controlMs)};
}

describe('DB-started publication stays inside the original outer budget',()=>{
 it.each(['unknown','no-ack','cancelled','ambiguous-rollback'] as const)('waits for the same shortened cutoff after %s, then reads once without replaying',async mode=>{
  const f=fixture(mode),run=runDbStartedCloudPublication(f.input);await f.publishStarted;
  expect(f.compiler.mock.calls[0]![0].publicationDeadline).toBe(f.cutoff);
  expect(f.calls[0]!.deadline).toBe(f.cutoff-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs);
  expect(f.calls[1]!.deadline).toBe(f.cutoff);
  await vi.advanceTimersByTimeAsync(f.cutoff-Date.now()-1);
  expect(f.calls.map(c=>c.kind)).toEqual(['READ_PUBLICATION_CONTEXT','PUBLISH']);
  await vi.advanceTimersByTimeAsync(1);
  expect(await run).toMatchObject({state:'CONFLICT',publishAcknowledged:false});
  const read=f.calls[2]!;
  expect(read.kind).toBe('READ_OUTCOME');expect(read.at).toBe(f.cutoff);
  expect(read.deadline).toBe(f.input.overallDeadline-PILOT_BUDGET.controlMs);
  expect(read.signal).not.toBe(f.controller.signal);expect(read.signal?.aborted).toBe(false);
  expect(f.calls.map(c=>c.kind)).toEqual(['READ_PUBLICATION_CONTEXT','PUBLISH','READ_OUTCOME']);
 });

 it('keeps an earlier evidence expiry unchanged',async()=>{
  const f=fixture('unknown',NOW+10*60_000),run=runDbStartedCloudPublication(f.input);await f.publishStarted;
  await vi.advanceTimersByTimeAsync(10*60_000);
  expect(await run).toMatchObject({publishAcknowledged:false});
  expect(f.calls[1]!.deadline).toBe(NOW+10*60_000);
  expect(f.calls[2]!.deadline).toBe(NOW+11*60_000);
 });

 it.each(['ack','late-ack','rollback','not-dispatched'] as const)('preserves %s handling and still reads the persisted result',async mode=>{
  const f=fixture(mode),run=runDbStartedCloudPublication(f.input);await f.publishStarted;
  if(mode==='late-ack')await vi.advanceTimersByTimeAsync(f.cutoff-Date.now()-1000);
  expect(await run).toMatchObject({publishAcknowledged:mode==='ack'||mode==='late-ack'});
  expect(f.calls.map(c=>c.kind)).toEqual(['READ_PUBLICATION_CONTEXT','PUBLISH','READ_OUTCOME']);
  expect(f.calls[2]!.at).toBe(mode==='late-ack'?f.cutoff-1000:NOW);
 });

 it('hands off UNKNOWN without reading when a late wake consumed the final read reserve',async()=>{
  const f=fixture(),run=runDbStartedCloudPublication(f.input);const failed=expect(run).rejects.toThrow('PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION');await f.publishStarted;
  vi.setSystemTime(f.input.overallDeadline-PILOT_BUDGET.controlMs-PILOT_BUDGET.controlCompletionMs);
  await vi.advanceTimersByTimeAsync(f.cutoff-NOW);
  await failed;expect(f.calls.map(c=>c.kind)).toEqual(['READ_PUBLICATION_CONTEXT','PUBLISH']);
 });

 it.each(['failure','cancelled','late-response'] as const)('retains UNKNOWN on a final read %s',async mode=>{
  const f=fixture('ack'),base=f.sql.getMockImplementation()!;
  f.sql.mockImplementation(async(...args)=>{
   if(args[0]!=='READ_OUTCOME')return base(...args);
   if(mode==='late-response'){vi.setSystemTime(args[2]);return [{row:null,batch:null,holderId:''}];}
   throw mode==='cancelled'?new DOMException('cancelled','AbortError'):Error('READ_FAILED');
  });
  await expect(runDbStartedCloudPublication(f.input)).rejects.toThrow('PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION');
  expect(f.sql.mock.calls.filter(c=>c[0]==='PUBLISH')).toHaveLength(1);
  expect(f.sql.mock.calls.filter(c=>c[0]==='READ_OUTCOME')).toHaveLength(1);
 });

 it('gives the read its own bounded cancellation even when the write was cancelled',async()=>{
  const f=fixture('cancelled'),base=f.sql.getMockImplementation()!;let readSignal:AbortSignal|undefined;
  f.sql.mockImplementation(async(...args)=>{
   if(args[0]!=='READ_OUTCOME')return base(...args);
   readSignal=args[3];expect(readSignal?.aborted).toBe(false);
   await delay(args[2]-Date.now());throw new DOMException('read deadline','TimeoutError');
  });
  const run=runDbStartedCloudPublication(f.input),failed=expect(run).rejects.toThrow('PILOT_OUTCOME_UNKNOWN_REQUIRES_READONLY_RECONCILIATION');await f.publishStarted;
  await vi.advanceTimersByTimeAsync(f.cutoff-NOW+PILOT_BUDGET.controlMs);
  await failed;expect(readSignal).toBeDefined();expect(readSignal).not.toBe(f.controller.signal);
  expect(f.sql.mock.calls.filter(c=>c[0]==='PUBLISH')).toHaveLength(1);
 });

 it('rejects a compiler response that attempts to enlarge the cutoff',async()=>{
  const f=fixture();const base=f.compiler.getMockImplementation()!;
  f.compiler.mockImplementation(async input=>({...await base(input),expiresAt:new Date(f.cutoff+1).toISOString()}));
  await expect(runDbStartedCloudPublication(f.input)).rejects.toThrow('PILOT_EVIDENCE_EXPIRY_CHANGED');
  expect(f.calls.map(c=>c.kind)).toEqual(['READ_PUBLICATION_CONTEXT']);
 });

 it('rechecks the write reserve after slow compilation',async()=>{
  const f=fixture();const base=f.compiler.getMockImplementation()!;
  f.compiler.mockImplementation(async input=>{const packet=await base(input);vi.setSystemTime(f.cutoff-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs);return packet;});
  await expect(runDbStartedCloudPublication(f.input)).rejects.toThrow('PILOT_PUBLICATION_BUDGET_EXHAUSTED');
  expect(f.calls.map(c=>c.kind)).toEqual(['READ_PUBLICATION_CONTEXT']);
 });

 it('accepts only strictly more than the minimum scheduling reserve',()=>{
  expect(()=>requireDbStartedOuterDeadline(NOW+MINIMUM)).toThrow('PILOT_PUBLICATION_BUDGET_EXHAUSTED');
  expect(requireDbStartedOuterDeadline(NOW+MINIMUM+1)).toBe(NOW+MINIMUM+1);
 });
});

describe.each([runCloudSourcePilot,runCloudPortableSourcePilot])('DB-started entry fails before any capture or relay',runner=>{
 it.each([undefined,NaN,Infinity,NOW+0.5,Number.MAX_SAFE_INTEGER+1,NOW-1,NOW+MINIMUM])('rejects invalid or insufficient outer deadline %s',async overallDeadline=>{
  const http=vi.spyOn(globalThis,'fetch'),sql=vi.spyOn(FilePilotRelay.prototype,'sql'),request=vi.spyOn(FilePilotRelay.prototype,'request');
  await expect(runner({bootstrapPath:'never-read',reviewedSha256:'unused',workspaceRoot:'unused',relayDirectory:'unused',dbStartedControlPath:'unused',...(overallDeadline===undefined?{}:{overallDeadline})})).rejects.toThrow(/PILOT_(OUTER_DEADLINE_REQUIRED|PUBLICATION_BUDGET_EXHAUSTED)/);
  expect(http).not.toHaveBeenCalled();expect(sql).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
 });
});
