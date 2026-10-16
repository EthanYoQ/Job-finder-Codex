/** Offline shared-boundary regression: real owned HTTP/archive/admission, real
 * baseline loader/compiler/build identity. SQL is produced but never dispatched. */
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import {mkdtemp,writeFile,readdir} from 'node:fs/promises';
import {FilePilotRelay,sha256} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
import {runCloudPortableSourcePilot} from '../vendor/c60-source/scripts/p0-cloud-portable-source-pilot.ts';
import { mkdirSync, readFileSync } from 'node:fs';
const selectedSource=process.env.JOBFINDER_CLOUD_SOURCE_ID;
// Biogen's original 20 x 3 page bound cannot admit a 100-job baseline.
const baselineCount=selectedSource==='source-biogen-china-social'?60:100;
const kit=selectedSource==='source-ucb-china-social'?await import('./ucb-synthetic-fixture.mts'):selectedSource==='source-biogen-china-social'?await import('./biogen-synthetic-fixture.mts'):selectedSource==='source-hengrui-social'?await import('./hengrui-synthetic-fixture.mts'):selectedSource==='source-takeda-china-social'?await import('./shared-completeness-takeda-fixture.mts'):undefined;
if(!kit)throw Error('SHARED_GUARD_CANONICAL_TEST_SOURCE_REQUIRED');
const {fixture,priorFrom,initialize,configureSyntheticFixtureRuntime,request}=kit;
import { compileDbStartedCloudSourcePublication, prepareDbStartedCloudPublicationReplay } from '../vendor/c60-source/src/db/ingestionRepository.ts';
import { loadPilotContext } from '../vendor/c60-source/src/crawler/cloudPilotContext.ts';
import { evaluateCompletenessAnomalyForCrawl } from '../vendor/c60-source/src/crawler/completenessAnomalyPolicy.ts';
import { buildAtomicRuntimeCommit } from '../vendor/c60-source/src/crawler/runtimeAtomicEvidence.ts';
const gateModule=selectedSource==='source-ucb-china-social'?await import('./ucb-publication-review.mts'):selectedSource==='source-biogen-china-social'?await import('./biogen-publication-review.mts'):selectedSource==='source-takeda-china-social'?await import('./takeda-publication-review.mts'):await import('./hengrui-publication-review.mts');
const prepareReview:any=(gateModule as any).prepareHengruiConnectorPublicationReview??(gateModule as any).prepareUcbConnectorPublicationReview??(gateModule as any).prepareBiogenConnectorPublicationReview??(gateModule as any).prepareTakedaConnectorPublicationReview;
const consumeReview:any=(gateModule as any).consumeReviewedHengruiPublication??(gateModule as any).consumeReviewedUcbPublication??(gateModule as any).consumeReviewedBiogenPublication??(gateModule as any).consumeReviewedTakedaPublication;
const root=resolve('vendor/c60-source');
const evidence=process.env.SHARED_GUARD_EVIDENCE_ROOT;
if (!evidence) throw Error('SHARED_GUARD_EXTERNAL_EVIDENCE_REQUIRED');
mkdirSync(evidence,{recursive:true});
const priors=new Map<number,any>();
let syntheticCount=0;
function syntheticBiogenFetch(){
 const base=JSON.parse(readFileSync(resolve('test/fixtures/biogen-synthetic.json'),'utf8'));
 const rows=Array.from({length:syntheticCount},(_,i)=>({...base.jobPostings[0],title:'Synthetic Shared Biogen Role '+i,externalPath:'/job/'+(i?'Shanghai':'Beijing')+'-China/Synthetic-Role_REQ'+(10000+i)+'-1',locationsText:(i?'Shanghai':'Beijing')+', China',bulletFields:['REQ'+(10000+i)]}));
 return async(url:any,init:any)=>{
  if(String(url)!=='https://biibhr.wd3.myworkdayjobs.com/wday/cxs/biibhr/external/jobs'||init.method!=='POST')throw Error('SYNTHETIC_BIOGEN_REQUEST');
  const body=JSON.parse(init.body),offset=Number(body.offset),limit=Number(body.limit);
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<=0)throw Error('SYNTHETIC_BIOGEN_PAGINATION');
  const data={...base,total:rows.length,jobPostings:rows.slice(offset,offset+limit)};
  for(const facet of data.facets[0].values){
   for(const value of facet.values)value.count=value.descriptor==='China'?rows.length:value.descriptor==='Shanghai, China'?Math.max(0,rows.length-1):Math.min(1,rows.length);
   if(facet.facetParameter==='locations')facet.values=facet.values.filter((value:any)=>value.count>0);
  }
  return {status:200,url:String(url),headers:new Headers({'content-type':'application/json'}),text:async()=>JSON.stringify(data)};
 };
}
beforeAll(()=>{
 const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 initialize({commitSha:head,candidate:{id:'synthetic-shared-guard',goalId:'jobfinder-portable-required-40',version:100},databaseIdentity:{migrationVersion:'20261014141000_v75_retired_candidate_fence',schemaHash:'6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7',dbSnapshotHash:'e'.repeat(64)}});
 configureSyntheticFixtureRuntime({setClock:at=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);},installFetch:fn=>vi.stubGlobal('fetch',selectedSource==='source-biogen-china-social'?syntheticBiogenFetch():fn)});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function captured(count:number,prior:any=null,at=prior?'2026-10-12T10:00:00.000Z':'2026-10-11T10:00:00.000Z'){
 syntheticCount=count;
 return (fixture as any)({at,prior,syntheticOptions:{count},ids:Array.from({length:count},(_,i)=>String(10001+i)),pageSize:50,syntheticArtifactParent:evidence});
}
async function accepted(count:number){
 if(!priors.has(count)){const first=await captured(count);const packet=await compileDbStartedCloudSourcePublication(first.input.publication);priors.set(count,await priorFrom(first,packet));}
 return structuredClone(priors.get(count));
}
it(`automatically blocks authentic ${baselineCount}-to-1 with omitted caller trigger before any delta/SQL packet`,async()=>{
 const f=await captured(1,await accepted(baselineCount)),source=f.input.publication.source;
 expect(Object.hasOwn(source,'completenessAnomalyTriggerCodes')).toBe(false);
 const context=await loadPilotContext(f.input.publication.control.context,source.plan,false);
 expect(context.trustedCompletenessBaseline?.certifiedJobCount).toBe(baselineCount);
 const anomaly=evaluateCompletenessAnomalyForCrawl(source.plan,source.result,context.trustedCompletenessBaseline);
 expect(anomaly.triggerCodes).toContain('TRUSTED_COUNT_DROP');
 await expect(compileDbStartedCloudSourcePublication(f.input.publication)).rejects.toThrow('PILOT_REAL_CERTIFICATE_REQUIRED');
 await expect(prepareDbStartedCloudPublicationReplay(f.input.publication)).rejects.toThrow('PILOT_REAL_CERTIFICATE_REQUIRED');
 // The unchanged atomic builder suppresses lifecycle writes before the shared
 // compiler's existing refusal. This supplements, not replaces, omitted-input RED.
 const commit=buildAtomicRuntimeCommit({...source,...context,completenessAnomalyTriggerCodes:anomaly.triggerCodes});
 expect(commit.sourceResult.completenessState).not.toBe('VERIFIED');
 expect(commit.sourceResult.blockerCode).toBe('COMPLETENESS_ANOMALY_UNVERIFIED');
 expect(commit.commands.filter((c:any)=>c.type==='UPSERT_JOB')).toEqual([]);
 expect(commit.sourceResult.baselineChangeReason??null).toBeNull();
});
it('real owned publication gate produces no token or request for the same count drop',async()=>{
 const f=await captured(1,await accepted(baselineCount));
 await expect(prepareReview(f.input)).rejects.toThrow('PILOT_REAL_CERTIFICATE_REQUIRED');
});
it.each([[baselineCount,baselineCount*0.6],[40,20],[50,30],[20,0]].filter(([,current])=>selectedSource!=='source-takeda-china-social'||current!==0))('original absolute and percent boundary rejects %i-to-%i',async(previous,current)=>{
 const f=await captured(current,await accepted(previous));
 await expect(compileDbStartedCloudSourcePublication(f.input.publication)).rejects.toThrow('PILOT_REAL_CERTIFICATE_REQUIRED');
});
it.each([[baselineCount,baselineCount*0.6+1],[40,21],[19,0],[baselineCount,baselineCount],[baselineCount-10,baselineCount]].filter(([,current])=>selectedSource!=='source-takeda-china-social'||current!==0))('original non-trigger case preserves %i-to-%i',async(previous,current)=>{
 const f=await captured(current,await accepted(previous));const packet=await compileDbStartedCloudSourcePublication(f.input.publication);
 expect(packet.commit.sourceResult.dedupeOutputCount).toBe(current);
 expect(packet.commit.sourceResult.completenessState).toBe('VERIFIED');
 expect(packet.commit.sourceResult.baselinePreviousJobCount).toBe(previous);
});
it.each(selectedSource==='source-takeda-china-social'?[1]:[0,1])('genuine null/null baseline permits initial %i count',async(count)=>{
 const f=await captured(count);const packet=await compileDbStartedCloudSourcePublication(f.input.publication);
 expect(packet.commit.sourceResult.baselinePreviousSourceResultId).toBeNull();expect(packet.commit.sourceResult.baselinePreviousJobCount).toBeNull();
 expect(packet.commit.sourceResult.baselineChangeReason).toBe('PLAN_BOUND_REPLAY_CONFIRMED_INITIAL');
});
it.each(['latest-absent','first-absent','half-null','source','config','row-source','row-config','receipt-hash','receipt-count','receipt-time','capture-before-baseline'])('rejects bad trusted context: %s',async(mode)=>{
 const f=await captured(baselineCount,await accepted(baselineCount));const ctx=f.input.publication.control.context;
 if(mode==='latest-absent')delete ctx.latestAccepted;
 if(mode==='first-absent')delete ctx.firstAccepted;
 if(mode==='half-null')ctx.latestAccepted=null;
 const wrongSource=selectedSource==='source-takeda-china-social'?'source-hengrui-social':'source-takeda-china-social';
 if(mode==='source')ctx.sourceId=wrongSource;
 if(mode==='config')ctx.sourceConfigSha256='0'.repeat(64);
 if(mode==='row-source')ctx.latestAccepted.sourceId=wrongSource;
 if(mode==='row-config')ctx.latestAccepted.sourceConfigHash='0'.repeat(64);
 if(mode==='receipt-hash')ctx.latestAccepted.completenessCertificateSha256='0'.repeat(64);
 if(mode==='receipt-count')ctx.latestAccepted.dedupeOutputCount=1;
 if(mode==='receipt-time')ctx.latestAccepted.finishedAt='2026-10-11T11:00:00.000Z';
 if(mode==='capture-before-baseline')f.input.publication.source.pending.startedAt=new Date('2026-10-10T10:00:00.000Z');
 await expect(compileDbStartedCloudSourcePublication(f.input.publication)).rejects.toThrow();
});
it.each([{codes:[] as string[]},{codes:['UNKNOWN_TRIGGER']}])('preserves original rejection of caller trigger $codes before union',async({codes})=>{
 const f=await captured(1,await accepted(baselineCount));f.input.publication.source.completenessAnomalyTriggerCodes=codes;
 await expect(compileDbStartedCloudSourcePublication(f.input.publication)).rejects.toThrow('completeness anomaly trigger codes are empty or invalid');
});
it('retains a valid caller trigger on a normal count',async()=>{
 const f=await captured(baselineCount,await accepted(baselineCount));f.input.publication.source.completenessAnomalyTriggerCodes=['LAST_PAGE_WITH_NEXT_SIGNAL'];
 await expect(compileDbStartedCloudSourcePublication(f.input.publication)).rejects.toThrow('PILOT_REAL_CERTIFICATE_REQUIRED');
});
it('normal full replay and gate consumption preserve original CAS, ownership and one-shot capability',async()=>{
 const f=await captured(baselineCount,await accepted(baselineCount));const prepared=await prepareDbStartedCloudPublicationReplay(f.input.publication);
 expect(await prepared.recompile()).toEqual(prepared.packet);
 for(const text of ['CRAWL_LEASE_BUSY','PILOT_CONTEXT_CHANGED','PILOT_V75_FENCE_FUNCTION_DRIFT','LOCK TABLE',"(current_context-'checkedAt') IS DISTINCT FROM (expected_context_data-'checkedAt')"]){expect(prepared.packet.sql).toContain(text);}
 const gate=await prepareReview(f.input),r=request(gate.packet),token=await gate.review(r);
 expect((await consumeReview(token,r)).mode).toBe('OFFLINE_REVIEW_ONLY');
 await expect(consumeReview(token,r)).rejects.toThrow('REVIEW_SAME_PROCESS_CAPABILITY_REQUIRED');
});
it('full recompile rejects trusted context mutation instead of refreshing baseline',async()=>{
 const f=await captured(baselineCount,await accepted(baselineCount)),prepared=await prepareDbStartedCloudPublicationReplay(f.input.publication);
 f.input.publication.control.context.latestAccepted.dedupeOutputCount=101;
 await expect(prepared.recompile()).rejects.toThrow('PILOT_REVIEW_INPUT_CHANGED');
});
it('consumption rechecks input and burns the changed-context capability',async()=>{
 const f=await captured(baselineCount,await accepted(baselineCount)),gate=await prepareReview(f.input),r=request(gate.packet),token=await gate.review(r);
 f.input.publication.control.context.latestAccepted.dedupeOutputCount=101;
 await expect(consumeReview(token,r)).rejects.toThrow('REVIEW_INPUT_CHANGED');
 await expect(consumeReview(token,r)).rejects.toThrow('REVIEW_SAME_PROCESS_CAPABILITY_REQUIRED');
});

it('actual portable CLI captures, archives, reloads fresh context and refuses before PUBLISH',async()=>{
 const f=await captured(1,await accepted(baselineCount)),workspaceRoot=await mkdtemp(join(evidence!,'actual-cli-'));
 const {context,planned:ignored,...control}=f.input.publication.control;
 const bootstrapPath=join(workspaceRoot,'bootstrap.json'),controlPath=join(workspaceRoot,'control.json');
 const bytes=JSON.stringify({schemaVersion:1,checkedAt:new Date().toISOString(),candidateRows:[context.candidateRow],batchId:'shared-cli-'+selectedSource});
 await writeFile(bootstrapPath,bytes);await writeFile(controlPath,JSON.stringify(control));
 const calls:string[]=[];
 // These two ports are external database responses only. Authority, acquisition,
 // owned receipt, archive, context loader and compiler all remain the originals.
 vi.spyOn(FilePilotRelay.prototype,'request').mockImplementation(async(kind,_payload,_deadline,parse)=>{
  calls.push(kind);if(kind!=='READ_CONTEXT')throw Error('UNEXPECTED_EXTERNAL_REQUEST');
  return parse({...context,checkedAt:new Date().toISOString()});
 });
 vi.spyOn(FilePilotRelay.prototype,'sql').mockImplementation(async(kind)=>{
  calls.push(kind);if(kind!=='READ_PUBLICATION_CONTEXT')throw Error('UNEXPECTED_PUBLICATION');
  return [{context:{...context,checkedAt:new Date().toISOString()}}];
 });
 const cwd=process.cwd();process.chdir(root);
 try{
  await expect(runCloudPortableSourcePilot({bootstrapPath,reviewedSha256:sha256(bytes),workspaceRoot,relayDirectory:join(workspaceRoot,'relay'),dbStartedControlPath:controlPath,overallDeadline:Date.now()+22*60_000})).rejects.toThrow('PILOT_REAL_CERTIFICATE_REQUIRED');
 }finally{process.chdir(cwd);}
 expect(calls).toEqual(['READ_CONTEXT','READ_PUBLICATION_CONTEXT']);
 const files=await readdir(workspaceRoot);expect(files.some(name=>name.endsWith('.archive.json'))).toBe(true);
 expect(files.some(name=>name.endsWith('.outcome.json'))).toBe(false);
});
