/** SYNTHETIC ONLY. API and DOM carriers are made independently from test specification. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {candidateCompanies} from '../../producer/src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans,sourcePlanConfigSha256} from '../../producer/src/crawler/sourcePlan.ts';
import {createWorkdaySourceFetch} from '../../producer/src/crawler/workdaySourceFetch.ts';
import {runSourceCrawl} from '../../producer/src/crawler/runSourceCrawl.ts';
import {pfizerDomPacketsToPages} from '../../producer/src/crawler/pfizerRenderedTraversal.ts';
import {createOfficialJsonRenderedTraversalValidation} from '../../producer/src/crawler/traversalCertificate.ts';
import {buildPendingRuntimeBatch,buildAtomicRuntimeCommit} from '../../producer/src/crawler/runtimeAtomicEvidence.ts';
import {canonicalStringSetSha256,sha256Bytes} from '../../producer/src/crawler/sourceFetchEvidence.ts';
import {buildJobProjectionDeltaReceipt} from '../../producer/src/db/jobProjectionDeltaCompiler.ts';
import {hashProjectionJson} from '../../producer/src/domain/jobProjectionDeltaReceipt.ts';
import {compileAtomicJsonDeclarations} from '../../producer/src/db/atomicJsonDeclarations.ts';
export const sha=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
export function rehashTerminal(t:any,inner=true){if(inner)t.completenessCertificate.legacyCertificateSha256=hashProjectionJson(t.completenessCertificate.legacyCertificate);t.completenessCertificateSha256=hashProjectionJson(t.completenessCertificate);}
export async function makePfizerFixture(options:{now?:Date;total?:number;domAgeMs?:number;mainAgeMs?:number;validationRemainingMs?:number}={}){
 const now=options.now??new Date('2026-10-07T15:00:00.000Z'),time=(n:number)=>new Date(now.getTime()-n).toISOString();
 const domAt=time(options.domAgeMs??15*60000),mainStarted=time(options.mainAgeMs??10*60000),mainAt=new Date(Date.parse(mainStarted)+60000).toISOString(),detailAt=new Date(Date.parse(domAt)+30000).toISOString(),finishedAt=time(60000);
 const source='source-pfizer-china-social',total=options.total??22,china='6cb77610a8a543aea2d6bc10457e35d4',entry='https://pfizer.wd1.myworkdayjobs.com/PfizerCareers',api='https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers';
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===source)!;
 assert.equal(sourcePlanConfigSha256(plan),'84aaab8bad3579630eec1b12d3f09236755b3a25d0b7751ca8584a9a53a83413');
 const rows=Array.from({length:total},(_,i)=>({title:'Synthetic Pfizer role '+i,externalPath:`/job/${i===1?'India':'China'}/Role_${4970000+i}`,bulletFields:[String(4970000+i)]}));
 const details=rows.map((r,i)=>({jobPostingInfo:{title:r.title,jobReqId:r.bulletFields[0],jobPostingSiteId:'PfizerCareers',externalUrl:entry+r.externalPath,location:i===1?'India - Mumbai':'China - Beijing - Beijing',...(i===1?{additionalLocations:['APAC - Any Pfizer Site']}:{}),country:{descriptor:i===1?'India':'China',id:i===1?'c4f78be1a8f14da0ab49ce1162348a5e':china},jobRequisitionLocation:{country:{descriptor:i===1?'India':'China',alpha2Code:i===1?'IN':'CN'}},posted:true,canApply:true,startDate:'2026-10-03',jobDescription:'Synthetic responsibilities and requirements only. '.repeat(5)}}));
 let mockRequestCount=0;
 const http=async(req:any)=>{mockRequestCount++;assert.equal(req.url,api+'/jobs');const {offset}=JSON.parse(req.body);return {status:200,body:JSON.stringify({total:offset===0?total:0,jobPostings:rows.slice(offset,offset+20)}),finalUrl:req.url,contentType:'application/json',capturedAt:mainAt};};
 const detailHttp=async(req:any)=>{mockRequestCount++;const i=rows.findIndex(r=>req.url===api+r.externalPath);assert(i>=0);return {status:200,body:JSON.stringify(details[i]),finalUrl:req.url,contentType:'application/json',capturedAt:mainAt};};
 const result=await runSourceCrawl(plan,{isBaseline:true,fetch:createWorkdaySourceFetch({http,detailHttp,now:()=>new Date(mainAt)})});
 assert.equal(result.status,'SUCCESS',result.status==='FAILED'?result.failureReason:undefined);
 const packets=Array.from({length:Math.ceil(total/20)},(_,page)=>({listPage:{url:'https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers?Location_Country='+china,title:'Search for Jobs',countryFilter:'China clear filter',filterCount:1,searchText:'',pageLabel:`Page ${page+1} of ${Math.ceil(total/20)}`,range:`${page*20+1} - ${Math.min((page+1)*20,total)} of ${total} jobs`,totalText:`${total} JOBS FOUND`,nextControlPresent:page<Math.ceil(total/20)-1,capturedAt:detailAt},rows:Array.from({length:Math.min(20,total-page*20)},(_,n)=>{const i=page*20+n,id=String(4970000+i),path=`/job/${i===1?'India':'China'}/Role_${id}`,title='Synthetic Pfizer role '+i;return {capturedAt:detailAt,officialId:id,externalPath:path,title,detailUrl:'https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers'+path+'?Location_Country='+china,renderedTitle:title,renderedId:id,renderedLocations:i===1?['India - Mumbai','APAC - Any Pfizer Site']:['China - Beijing - Beijing'],applyEnabled:true,jsonLd:JSON.stringify({'@type':'JobPosting',identifier:{value:id},title,datePosted:'2026-10-03',jobLocation:{address:{addressCountry:i===1?'India':'China',addressLocality:i===1?'IND - Mumbai':'CHN - BJ - Beijing'}}}),documentTitle:title,detailDom:'<main>SYNTHETIC ONLY</main>'};})}));
 const rawCapture={captureKind:'MANAGED_BROWSER_DOM_JSONLD',observedAt:domAt,packets},rawCaptureBytes=Buffer.from(JSON.stringify(rawCapture));
 const pages=pfizerDomPacketsToPages(packets,sha(rawCaptureBytes));
 const validation=createOfficialJsonRenderedTraversalValidation({sourceId:source,companyId:plan.company.id,sourceConfigSha256:sourcePlanConfigSha256(plan),surfaceIds:[plan.source.surfaceId!],channelIds:plan.expectedChannels!.map(c=>c.channelId),pages,observedAt:domAt,expiresAt:options.validationRemainingMs===undefined?new Date(Date.parse(domAt)+7*86400000).toISOString():new Date(now.getTime()+options.validationRemainingMs).toISOString()});
  const batchId = 'synthetic-pfizer-b-proof', digest = 'a'.repeat(64);
  const identity = { releaseCandidateId: 'synthetic-pfizer-candidate', commitSha: '28402a299bb04cbf5873da66c2fe8ca76827c0d1',
    rosterSha256: digest, sourcePlanSha256: digest, sourceConfigSha256: digest, adapterBundleSha256: digest,
    batchKind: 'SCHEDULED' as const, ownerId: 'synthetic-pfizer-owner', expectedPlannedSourceIds: [source],
    expectedPlannedSourceSetSha256: canonicalStringSetSha256([source]), expectedPlannedSourceCount: 1 };
  const pending = buildPendingRuntimeBatch(batchId, [plan], identity, new Date(mainStarted)).sources[0]!;
  const artifacts = result.fetchEvidence!.artifacts.map(a => ({
    id: a.id, logicalKey: a.logicalKey, releaseCandidateId: identity.releaseCandidateId, batchId, sourceId: source, sourceResultId: pending.id,
    kind: a.kind, ...(a.requestedUrl ? { requestedUrl: a.requestedUrl } : {}), ...(a.finalUrl ? { finalUrl: a.finalUrl } : {}),
    ...(a.httpStatus ? { httpStatus: a.httpStatus } : {}), ...(a.contentType ? { contentType: a.contentType } : {}),
    capturedAt: new Date(a.capturedAt), ...sha256Bytes(typeof a.body === 'string' ? Buffer.from(a.body) : a.body),
    path: `synthetic-only/${a.logicalKey}.json`, extractorLocator: a.extractorLocator,
    captureToolName: result.fetchEvidence!.captureTool.name, captureToolVersion: result.fetchEvidence!.captureTool.version
  }));
  const commit = buildAtomicRuntimeCommit({ plan, pending, identity, batchId, result, artifacts, previousJobs: [], baselineCompletedBeforeCrawl: false,
    independentTraversalValidation: validation, independentTraversalValidationExecution: 'CURRENT_RUN',
    independentTraversalValidationTrigger: 'INITIAL_QUALIFICATION', completedAt: new Date(finishedAt) });
  assert.equal(commit.sourceResult.completenessState, 'VERIFIED');
  const delta = buildJobProjectionDeltaReceipt({ sourceResult: commit.sourceResult, commands: commit.commands, previousAccepted: null,
    projectionForCommand: command => ({ ...command.record, dedupeKey: command.dedupeKey, city: command.record.cities[0],
      sourceJobId: command.record.sourceJobId ?? null, listUrl: command.record.listUrl ?? null,
      officialPublishedAt: command.record.officialPublishedAt ?? null, missingSuccessCount: command.missingSuccessfulCrawlCount,
      lifecycleStatus: command.lifecycleStatus, visibleInFrontend: command.visibleInFrontend, isNew: command.isNew }) });
  const terminal = JSON.parse(JSON.stringify({ ...commit.sourceResult, completenessCertificate: delta.receipt, completenessCertificateSha256: delta.sha256 }));
  return { terminal, validation, now, mockRequestCount, lossLedger: commit.lossLedger, result, plan, rawCapture, rawCaptureBytes };
}

export function makeSyntheticRequest(terminal: any, expiresAt: string) {
  const label = '$atomic_' + 'a'.repeat(32) + '$';
  const sql = `SET LOCAL statement_timeout = '120000ms';\nDO ${label}\nDECLARE affected bigint; job_data jsonb; ${compileAtomicJsonDeclarations(terminal, { syntheticOnly: true })} current_context jsonb; current_count bigint; current_hash text; aggregate_hash text;\nBEGIN\nPERFORM 1;\nEND;\n${label};`;
  const body = { kind: 'PUBLISH', requestId: '00000000-0000-4000-8000-000000000001', expiresAt,
    payload: { projectId: 'yiopvxysxrtrnvqxwgbx', sql } };
  return { ...body, requestSha256: sha(JSON.stringify(body)) };
}
