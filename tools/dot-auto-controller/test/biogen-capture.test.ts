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
vi.mock('../vendor/c60-source/scripts/p0-cloud-source-pilot.ts',()=>({PILOT_SOURCE:'source-biogen-china-social',selectedPilotIdentity:()=>shared.identity,loadPilotContext:async()=>({baselineCompletedBeforeCrawl:true}),preservePilotFailure:async(x:any)=>{shared.failures.push(x.phase);}}));
import {captureBiogenNative,assertBiogenRefreshPlan,BIOGEN_SOURCE_ID,portablePreLockReadyDeadline} from '../native/biogen-native-capture.mts';
import {assertBiogenPacketDeadline} from '../native/biogen-deadline-gate.mts';
import {reviewBiogenRawPages} from '../native/biogen-raw-review.mts';
import {compilerForBiogen} from '../native/biogen-compiler.mts';
const now=Date.parse('2026-10-16T00:00:00Z'),dirs:string[]=[];
const raw=readFileSync(path.resolve('test/fixtures/biogen-synthetic.json'),'utf8');
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
async function setup(mutate?:(b:any)=>void){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);shared.plans=buildStagedSourceCrawlPlans(selectLaunchCompanies(P0_LAUNCH_MANIFEST,candidateCompanies));shared.failures=[];
 shared.identity={releaseCandidateId:'synthetic-biogen',commitSha:'a'.repeat(40),rosterSha256:'a'.repeat(64),sourcePlanSha256:'a'.repeat(64),sourceConfigSha256:'a'.repeat(64),adapterBundleSha256:'a'.repeat(64),batchKind:'SCHEDULED',ownerId:'dot-cloud-biogen-china-social-pilot',expectedPlannedSourceIds:[BIOGEN_SOURCE_ID],expectedPlannedSourceSetSha256:hashCanonicalStringSet([BIOGEN_SOURCE_ID]),expectedPlannedSourceCount:1};
 const root=await mkdtemp(path.join(tmpdir(),'biogen-adapter-offline-'));dirs.push(root);
 const bootstrap={schemaVersion:1,checkedAt:new Date().toISOString(),candidateRows:[],batchId:'synthetic-biogen-batch'},bytes=JSON.stringify(bootstrap);await writeFile(root+'/bootstrap.json',bytes);
 let calls=0,reads=0;const body=JSON.parse(raw);mutate?.(body);
 vi.stubGlobal('fetch',async(url:string,request:any)=>{calls++;expect(url).toBe('https://biibhr.wd3.myworkdayjobs.com/wday/cxs/biibhr/external/jobs');expect(request.method).toBe('POST');expect(JSON.parse(request.body)).toEqual({appliedFacets:{locationCountry:['6cb77610a8a543aea2d6bc10457e35d4']},limit:20,offset:0});return {status:200,url,headers:new Headers({'content-type':'application/json'}),text:async()=>JSON.stringify(body)};});
 const input={bootstrapPath:root+'/bootstrap.json',reviewedSha256:sha(bytes),workspaceRoot:root,relayDirectory:root+'/relay',dbStartedControlPath:root+'/synthetic-control.json',overallDeadline:now+1800000,relay:{request:async(kind:string,_payload:any,_deadline:number,parse:Function)=>{reads++;expect(kind).toBe('READ_CONTEXT');return parse({checkedAt:new Date().toISOString()});}} as any};
 return {input,root,bootstrap,calls:()=>calls,reads:()=>reads};
}
afterEach(async()=>{vi.useRealTimers();vi.unstubAllGlobals();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
describe('Biogen automatic acquisition stage',()=>{
 it('owned Workday, archive restore, admission and native atomic commit preserve all 7 rows',async()=>{
  const f=await setup(),c=await captureBiogenNative(f.input);expect(f.calls()).toBe(1);expect(f.reads()).toBe(1);expect(c.source.result.jobs).toHaveLength(7);expect(c.source.result.jobs.filter(j=>j.cities.includes('城市待核'))).toHaveLength(3);expect(c.source.result.jobs.every(j=>j.officialPublishedAt===undefined)).toBe(true);
  const expected=JSON.parse(raw).jobPostings.map((r:any)=>c.source.plan.source.officialEntryUrl+r.externalPath).sort();expect(c.source.result.jobs.map(j=>j.officialUrl).sort()).toEqual(expected);expect(sha(await readFile(c.bundlePath,'utf8'))).toBe(c.bundleSha256);
  const commit=buildAtomicRuntimeCommit({...c.source,previousJobs:[],baselineCompletedBeforeCrawl:true,firstAcceptedCurrentPolicyReceipt:null});await expect(verifyAtomicRuntimeCommitForPersistence(commit)).resolves.toBeUndefined();
 });
 it('zero postings remain blocked by original native source-success gate',async()=>{const f=await setup(b=>{b.total=0;b.jobPostings=[];for(const facet of b.facets[0].values)for(const value of facet.values)value.count=0;});await expect(captureBiogenNative(f.input)).rejects.toThrow('PILOT_SUCCESSFUL_SOURCE_ONLY_FAILURE_FINALIZATION_REQUIRED');expect(f.calls()).toBe(1);});
 it.each(['wrong country','wrong total','wrong ID','foreign title','opaque location'])('rejects %s',async(kind)=>{
  const f=await setup(b=>{if(kind==='wrong country')b.facets.find((x:any)=>x.facetParameter==='locationMainGroup').values[0].values[0].descriptor='United States';else if(kind==='wrong total')b.total++;else if(kind==='wrong ID')b.jobPostings[0].bulletFields=['REQ999'];else if(kind==='foreign title')b.jobPostings[2].title='Role (Location: Boston)';else b.jobPostings[0].locationsText='2 Locations';});await expect(captureBiogenNative(f.input)).rejects.toThrow();expect(shared.failures.length).toBe(1);
 });
 it.each(['hash','old','future','missing control','deadline'])('rejects %s before HTTP',async(kind)=>{
  const f=await setup();if(kind==='hash')f.input.reviewedSha256='0'.repeat(64);else if(kind==='missing control')f.input.dbStartedControlPath='';else if(kind==='deadline')f.input.overallDeadline=now-1;else {f.bootstrap.checkedAt=new Date(now+(kind==='old'?-60001:1)).toISOString();const b=JSON.stringify(f.bootstrap);await writeFile(f.input.bootstrapPath,b);f.input.reviewedSha256=sha(b);}await expect(captureBiogenNative(f.input)).rejects.toThrow();expect(f.calls()).toBe(0);
 });
 it('rejects wrong source, removed China facet and modified geography policy',async()=>{
  await setup();for(const change of [(p:any)=>p.source.id='source-gsk-china-social',(p:any)=>p.workday.appliedFacets={},(p:any)=>delete p.workday.listGeographyPolicy]){const p=structuredClone(shared.plans.find(p=>p.source.id===BIOGEN_SOURCE_ID));change(p);expect(()=>assertBiogenRefreshPlan(p)).toThrow('BIOGEN_EXACT_WORKDAY_PLAN_REQUIRED');}
 });
 it('rejects serialized ownership and forged cities',async()=>{
  const f=await setup(),c=await captureBiogenNative(f.input);const input={plan:c.source.plan,result:c.source.result,binding:{releaseCandidateId:c.source.identity.releaseCandidateId,batchId:c.source.batchId,sourceResultId:c.source.pending.id,sourceConfigSha256:c.source.pending.sourceConfigHash,adapterVersion:c.source.pending.adapterVersion},archive:{workspaceRoot:c.restoredRoot,evidenceSubdirectory:'cloud-pilot/runtime-evidence',artifacts:c.artifacts}};
  expect((await issueSourceQualityAdmission({...input,result:structuredClone(input.result)})).status).toBe('REJECTED');c.source.result.jobs[2].cities=['上海'];expect((await issueSourceQualityAdmission(input)).status).toBe('REJECTED');
 });
 it('rejects corrupt restored archive without replacing original evidence',async()=>{
  const f=await setup(),c=await captureBiogenNative(f.input);const original=await readFile(c.bundlePath,'utf8');
  await writeFile(path.join(c.restoredRoot,c.artifacts[0].path),'corrupt');
  const decision=await issueSourceQualityAdmission({plan:c.source.plan,result:c.source.result,binding:{releaseCandidateId:c.source.identity.releaseCandidateId,batchId:c.source.batchId,sourceResultId:c.source.pending.id,sourceConfigSha256:c.source.pending.sourceConfigHash,adapterVersion:c.source.pending.adapterVersion},archive:{workspaceRoot:c.restoredRoot,evidenceSubdirectory:'cloud-pilot/runtime-evidence',artifacts:c.artifacts}});
  expect(decision.status).toBe('REJECTED');expect(await readFile(c.bundlePath,'utf8')).toBe(original);
 });
 it('rejects aborted capture before HTTP or context read',async()=>{const f=await setup();await expect(captureBiogenNative({...f.input,signal:AbortSignal.abort()})).rejects.toThrow();expect(f.calls()).toBe(0);expect(f.reads()).toBe(0);});
 it('independent raw packet projection checks every row against current and native data',async()=>{const f=await setup(),c=await captureBiogenNative(f.input),native=c.source.result.jobs,current=native.map(j=>({...j,officialPublishedAt:null}));expect(reviewBiogenRawPages([raw],current,native)).toHaveLength(7);});
 it.each(['foreign facet','wrong count','duplicate ID','unknown city','extra page','duplicate JSON key','forged city','changed URL','changed list URL','invented date'])('independent raw gate rejects %s',async(kind)=>{
  const f=await setup(),c=await captureBiogenNative(f.input),native=c.source.result.jobs,current=native.map(j=>({...j,officialPublishedAt:null}));const b=JSON.parse(raw);let bodies:string[];
  if(kind==='foreign facet')b.facets[0].values[0].values[0].descriptor='United States';else if(kind==='wrong count')b.total++;else if(kind==='duplicate ID')b.jobPostings[1]=b.jobPostings[0];else if(kind==='unknown city')b.jobPostings[0].title='Role (Location: Atlantis)';else if(kind==='forged city')current[0].cities=['城市待核'];else if(kind==='changed URL')current[0].officialUrl+='x';else if(kind==='changed list URL')current[0].listUrl='https://example.invalid/';else if(kind==='invented date')current[0].officialPublishedAt='2026-01-01T00:00:00Z' as any;
  bodies=kind==='extra page'?[raw,raw]:kind==='duplicate JSON key'?[raw.replace('"total": 7','"total": 7, "total": 7')]:[JSON.stringify(b)];expect(()=>reviewBiogenRawPages(bodies,current,native)).toThrow();
 });
 it('rejects exhausted evidence age',()=>{expect(()=>portablePreLockReadyDeadline({startedAt:new Date(now-1800001).toISOString(),finishedAt:new Date(now).toISOString()},now)).toThrow();});
 it('compiler cannot accept Takeda or TRUE_A',async()=>{await expect(compilerForBiogen({sourceId:'source-takeda-china-social',route:'PORTABLE'})).rejects.toThrow('BIOGEN_NATIVE_IDENTITY_ONLY');await expect(compilerForBiogen({sourceId:BIOGEN_SOURCE_ID,route:'TRUE_A'})).rejects.toThrow('BIOGEN_NATIVE_IDENTITY_ONLY');});
});

describe('Biogen absolute evidence and original-run deadlines',()=>{
 function bound(){return {terminal:{startedAt:new Date(now).toISOString()},legacyCertificate:{schemaVersion:'plan-bound-source-quality-v1',acquisition:{finishedAt:new Date(now).toISOString()}},request:{expiresAt:new Date(now+20*60_000).toISOString(),payload:{dispatchBefore:new Date(now+20*60_000-165000).toISOString()}},originalOuterDeadline:now+22*60_000,now};}
 it('accepts only the exact original evidence/run budget',()=>{expect(assertBiogenPacketDeadline(bound()).originalPublicationDeadline).toBe(now+20*60_000);});
 it.each(['extend evidence','extend request within evidence','shorten request','extend dispatch','shorten dispatch','missing outer','expired evidence','expired dispatch','outer drift','clock before evidence','invalid clock'])('rejects %s',kind=>{const b=bound();if(kind==='extend evidence')b.request.expiresAt=new Date(now+60*60_000).toISOString();if(kind==='extend request within evidence')b.request.expiresAt=new Date(now+25*60_000).toISOString();if(kind==='shorten request')b.request.expiresAt=new Date(now+19*60_000).toISOString();if(kind==='extend dispatch')b.request.payload.dispatchBefore=new Date(now+19*60_000).toISOString();if(kind==='shorten dispatch')b.request.payload.dispatchBefore=new Date(now+16*60_000).toISOString();if(kind==='missing outer')delete (b as any).originalOuterDeadline;if(kind==='expired evidence')b.now=now+31*60_000;if(kind==='expired dispatch')b.now=now+20*60_000-165000;if(kind==='outer drift')b.originalOuterDeadline++;if(kind==='clock before evidence')b.now=now-1;if(kind==='invalid clock')b.now=Number.NaN;expect(()=>assertBiogenPacketDeadline(b)).toThrow();});
});
