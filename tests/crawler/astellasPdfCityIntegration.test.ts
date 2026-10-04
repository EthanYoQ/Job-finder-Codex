// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { runSourceCrawl, replayStrictSourceQualityEvidence, replayStrictSourceQualityEvidenceAsync } from "../../src/crawler/runSourceCrawl";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch, verifyAtomicRuntimeCommitForPersistence } from "../../src/crawler/runtimeAtomicEvidence";
import { validateStrictHtmlCompletenessProof } from "../../src/crawler/strictHtmlCompletenessProof";
import { executePortableAtomicSourceEvidenceCommit } from "../../src/db/ingestionRepository";
import { buildJobDedupeKey } from "../../src/crawler/normalizedJob";
import { ASTELLAS_PDF_LIMITS } from "../../src/crawler/astellasPdfLocations";
import { syntheticPdf } from "../helpers/astellasPdf";
const dirs: string[]=[];
afterEach(async()=>{vi.unstubAllGlobals(); vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
const url=(id:string)=>`https://www.astellas.com/content/dam/astellas-com/global/zh/${id}.pdf`;
const plan=()=>structuredClone(buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-astellas-china-social')!);
async function capture(lines: Array<string[] | 'missing' | 'broken'> = [['Location: Beijing/Shanghai'],['Location: Shenyang']]) {
 const p=plan();const requests:string[]=[];
 const html=`<div class="cmp-accordion" data-cmp-is="accordion">${lines.map((_,i)=>`<a href="${url('job'+i)}"><span>Title ${i}</span><span>arrow_forward</span></a>`).join('')}</div>`;
 vi.stubGlobal('fetch',async(input:string)=>{requests.push(String(input));const i=lines.findIndex((_,i)=>url('job'+i)===String(input));
 const bytes=i<0?html:lines[i]==='broken'?Buffer.from('%PDF-1.4\nbroken'):syntheticPdf(lines[i]==='missing'?[]:lines[i] as string[]);
 const res=new Response(bytes,{status:i>=0&&lines[i]==='missing'?404:200,headers:{'content-type':i<0?'text/html':'application/pdf'}});Object.defineProperty(res,'url',{value:String(input)});return res;});
 const result=await runSourceCrawl(p,{fetch:createOwnedSourceQualityFetch(),isBaseline:false});
 return {plan:p,result,requests};
}
async function archived(c: Awaited<ReturnType<typeof capture>>) {
 const root=await mkdtemp(join(tmpdir(),'astellas-city-'));dirs.push(root);
 const binding={releaseCandidateId:'astellas-test',batchId:'batch-1',sourceResultId:'astellas-result',sourceConfigSha256:sourcePlanConfigSha256(c.plan),adapterVersion:'a'.repeat(64)};
 const evidenceSubdirectory='quality/runtime-evidence';
 const a=await archiveSourceEvidence({workspaceRoot:root,...binding,sourceId:c.plan.source.id,evidenceSubdirectory,captureTool:c.result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:c.plan.source.id,artifacts:c.result.fetchEvidence!.artifacts})});
 return {...c,binding,archive:{workspaceRoot:root,evidenceSubdirectory,artifacts:a.artifacts}};
}
describe('owned Astellas PDF city integration',()=>{
 it('acquires every current exact row URL, preserves list identities, and admits cities only after binary replay',async()=>{
  const c=await capture(); expect(c.requests).toEqual([c.plan.source.officialEntryUrl,url('job0'),url('job1')]);
  expect(c.result.jobs.map(j=>[j.sourceJobId,j.officialTitle,j.cities,j.officialPublishedAt])).toEqual([['job0','Title 0',['北京','上海'],undefined],['job1','Title 1',['沈阳'],undefined]]);
  expect(c.result.truth.completenessVerified).toBe(true);expect(c.result.fetchEvidence!.artifacts).toHaveLength(3);
  const a=await archived(c);expect((await issueSourceQualityAdmission(a)).status).toBe('ACCEPTED');
 });
 it('preserves missing, unknown and parser-failed rows as country-only metadata without invented city or dates',async()=>{
  const c=await capture([['Another missing field'],['No field'],['Location: China'],'missing','broken']);
  expect(c.result.jobs).toHaveLength(5);expect(c.result.jobs.every(j=>j.locationRaw==='中国'&&JSON.stringify(j.cities)==='["中国"]'&&!j.officialPublishedAt)).toBe(true);
  expect(c.result.jobs.map(j=>j.evidence.astellasPdfLocation?.status)).toEqual(['UNRESOLVED','UNRESOLVED','COUNTRY_ONLY','UNRESOLVED','UNRESOLVED']);
  for(const i of [0,1,3,4]){expect(c.result.jobs[i]!.evidence.astellasPdfLocation).toMatchObject({sourceCountryContext:'中国'});expect(c.result.jobs[i]!.evidence.astellasPdfLocation).not.toHaveProperty('country');}
  expect(c.result.jobs[2]!.evidence.astellasPdfLocation?.country).toBe('中国');
  expect((await issueSourceQualityAdmission(await archived(c))).status).toBe('ACCEPTED');
 });
 it('never weakens generic HTML single-artifact validation or accepts synchronous city replay',async()=>{
  const c=await capture();if(c.plan.adapterId!=='html-table')throw Error();
  expect(validateStrictHtmlCompletenessProof(c.plan,c.result.fetchEvidence!)).toBe(false);
  expect(replayStrictSourceQualityEvidence({plan:c.plan,evidence:c.result.fetchEvidence!,paginationEvaluation:c.result.paginationEvaluation!,reconciliation:c.result.reconciliation!,jobs:c.result.jobs,capturedAt:c.result.observation.crawledAt.toISOString()})).toBe(false);
 });
 it('rejects an archived PDF whose bytes disappear after acquisition',async()=>{
  const c=await archived(await capture());expect(c.archive.artifacts).toHaveLength(3);
  await writeFile(join(c.archive.workspaceRoot,c.archive.artifacts[1]!.path),'tampered');
  expect(await issueSourceQualityAdmission(c)).toMatchObject({status:'REJECTED',codes:['ARCHIVE_VERIFICATION_FAILED']});
 });
 it('bounds parser address space independently of Node',async()=>{
  expect(ASTELLAS_PDF_LIMITS.parserAddressSpaceBytes).toBe(256*1024*1024);
 });
 it('rechecks archived PDF bytes immediately before persistence',async()=>{
  const a=await archived(await capture());
  const identity={releaseCandidateId:a.binding.releaseCandidateId,commitSha:'a'.repeat(40),rosterSha256:'a'.repeat(64),sourcePlanSha256:'a'.repeat(64),sourceConfigSha256:'a'.repeat(64),adapterBundleSha256:'a'.repeat(64),batchKind:'SCHEDULED' as const,ownerId:'quality-worker',expectedPlannedSourceIds:[a.plan.source.id],expectedPlannedSourceSetSha256:'a'.repeat(64),expectedPlannedSourceCount:1};
  const pending=buildPendingRuntimeBatch(a.binding.batchId,[a.plan],identity,new Date(Date.now()-60_000)).sources[0]!;
  // Archive tuple must agree with the runtime-generated sourceResult ID.
  pending.id=a.binding.sourceResultId;a.binding.adapterVersion=pending.adapterVersion;
  const admission=await issueSourceQualityAdmission(a);expect(admission.status).toBe('ACCEPTED');
  const commit=buildAtomicRuntimeCommit({plan:a.plan,pending,identity,batchId:a.binding.batchId,result:a.result,previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:a.archive.artifacts,sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1',sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});
  await expect(verifyAtomicRuntimeCommitForPersistence(commit)).resolves.toBeUndefined();
  await writeFile(join(a.archive.workspaceRoot,a.archive.artifacts[1]!.path),'tampered after issuance');
  await expect(verifyAtomicRuntimeCommitForPersistence(commit)).rejects.toThrow();
  const transaction=vi.fn();
  await expect(executePortableAtomicSourceEvidenceCommit(commit,{} as never,{$transaction:transaction} as never)).rejects.toThrow();
  expect(transaction).not.toHaveBeenCalled();
 });
 it('rejects missing, orphaned, swapped, redirected, redacted, altered and unbound claims without weakening identities',async()=>{
  const c=await capture();
  const changes: Array<(e:any,j:any[])=>void>=[
   e=>e.artifacts.pop(),e=>e.artifacts.push({...e.artifacts[1],id:'orphan',logicalKey:'orphan'}),
   e=>e.astellasPdfLocations.entries.pop(),e=>e.astellasPdfLocations.entries.reverse(),
   e=>e.astellasPdfLocations.entries[0].sourceJobId='other',e=>e.astellasPdfLocations.entries[0].officialUrl=url('different'),
   e=>e.artifacts[1].finalUrl=url('redirect'),e=>e.artifacts[1].requestedUrl=url('different'),
   e=>e.artifacts[1].bodyRepresentation='REDACTED',e=>e.artifacts[1].body=new Uint8Array([1,2,3]),
   e=>e.astellasPdfLocations.entries[0].outcome.evidence.result.cities=['广州'],
   e=>e.astellasPdfLocations.entries[0].outcome.evidence.parserVersion='poppler-other',
   e=>e.astellasPdfLocations.sourceConfigSha256='0'.repeat(64),
   e=>e.astellasPdfLocations.entries[0].artifactLogicalKey=e.astellasPdfLocations.entries[1].artifactLogicalKey,
   e=>delete e.astellasPdfLocations,(_e,j)=>j[0].cities=['广州'],(_e,j)=>j[0].officialTitle='Other title',
   (_e,j)=>j[0].officialPublishedAt='2026-10-01T00:00:00.000Z'
  ];
  for(const change of changes){const e=structuredClone(c.result.fetchEvidence!),jobs=structuredClone(c.result.jobs);change(e,jobs);
   expect(await replayStrictSourceQualityEvidenceAsync({plan:c.plan,evidence:e,paginationEvaluation:c.result.paginationEvaluation!,reconciliation:c.result.reconciliation!,jobs,capturedAt:c.result.observation.crawledAt.toISOString()})).toBe(false);
  }
  expect(c.result.jobs.map(buildJobDedupeKey)).toEqual(['source-astellas-china-social:job0','source-astellas-china-social:job1']);
 });

 it('hashes binary artifacts without expanding them into boxed-number arrays',async()=>{
  const from=Array.from;
  vi.spyOn(Array,'from').mockImplementation(((value:any,...args:any[])=>{if(value instanceof Uint8Array)throw Error('BOXED_BINARY_ALLOCATION');return (from as any)(value,...args);}) as typeof Array.from);
  const c=await capture();expect(c.result.jobs).toHaveLength(2);
  expect((await issueSourceQualityAdmission(await archived(c))).status).toBe('ACCEPTED');
 });

 it('does not relabel an invalid artifact as a parser failure',async()=>{
  const c=await capture(['broken']);
  for(const patch of [{kind:'COMMAND_OUTPUT'},{httpStatus:201},{contentType:'text/html'},{extractorLocator:'unreviewed'},{id:'different'}]){
   const e=structuredClone(c.result.fetchEvidence!);Object.assign(e.artifacts[1]!,patch);
   expect(await replayStrictSourceQualityEvidenceAsync({plan:c.plan,evidence:e,paginationEvaluation:c.result.paginationEvaluation!,reconciliation:c.result.reconciliation!,jobs:c.result.jobs,capturedAt:c.result.observation.crawledAt.toISOString()})).toBe(false);
  }
 });

 it('pins the archive input before asynchronous replay instead of following caller path changes',async()=>{
  const a=await archived(await capture());const pending=issueSourceQualityAdmission(a);
  a.archive.workspaceRoot+='-changed-during-replay';
  expect((await pending).status).toBe('ACCEPTED');
 });

 it.each(['Tokyo','Beijing/Tokyo','Boston','Tokyo (Japan)','Shenzhen','TBD'])('retains unreviewed explicit %s evidence and rows while blocking completeness and admission',async(value)=>{
  const c=await capture([[`Location: ${value}`],['Location: Beijing']]);
  expect(c.result.status).toBe('SUCCESS');expect(c.result.jobs).toHaveLength(2);
  expect(c.result.jobs[0]!.locationRaw).toBe(value);expect(c.result.jobs[0]!.cities).toEqual(['地点待核实']);
  expect(c.result.jobs[0]!.evidence.astellasPdfLocation).toMatchObject({sourceCountryContext:'中国',status:'UNREVIEWED_LOCATION'});
  expect(c.result.jobs[0]!.evidence.astellasPdfLocation).not.toHaveProperty('country');
  expect(c.result.jobs[1]!.cities).toEqual(['北京']);expect(c.result.truth.completenessVerified).toBe(false);
  expect(c.result.fetchEvidence!.artifacts).toHaveLength(3);expect(c.result.fetchEvidence!.fetchLosses).toEqual([]);
  expect((await issueSourceQualityAdmission(await archived(c))).status).toBe('REJECTED');
 });

});
