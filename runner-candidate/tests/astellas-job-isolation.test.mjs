import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans, sourcePlanConfigSha256} from '../src/crawler/sourcePlan.ts';
import {createHttpHtmlSourceFetch} from '../src/crawler/httpHtmlSourceFetch.ts';
import {replayAstellasPdfCities} from '../src/crawler/astellasPdfCityAcquisition.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidenceAsync} from '../src/crawler/runSourceCrawl.ts';
import {archiveSourceEvidence} from '../src/crawler/artifactArchive.ts';
import {bindRuntimeEvidenceArtifactIds} from '../src/crawler/runtimeAtomicEvidence.ts';
import {createOwnedSourceQualityFetch, issueSourceQualityAdmission, verifyIssuedSourceQualityArchiveForPersistence} from '../src/crawler/sourceQualityAdmission.ts';

test('Astellas unavailable PDFs and malformed list titles quarantine jobs without claiming an empty source',async()=>{
 const at='2026-11-06T00:00:00.000Z',plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-astellas-china-social');
 for(const badTitle of [false,true]){
  const body=`<div class="cmp-accordion" data-cmp-is="accordion">${[1,2].map(id=>`<a href="/content/dam/astellas-com/global/zh/role-${id}.pdf"><span>${badTitle&&id===2?'':`Synthetic Role ${id}`}</span></a>`).join('')}</div>`;
  const capture=createHttpHtmlSourceFetch({now:()=>new Date(at),http:async({url})=>({status:200,body,finalUrl:url,contentType:'text/html',capturedAt:at})});
  const list=await capture(plan);assert.equal(list.ok,true);assert.equal(list.fetchEvidence.fetchCounts.rawCount,2);
  // No PDF runtime or network is needed to replay an explicitly unavailable capture.
  const listJobs=badTitle?[1]:[1,2],evidence={...list.fetchEvidence,astellasPdfLocations:{schemaVersion:'astellas-owned-pdf-cities-v1',runtimeCapability:{available:false,code:'PDF_RUNTIME_UNAVAILABLE'},sourceConfigSha256:sourcePlanConfigSha256(plan),listArtifactLogicalKey:list.fetchEvidence.artifacts[0].logicalKey,entries:listJobs.map(id=>({sourceJobId:`role-${id}`,officialUrl:`https://www.astellas.com/content/dam/astellas-com/global/zh/role-${id}.pdf`,outcome:{ok:false,code:'PDF_RUNTIME_UNAVAILABLE'}}))}};
  const replay=await replayAstellasPdfCities(plan,evidence,at,false);assert.equal(replay.jobs.length,0);assert.equal(replay.listEvidence.jobQuarantines.length,2);assert.equal(replay.listEvidence.fetchCounts.rawCount,2);
  const {evaluatePaginationEvidence}=await import('../src/crawler/paginationEvidence.ts');
  const {JOB_QUARANTINE_PAGINATION}=await import('../src/crawler/jobQuarantine.ts');
  const isolated={...replay.listEvidence,astellasPdfLocations:evidence.astellasPdfLocations};
  const paginationEvaluation=evaluatePaginationEvidence({evidence:isolated,expectedChannelIds:[],filteredOutput:true,allowMissingReturnedPage:true,...JOB_QUARANTINE_PAGINATION});
  const result=await runSourceCrawl(plan,{fetch:async()=>({...list,fetchEvidence:isolated,paginationEvaluation}),isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,JSON.stringify(result.truth));assert.equal(result.jobs.length,0);assert.equal(result.fetchEvidence.jobQuarantines.length,2);
  const verify=evidence=>replayStrictSourceQualityEvidenceAsync({plan,evidence,paginationEvaluation,reconciliation:result.reconciliation,jobs:[],capturedAt:at});
  assert.equal(await verify(isolated),true);
  for (const [field, value] of [['officialUrl','https://www.astellas.com/wrong.pdf'], ['sourceJobId','wrong-job']]) {
   const changed=structuredClone(isolated);
   changed.astellasPdfLocations.entries[0][field]=value;
   assert.equal(await verify(changed),false,field);
  }
  const changed=structuredClone(isolated);
  changed.jobQuarantines[0].officialUrl='https://www.astellas.com/wrong.pdf';
  assert.equal(await verify(changed),false);
 }
});

test('Astellas issuance and persistence independently reject physical archive changes', async t => {
  const cache=fileURLToPath(new URL('../../.runtime/.cache/',import.meta.url));
  await mkdir(cache,{recursive:true});
  const workspaceRoot=await mkdtemp(join(cache,'astellas-archive-'));
  t.after(()=>rm(workspaceRoot,{recursive:true,force:true}));
  const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-astellas-china-social');
  const pdfPath='/content/dam/astellas-com/global/zh/role-1.pdf';
  const html=`<div class="cmp-accordion" data-cmp-is="accordion"><a href="${pdfPath}"><span>Synthetic Role</span></a></div>`;
  t.mock.method(globalThis,'fetch',async request=>{
    const url=String(request);
    if (url===plan.source.officialEntryUrl) {
      return {url,status:200,headers:new Headers({'content-type':'text/html'}),text:async()=>html};
    }
    assert.equal(url,new URL(pdfPath,plan.source.officialEntryUrl).href);
    return {url,status:404,headers:new Headers()};
  });
  const result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:false});
  assert.equal(result.status,'SUCCESS',JSON.stringify(result.diagnostics));
  assert.equal(result.jobs.length,0);
  assert.equal(result.fetchEvidence.jobQuarantines.length,1);
  const binding={releaseCandidateId:'astellas-test',batchId:'batch',sourceResultId:'result',
    sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:'a'.repeat(64)};
  const tuple={...binding,sourceId:plan.source.id};
  const evidenceSubdirectory='evidence';
  const {artifacts}=await archiveSourceEvidence({workspaceRoot,...tuple,evidenceSubdirectory,
    captureTool:result.fetchEvidence.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:result.fetchEvidence.artifacts})});
  const input={plan,result,binding,archive:{workspaceRoot,evidenceSubdirectory,artifacts}};
  const file=join(workspaceRoot,artifacts[0].path);
  const original=await readFile(file);
  const tampered=Buffer.from(original);
  tampered[0]^=1;

  await writeFile(file,tampered);
  assert.deepEqual(await issueSourceQualityAdmission(input),{status:'REJECTED',codes:['ARCHIVE_VERIFICATION_FAILED']});
  await writeFile(file,original);
  const admission=await issueSourceQualityAdmission(input);
  assert.equal(admission.status,'ACCEPTED',JSON.stringify(admission));
  await verifyIssuedSourceQualityArchiveForPersistence(admission);
  await assert.rejects(verifyIssuedSourceQualityArchiveForPersistence(structuredClone(admission)),/ASTELLAS_ISSUED_ARCHIVE_REPLAY_REQUIRED/);

  await writeFile(file,tampered);
  await assert.rejects(verifyIssuedSourceQualityArchiveForPersistence(admission),/artifact SHA-256 mismatch/);
  await writeFile(file,original);
  await verifyIssuedSourceQualityArchiveForPersistence(admission);
});
