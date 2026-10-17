// @vitest-environment node
import {describe,it,expect} from 'vitest';import {createHash} from 'node:crypto';
import {buildNovoSingleClosureDetails,novoSingleClosureRemoves,NOVO_CLOSURE_SOURCE,NOVO_CLOSURE_COMPANY} from '../../src/domain/novoSingleJobClosure';
import {planNovoPublishedJobVerifications,captureNovoPublishedJobVerification,inspectNovoJobVerificationReadback} from '../../src/crawler/novoJobVerification';
const nativeId='123456.en_GB',nativeUrl='https://careers.novonordisk.com/job/Beijing-Synthetic/123456/';
const officialUrl=`https://www.novonordisk.com.cn/content/nncorp/cn/zh_cn/careers/find-a-job/job-ad.${nativeId}.html`;
const identity={nativeId,jobId:'synthetic-job',jobKey:NOVO_CLOSURE_SOURCE+':official-json:sha256:'+'a'.repeat(64),officialUrl,previousSourceResultId:'synthetic-prior',previousApplicationArtifactId:'synthetic-artifact'};
const body='<div class="jobDisplay"><div class="job"><p>Thank you for your interest unfortunately, we are no longer accepting applicants to this position.</p></div></div>';
const raw={requestedUrl:nativeUrl,finalUrl:nativeUrl,httpStatus:200,contentType:'text/html; charset=utf-8',startedAt:'2026-01-02T00:00:00.000Z',capturedAt:'2026-01-02T00:00:01.000Z',body,bodySha256:createHash('sha256').update(body).digest('hex')};
const job={id:identity.jobId,companyId:NOVO_CLOSURE_COMPANY,sourceId:NOVO_CLOSURE_SOURCE,sourceResultId:'synthetic-prior',officialUrl,lastSeenAt:'2026-01-01T00:00:00.000Z',lastConfirmedObservedAt:'2026-01-01T00:00:00.000Z',inGrace:false};
const artifact={id:'synthetic-artifact',releaseCandidateId:'synthetic-candidate',batchId:'synthetic-batch',sourceId:NOVO_CLOSURE_SOURCE,sourceResultId:'synthetic-prior',kind:'OFFICIAL_COMPANY_PAGE',requestedUrl:nativeUrl,finalUrl:nativeUrl,httpStatus:200,contentType:'text/html',capturedAt:'2026-01-01T00:00:00.000Z',sha256:'b'.repeat(64),extractorLocator:`novo-application-${nativeId}`};
describe('original Novo evidence-only verification',()=>{
 it('does not treat an empty read during an uncertain write as terminal absence',()=>{
  expect(inspectNovoJobVerificationReadback({batches:[],results:[],losses:[],artifacts:[]},[],new Date())).toEqual({outcome:'UNKNOWN',verifiedClosedCount:0});
 });
 it('requires actual explicit closure, raw hash and exact original URL binding',()=>{
  expect(buildNovoSingleClosureDetails(raw,identity).code).toBe('OFFICIAL_APPLICATION_CLOSED');
  for(const changed of [{body:'null'},{bodySha256:'0'.repeat(64)},{httpStatus:404},{requestedUrl:nativeUrl+'?different=1'}])expect(()=>buildNovoSingleClosureDetails({...raw,...changed},identity)).toThrow();
 });
 it('keeps closure through missing GRACE and permits only a newer actual confirmation',()=>{
  const proof=buildNovoSingleClosureDetails(raw,identity);
  expect(novoSingleClosureRemoves({...job,sourceResultId:'later-grace',lastSeenAt:'2026-01-03T00:00:00.000Z'},proof)).toBe(true);
  expect(novoSingleClosureRemoves({...job,lastConfirmedObservedAt:'2026-01-03T00:00:00.000Z'},proof)).toBe(false);
  expect(novoSingleClosureRemoves({...job,id:'another-job'},proof)).toBe(false);
 });
 it('plans only exact already-published keys with their historical native artifact',()=>{
  const row={...job,dedupeKey:identity.jobKey,locationRaw:'China, Beijing'};
  const input={publishedJobs:[job],selectedSourceResult:{id:'synthetic-prior',completenessCertificate:null},jobs:[row,{...row,id:'not-published'}],artifacts:[artifact]};
  expect(planNovoPublishedJobVerifications(input)).toEqual([{identity,nativeUrl,nativeCity:'Beijing'}]);
  expect(()=>planNovoPublishedJobVerifications({...input,artifacts:[{...artifact,sourceResultId:'wrong-prior'}]})).toThrow();
 });
 it('distinguishes native ACTIVE and UNKNOWN without giving them write authority',async()=>{
  const target={identity,nativeUrl,nativeCity:'Beijing'};
  const get=(html:string)=>(async()=>({url:nativeUrl,status:200,headers:new Headers({'content-type':'text/html'}),text:async()=>html})) as unknown as typeof fetch;
  expect((await captureNovoPublishedJobVerification(target,get(body))).status).toBe('CLOSED');
  const active='<div class="jobDisplay"><div class="job"><h1 data-careersite-propertyid="title">Synthetic job</h1><span class="jobGeoLocation">Beijing, CN</span></div><a class="apply" href="/talentcommunity/apply/123456/?locale=en_GB">Apply now</a></div>';
  expect((await captureNovoPublishedJobVerification(target,get(active))).status).toBe('ACTIVE');
  expect((await captureNovoPublishedJobVerification(target,get('<div>null</div>'))).status).toBe('UNKNOWN');
 });
});
