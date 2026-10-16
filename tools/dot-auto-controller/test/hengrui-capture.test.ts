import {createHengruiMokaSynthetic} from './fixtures/hengrui-moka-synthetic.mts';
/** Synthetic HTTP and mock bootstrap/context only. No live qualification. */
import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {P0_LAUNCH_MANIFEST,selectLaunchCompanies} from '../vendor/c60-source/src/release/launchManifest';
import {candidateCompanies} from '../vendor/c60-source/src/data/companyRegistry';
import {buildStagedSourceCrawlPlans} from '../vendor/c60-source/src/crawler/sourcePlan';
import {hashCanonicalStringSet} from '../vendor/c60-source/src/crawler/runtimeBatchIdentity';
import {buildAtomicRuntimeCommit,verifyAtomicRuntimeCommitForPersistence} from '../vendor/c60-source/src/crawler/runtimeAtomicEvidence';
import {issueSourceQualityAdmission} from '../vendor/c60-source/src/crawler/sourceQualityAdmission';
const shared=vi.hoisted(()=>({plans:[] as any[],identity:{} as any,failures:[] as any[]}));
vi.mock('../vendor/c60-source/src/crawler/stagedScheduleAuthority.ts',()=>({resolveCurrentStagedScheduleAuthority:async()=>({plans:shared.plans,identity:shared.identity})}));
vi.mock('../vendor/c60-source/scripts/p0-cloud-source-pilot.ts',()=>({PILOT_SOURCE:'source-hengrui-social',selectedPilotIdentity:()=>shared.identity,loadPilotContext:async()=>({baselineCompletedBeforeCrawl:true}),preservePilotFailure:async(x:any)=>{shared.failures.push(x.phase);}}));
import {captureHengruiNative,assertHengruiRefreshPlan,HENGRUI_SOURCE_ID,portablePreLockReadyDeadline} from '../native/hengrui-native-capture.mts';
import {assertHengruiPacketDeadline} from '../native/hengrui-deadline-gate.mts';
import {reviewHengruiRawPages} from '../native/hengrui-raw-review.mts';
import {compilerForHengrui} from '../native/hengrui-compiler.mts';
const now=Date.parse('2026-10-16T00:00:00Z'),dirs:string[]=[];
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
async function setup(options:any={}){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);shared.plans=buildStagedSourceCrawlPlans(selectLaunchCompanies(P0_LAUNCH_MANIFEST,candidateCompanies));shared.failures=[];
 shared.identity={releaseCandidateId:'synthetic-hengrui',commitSha:'a'.repeat(40),rosterSha256:'a'.repeat(64),sourcePlanSha256:'a'.repeat(64),sourceConfigSha256:'a'.repeat(64),adapterBundleSha256:'a'.repeat(64),batchKind:'SCHEDULED',ownerId:'dot-cloud-hengrui-social-pilot',expectedPlannedSourceIds:[HENGRUI_SOURCE_ID],expectedPlannedSourceSetSha256:hashCanonicalStringSet([HENGRUI_SOURCE_ID]),expectedPlannedSourceCount:1};
 const root=await mkdtemp(path.join(tmpdir(),'hengrui-adapter-offline-'));dirs.push(root);
 const bootstrap={schemaVersion:1,checkedAt:new Date().toISOString(),candidateRows:[],batchId:'synthetic-hengrui-batch'},bytes=JSON.stringify(bootstrap);await writeFile(root+'/bootstrap.json',bytes);
 let reads=0;const synthetic=createHengruiMokaSynthetic(options);
 vi.stubGlobal('fetch',synthetic.fetch);
 const input={bootstrapPath:root+'/bootstrap.json',reviewedSha256:sha(bytes),workspaceRoot:root,relayDirectory:root+'/relay',dbStartedControlPath:root+'/synthetic-control.json',overallDeadline:now+1800000,relay:{request:async(kind:string,_payload:any,_deadline:number,parse:Function)=>{reads++;expect(kind).toBe('READ_CONTEXT');return parse({checkedAt:new Date().toISOString()});}} as any};
 return {input,root,bootstrap,synthetic,calls:()=>synthetic.requests.length,reads:()=>reads};
}
afterEach(async()=>{vi.useRealTimers();vi.unstubAllGlobals();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
describe('Hengrui automatic acquisition stage',()=>{
 it('owned Moka, archive restore, admission and native atomic commit preserve all 7 rows',async()=>{
  const f=await setup(),c=await captureHengruiNative(f.input);expect(f.calls()).toBe(2);expect(f.reads()).toBe(1);expect(c.source.result.jobs).toHaveLength(7);expect(c.source.result.jobs.every(j=>!j.cities.includes('城市待核'))).toBe(true);expect(c.source.result.jobs.every(j=>j.officialPublishedAt===undefined)).toBe(true);
  expect(c.source.result.jobs.every(j=>j.officialUrl.startsWith('https://app.mokahr.com/social-recruitment/hengrui/145996#/job/'))).toBe(true);expect(sha(await readFile(c.bundlePath,'utf8'))).toBe(c.bundleSha256);
  const commit=buildAtomicRuntimeCommit({...c.source,previousJobs:[],baselineCompletedBeforeCrawl:true,firstAcceptedCurrentPolicyReceipt:null});await expect(verifyAtomicRuntimeCommitForPersistence(commit)).resolves.toBeUndefined();
 });
 it('zero postings retain original Moka verified-empty semantics',async()=>{const f=await setup({count:0}),c=await captureHengruiNative(f.input);expect(c.source.result.jobs).toEqual([]);expect(c.source.result.truth.completenessVerified).toBe(true);expect(reviewHengruiRawPages(c.source.result.fetchEvidence!,[],[])).toEqual([]);const commit=buildAtomicRuntimeCommit({...c.source,previousJobs:[],baselineCompletedBeforeCrawl:true,firstAcceptedCurrentPolicyReceipt:null});await expect(verifyAtomicRuntimeCommitForPersistence(commit)).resolves.toBeUndefined();expect(f.calls()).toBe(2);});
 it.each(['duplicate ID','wrong total','missing page','missing detail'])('rejects %s',async(kind)=>{
  const options=kind==='duplicate ID'?{duplicateId:true}:kind==='wrong total'?{totalByOffset:{0:8}}:kind==='missing page'?{count:52,missingPageOffset:50}:{hydrateIds:['synthetic-1'],missingDetailIds:['synthetic-1']};
  const f=await setup(options);await expect(captureHengruiNative(f.input)).rejects.toThrow();expect(shared.failures.length).toBe(1);
 });
 it('preserves multi-page IDs and native scope exclusions',async()=>{
  const f=await setup({count:52,excludeUS:true,excludeHK:true}),c=await captureHengruiNative(f.input);expect(c.source.result.jobs).toHaveLength(52);expect(c.source.result.fetchEvidence!.pages).toHaveLength(2);expect(c.source.result.fetchEvidence!.fetchLosses).toHaveLength(2);
  const native=c.source.result.jobs,current=native.map(j=>({...j,officialPublishedAt:null}));expect(reviewHengruiRawPages(c.source.result.fetchEvidence!,current,native)).toHaveLength(52);
 });
 it.each(['hash','old','future','missing control','deadline'])('rejects %s before HTTP',async(kind)=>{
  const f=await setup();if(kind==='hash')f.input.reviewedSha256='0'.repeat(64);else if(kind==='missing control')f.input.dbStartedControlPath='';else if(kind==='deadline')f.input.overallDeadline=now-1;else {f.bootstrap.checkedAt=new Date(now+(kind==='old'?-60001:1)).toISOString();const b=JSON.stringify(f.bootstrap);await writeFile(f.input.bootstrapPath,b);f.input.reviewedSha256=sha(b);}await expect(captureHengruiNative(f.input)).rejects.toThrow();expect(f.calls()).toBe(0);
 });
 it('rejects wrong source, site, native scope or added recency window',async()=>{
  await setup();for(const change of [(p:any)=>p.source.id='source-gsk-china-social',(p:any)=>p.moka.expectedSiteId='148067',(p:any)=>delete p.moka.scopeExclusionProof,(p:any)=>p.moka.publishedWithinDays=30]){const p=structuredClone(shared.plans.find(p=>p.source.id===HENGRUI_SOURCE_ID));change(p);expect(()=>assertHengruiRefreshPlan(p)).toThrow('HENGRUI_EXACT_MOKA_PLAN_REQUIRED');}
 });
 it('rejects serialized ownership and forged cities',async()=>{
  const f=await setup(),c=await captureHengruiNative(f.input);const input={plan:c.source.plan,result:c.source.result,binding:{releaseCandidateId:c.source.identity.releaseCandidateId,batchId:c.source.batchId,sourceResultId:c.source.pending.id,sourceConfigSha256:c.source.pending.sourceConfigHash,adapterVersion:c.source.pending.adapterVersion},archive:{workspaceRoot:c.restoredRoot,evidenceSubdirectory:'cloud-pilot/runtime-evidence',artifacts:c.artifacts}};
  expect((await issueSourceQualityAdmission({...input,result:structuredClone(input.result)})).status).toBe('REJECTED');c.source.result.jobs[2].cities=['伪造城市'];expect((await issueSourceQualityAdmission(input)).status).toBe('REJECTED');
 });
 it('rejects corrupt restored archive without replacing original evidence',async()=>{
  const f=await setup(),c=await captureHengruiNative(f.input);const original=await readFile(c.bundlePath,'utf8');
  await writeFile(path.join(c.restoredRoot,c.artifacts[0].path),'corrupt');
  const decision=await issueSourceQualityAdmission({plan:c.source.plan,result:c.source.result,binding:{releaseCandidateId:c.source.identity.releaseCandidateId,batchId:c.source.batchId,sourceResultId:c.source.pending.id,sourceConfigSha256:c.source.pending.sourceConfigHash,adapterVersion:c.source.pending.adapterVersion},archive:{workspaceRoot:c.restoredRoot,evidenceSubdirectory:'cloud-pilot/runtime-evidence',artifacts:c.artifacts}});
  expect(decision.status).toBe('REJECTED');expect(await readFile(c.bundlePath,'utf8')).toBe(original);
 });
 it('rejects aborted capture before HTTP or context read',async()=>{const f=await setup();await expect(captureHengruiNative({...f.input,signal:AbortSignal.abort()})).rejects.toThrow();expect(f.calls()).toBe(0);expect(f.reads()).toBe(0);});
 it('independent raw packet projection checks every row against current and native data',async()=>{const f=await setup(),c=await captureHengruiNative(f.input),native=c.source.result.jobs,current=native.map(j=>({...j,officialPublishedAt:null}));expect(reviewHengruiRawPages(c.source.result.fetchEvidence!,current,native)).toHaveLength(7);});
 it.each(['forged city','changed URL','changed list URL','invented date','dropped terminal page','modified raw ID','modified encrypted original'])('independent raw gate rejects %s',async(kind)=>{
  const f=await setup(),c=await captureHengruiNative(f.input),native=c.source.result.jobs,current=native.map(j=>({...j,officialPublishedAt:null})),e=structuredClone(c.source.result.fetchEvidence!);
  if(kind==='forged city')current[0].cities=['城市待核'];else if(kind==='changed URL')current[0].officialUrl+='x';else if(kind==='changed list URL')current[0].listUrl='https://example.invalid/';else if(kind==='invented date')current[0].officialPublishedAt='2026-01-01T00:00:00Z' as any;else if(kind==='dropped terminal page')e.pages.pop();else if(kind==='modified raw ID')e.pages[0].rawJobIds[0]='forged';else e.artifacts[1].body='{}';expect(()=>reviewHengruiRawPages(e,current,native)).toThrow();
 });
 it('rejects exhausted evidence age',()=>{expect(()=>portablePreLockReadyDeadline({startedAt:new Date(now-1800001).toISOString(),finishedAt:new Date(now).toISOString()},now)).toThrow();});
 it('compiler cannot accept Takeda or TRUE_A',async()=>{await expect(compilerForHengrui({sourceId:'source-takeda-china-social',route:'PORTABLE'})).rejects.toThrow('HENGRUI_NATIVE_IDENTITY_ONLY');await expect(compilerForHengrui({sourceId:HENGRUI_SOURCE_ID,route:'TRUE_A'})).rejects.toThrow('HENGRUI_NATIVE_IDENTITY_ONLY');});
});

describe('Hengrui absolute evidence and original-run deadlines',()=>{
 function bound(){return {terminal:{startedAt:new Date(now).toISOString()},legacyCertificate:{schemaVersion:'plan-bound-source-quality-v1',acquisition:{finishedAt:new Date(now).toISOString()}},request:{expiresAt:new Date(now+20*60_000).toISOString(),payload:{dispatchBefore:new Date(now+20*60_000-165000).toISOString()}},originalOuterDeadline:now+22*60_000,now};}
 it('accepts only the exact original evidence/run budget',()=>{expect(assertHengruiPacketDeadline(bound()).originalPublicationDeadline).toBe(now+20*60_000);});
 it.each(['extend evidence','extend request within evidence','shorten request','extend dispatch','shorten dispatch','missing outer','expired evidence','expired dispatch','outer drift','clock before evidence','invalid clock'])('rejects %s',kind=>{const b=bound();if(kind==='extend evidence')b.request.expiresAt=new Date(now+60*60_000).toISOString();if(kind==='extend request within evidence')b.request.expiresAt=new Date(now+25*60_000).toISOString();if(kind==='shorten request')b.request.expiresAt=new Date(now+19*60_000).toISOString();if(kind==='extend dispatch')b.request.payload.dispatchBefore=new Date(now+19*60_000).toISOString();if(kind==='shorten dispatch')b.request.payload.dispatchBefore=new Date(now+16*60_000).toISOString();if(kind==='missing outer')delete (b as any).originalOuterDeadline;if(kind==='expired evidence')b.now=now+31*60_000;if(kind==='expired dispatch')b.now=now+20*60_000-165000;if(kind==='outer drift')b.originalOuterDeadline++;if(kind==='clock before evidence')b.now=now-1;if(kind==='invalid clock')b.now=Number.NaN;expect(()=>assertHengruiPacketDeadline(b)).toThrow();});
});
