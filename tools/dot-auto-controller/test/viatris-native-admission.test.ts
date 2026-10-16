/** Focused native small tests only: no runtime/build identity, compiler, DB or official network. */
import {afterEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';import {mkdtemp,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createViatrisTupuSynthetic,type ViatrisSyntheticOptions,VIATRIS_SYNTHETIC_ENTRY} from './fixtures/viatris-tupu-synthetic.mts';
import {candidateCompanies} from '../vendor/c60-source/src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans,sourcePlanConfigSha256} from '../vendor/c60-source/src/crawler/sourcePlan.ts';
import {createOwnedSourceQualityFetch,issueSourceQualityAdmission,assertIssuedSourceQualityAdmission,getSourceQualityPolicy} from '../vendor/c60-source/src/crawler/sourceQualityAdmission.ts';
import {runSourceCrawl} from '../vendor/c60-source/src/crawler/runSourceCrawl.ts';
import {archiveSourceEvidence} from '../vendor/c60-source/src/crawler/artifactArchive.ts';
import {bindRuntimeEvidenceArtifactIds} from '../vendor/c60-source/src/crawler/runtimeAtomicEvidence.ts';
import {makeArchiveBundle,restoreArchiveBundle} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
import {buildSourceQualityJobCommands} from '../vendor/c60-source/src/crawler/sourceQualityPublication.ts';
const SOURCE='source-viatris-social',CONFIG='5eab6bd8ba6973176376f492b9ce2105d81d8cae5afd4d3518daa6ad3dfcdad9';
const plan=()=>structuredClone(buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===SOURCE)!);
const digest=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
async function capture(options:ViatrisSyntheticOptions={},isBaseline=false){const p=plan(),synthetic=createViatrisTupuSynthetic(options);vi.stubGlobal('fetch',synthetic.fetch);const result=await runSourceCrawl(p,{fetch:createOwnedSourceQualityFetch(),isBaseline});return {plan:p,result,synthetic};}
async function admitted(options:ViatrisSyntheticOptions={}){
 const f=await capture(options),workspaceRoot=await mkdtemp(join(tmpdir(),'viatris-native-original-')),restoredRoot=await mkdtemp(join(tmpdir(),'viatris-native-restored-'));
 const binding={releaseCandidateId:'synthetic-admission-only',batchId:'synthetic-batch',sourceResultId:'synthetic-result',sourceConfigSha256:sourcePlanConfigSha256(f.plan),adapterVersion:digest(readFileSync('vendor/c60-source/src/crawler/adapters/htmlTable.ts'))};
 const evidenceSubdirectory='synthetic-evidence',tuple={...binding,sourceId:SOURCE};
 const archived=await archiveSourceEvidence({workspaceRoot,...tuple,evidenceSubdirectory,captureTool:f.result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:f.result.fetchEvidence!.artifacts})});
 const bundle=await makeArchiveBundle({workspaceRoot,...tuple,evidenceSubdirectory,artifacts:archived.artifacts});
 await writeFile(join(workspaceRoot,'bundle.json'),JSON.stringify(bundle),{flag:'wx'});
 const restored=await restoreArchiveBundle(bundle,restoredRoot);
 const input={plan:f.plan,result:f.result,binding,archive:{workspaceRoot:restoredRoot,evidenceSubdirectory,artifacts:restored}};
 const admission=await issueSourceQualityAdmission(input);
 return {...f,input,admission,workspaceRoot,restoredRoot};
}
it('fixes exact original configured-channel source identity without pretending to know job totals',()=>{
 const p=plan();expect(sourcePlanConfigSha256(p)).toBe(CONFIG);expect(getSourceQualityPolicy(p)).toBe('PLAN_BOUND_SOURCE_QUALITY_V1');expect(p.source.officialEntryUrl).toBe(VIATRIS_SYNTHETIC_ENTRY);
 expect(p.adapterId).toBe('html-table');if(p.adapterId!=='html-table')throw Error('WRONG_PLAN');expect(p.table.completenessProof).toEqual({kind:'CONFIGURED_CHANNEL_TRAVERSAL'});expect(p.table.pagination).toMatchObject({pageSize:10,maxPages:60,ajaxMode:'tupu360'});
 p.source.officialEntryUrl+='&changed=1';expect(getSourceQualityPolicy(p)).toBeNull();
});
it('replays three native pages, exact POST social parameters, IDs and original URLs through two archives and owned admission',async()=>{
 const f=await admitted({count:23});expect(f.result.status).toBe('SUCCESS');expect(f.admission.status).toBe('ACCEPTED');expect(f.synthetic.requests).toHaveLength(3);
 expect(f.synthetic.requests.slice(1).map(r=>r.body)).toEqual(['offset=10&max=10&recruitmentType=SOCIALRECRUITMENT','offset=20&max=10&recruitmentType=SOCIALRECRUITMENT']);
 expect(f.result.jobs).toHaveLength(23);expect(f.result.jobs.map(j=>j.sourceJobId)).toEqual(f.synthetic.ids);expect(f.result.jobs.every(j=>j.isBaseline===false)).toBe(true);
 expect(f.result.jobs[0]!.officialUrl).toBe('https://careersite.tupu360.com/Viatris/position/detail?positionId=synthetic-1');
 expect(f.result.fetchEvidence!.declaredCompleteness).toMatchObject({kind:'COMPLETE_PAGE_TRAVERSAL',value:3,scope:'SOURCE'});expect(f.result.observation.expectedJobCount).toBeUndefined();
 expect(f.result.fetchEvidence!.pages.every(p=>p.declaredTotal===null)).toBe(true);expect(f.result.fetchEvidence!.pages.at(-1)!.termination).toBe('NEXT_ABSENT');
 if(f.admission.status!=='ACCEPTED')throw Error('ADMISSION_REJECTED');expect(f.admission.receipt.observation.expectedJobCount).toBeNull();expect(f.admission.receipt.declaredCompleteness.kind).toBe('COMPLETE_PAGE_TRAVERSAL');
 assertIssuedSourceQualityAdmission(f.admission,f.result,f.plan);expect(()=>assertIssuedSourceQualityAdmission(structuredClone(f.admission),f.result,f.plan)).toThrow();
 const commands=buildSourceQualityJobCommands({plan:f.plan,result:f.result,admission:f.admission,previousJobs:[],firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:true});expect(commands.jobCommands).toHaveLength(23);
});
it.each(['missing-pages','missing-size','wrong-action','size-drift','duplicate','missing-last','page-cap'])('native original guards withhold unsafe %s',async kind=>{
 const options:ViatrisSyntheticOptions={count:23,...(kind==='missing-pages'?{omitDeclaration:true}:{}),...(kind==='missing-size'?{omitPageSize:true}:{}),...(kind==='wrong-action'?{wrongAction:true}:{}),...(kind==='size-drift'?{pageSizeDrift:true}:{}),...(kind==='duplicate'?{duplicateId:true}:{}),...(kind==='missing-last'?{missingPageOffset:20}:{}),...(kind==='page-cap'?{count:601}:{})};
 const f=await capture(options);expect(f.result.status).toBe('FAILED');if(['missing-pages','missing-size','wrong-action'].includes(kind))expect(f.synthetic.requests).toHaveLength(1);
});
it('preserves original zero-row failure even with declared one page; never issues a successful empty admission',async()=>{const f=await admitted({count:0});expect(f.result.status).toBe('FAILED');expect(f.result.jobs).toEqual([]);expect(f.admission.status).toBe('REJECTED');});
it('does not turn archived JSON, changed source or changed artifact into owned capability',async()=>{
 const f=await admitted();expect(f.admission.status).toBe('ACCEPTED');const clone=structuredClone(f.input);expect((await issueSourceQualityAdmission(clone)).status).toBe('REJECTED');
 await writeFile(join(f.restoredRoot,f.input.archive.artifacts[0]!.path),'synthetic changed bytes');expect((await issueSourceQualityAdmission(f.input)).status).toBe('REJECTED');
});
it('preserves acquisition age and rejects after thirty minutes instead of renewing old evidence',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime('2026-10-16T10:00:00.000Z');const f=await admitted();expect(f.admission.status).toBe('ACCEPTED');vi.setSystemTime('2026-10-16T10:30:00.001Z');expect((await issueSourceQualityAdmission(f.input)).status).toBe('REJECTED');
});
it.each(['request-locator','requested-offset','requested-max','terminal','response-hash','response-body','output-id'])('owned replay rejects changed %s evidence without a replacement acquisition',async kind=>{
 const f=await admitted({count:23}),e=f.result.fetchEvidence!,page=e.pages[1]!,artifact=e.artifacts.find(a=>a.logicalKey===page.artifactLogicalKey)!;
 if(kind==='request-locator')artifact.extractorLocator+='-wrong-social';if(kind==='requested-offset')page.requestedOffset=11;if(kind==='requested-max')page.requestedPageSize=11;if(kind==='terminal')page.termination='NEXT_ABSENT';if(kind==='response-hash')page.responseFingerprintSha256='0'.repeat(64);if(kind==='response-body')artifact.body+=' altered';if(kind==='output-id')f.result.jobs[0]!.sourceJobId='changed';
 expect((await issueSourceQualityAdmission(f.input)).status).toBe('REJECTED');
});
it('rejected capture cannot erase prior jobs or advance missing counts, and original drop trigger is retained',async()=>{
 const f=await admitted(),record=f.result.jobs[0]!,previousJobs=[{record,dedupeKey:`${record.sourceId}:${record.sourceJobId}`,lifecycleStatus:'ACTIVE' as const,missingSuccessfulCrawlCount:0,firstSeenAt:'2026-10-01T00:00:00.000Z',lastSeenAt:'2026-10-01T00:00:00.000Z'}],before=structuredClone(previousJobs);
 const rejected=await admitted({count:23,missingPageOffset:20});expect(rejected.admission.status).toBe('REJECTED');const result=buildSourceQualityJobCommands({plan:rejected.plan,result:rejected.result,admission:rejected.admission,previousJobs,firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:true});expect(result.jobCommands).toEqual([]);expect(previousJobs).toEqual(before);
 const {evaluateCompletenessAnomaly}=await import('../vendor/c60-source/src/crawler/completenessAnomalyPolicy.ts');
 expect(evaluateCompletenessAnomaly({baseline:{sourceId:SOURCE,sourceResultId:'synthetic-prior',sourceConfigSha256:CONFIG,certificateGrade:'PLAN_BOUND_SOURCE_QUALITY_V1',certificateSha256:'a'.repeat(64),certifiedJobCount:100,verifiedAt:'2026-10-01T00:00:00.000Z'},currentJobCount:23}).triggerCodes).toContain('TRUSTED_COUNT_DROP');
});
it.each(['offset','max','recruitmentType'])('independent native verifier rejects a rehashed POST %s contract on the exact Viatris plan',async field=>{
 const f=await capture({count:23});if(f.plan.adapterId!=='html-table')throw Error('WRONG_PLAN');const evidence=structuredClone(f.result.fetchEvidence!);
 const {validateStrictHtmlCompletenessProof}=await import('../vendor/c60-source/src/crawler/strictHtmlCompletenessProof.ts');const {requestContractV2Locator}=await import('../vendor/c60-source/src/crawler/strictPageRequestContract.ts');
 expect(validateStrictHtmlCompletenessProof(f.plan,evidence)).toBe(true);
 const body=new URLSearchParams('offset=10&max=10&recruitmentType=SOCIALRECRUITMENT');body.set(field,field==='recruitmentType'?'CAMPUSRECRUITMENT':'11');const page=evidence.pages[1]!,artifact=evidence.artifacts.find(a=>a.logicalKey===page.artifactLogicalKey)!;
 artifact.extractorLocator=requestContractV2Locator(f.plan.table.rowSelector,{family:'html',role:'tupu360-page',method:'POST',url:'https://careersite.tupu360.com/Viatris/position/nextPageList',body:body.toString(),coordinate:{sequence:1,requestedOffset:10,requestedPageSize:10}});
 expect(validateStrictHtmlCompletenessProof(f.plan,evidence)).toBe(false);
});
