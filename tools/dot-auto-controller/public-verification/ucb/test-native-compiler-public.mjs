/** Consumes separately produced actual native-compiler fixtures; creates no fixture.
 * Usage: pinned-node test-native-compiler-public.mjs <external-fixture-directory>
 * External browser responses stay explicitly synthetic; no native build is run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {TARGET} from './contract.mjs';
import {ucbPhenomId} from './phenom-id.mjs';
import {createPublicVerifier} from './machine.mjs';
import {mergeRenderedList} from './cua-port.mjs';
import {fixture} from '../../fixed-host/ucb/synthetic-ui-port.mjs';

assert.equal(process.argv.length,3,'EXTERNAL_COMPILER_FIXTURE_DIRECTORY_REQUIRED');
const root=fs.realpathSync(process.argv[2]),repo=fs.realpathSync(fileURLToPath(new URL('../../../../',import.meta.url)));
assert(root!==repo&&!root.startsWith(repo+path.sep),'FIXTURE_MUST_REMAIN_OUTSIDE_SOURCE');
const hash=s=>createHash('sha256').update(s).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const projectionFields=['companyId','sourceId','dedupeKey','sourceJobId','officialTitle','officialUrl','listUrl','locationRaw','city','cities','officialPublishedAt','missingSuccessCount','lifecycleStatus','visibleInFrontend','isNew'];
function fromNativeFixture(name){
 const raw=fs.readFileSync(path.join(root,name)),data=JSON.parse(raw);assert.equal(data.kind,'SYNTHETIC_ORIGINAL_SCHEMA50_UCB_COMPILER_FIXTURE');
 const {row,projections}=data.model,receipt=row.completenessCertificate;
 assert.equal(hash(canonical(receipt)),row.completenessCertificateSha256,'Actual compiler receipt must match');
 assert.deepEqual(receipt.binding,{releaseCandidateId:row.releaseCandidateId,batchId:row.batchId,sourceId:row.sourceId,sourceResultId:row.id});
 assert.equal(row.sourceId,TARGET.sourceId);
 const members=receipt.members.filter(m=>m.setKind==='VISIBLE');assert.equal(members.length,projections.length);
 const jobs=members.map(m=>{
  const matches=projections.filter(p=>p.dedupeKey===m.jobKey);assert.equal(matches.length,1);const p=matches[0];
  const projection=Object.fromEntries(projectionFields.map(k=>[k,p[k]]));assert.equal(hash(canonical({schemaVersion:'job-persisted-projection-v1',projection})),m.jobProjectionSha256);
  assert.equal(p.companyId,TARGET.companyId);assert.equal(p.sourceId,TARGET.sourceId);
  return {sourceJobId:p.sourceJobId,officialTitle:p.officialTitle,officialUrl:p.officialUrl};
 });
 return {data,expected:{batchId:row.batchId,sourceId:TARGET.sourceId,companyId:TARGET.companyId,observedAt:receipt.observedAt,expectedFileSha256:hash(raw),jobs,removedIds:[]}};
}
for(const name of ['ucb-seven.json','ucb-applyUrl.json','ucb-zero.json','ucb-grace.json']){
 const {data,expected}=fromNativeFixture(name);
 test('native receipt projection → actual AX decoder → fixed DOM → machine: '+name,async()=>{
  const browser=fixture(expected,{actualAx:true,consent:true}),result=await createPublicVerifier({expected,port:browser.port}).run();
  assert.equal(result.status,'PASS_LIST_AND_SOURCE_TIME_ONLY',JSON.stringify(result));
  assert.equal(result.productionQualified,false);assert.equal(result.applicationVerification,'NOT_TESTED');assert.equal(result.detailVerification,'UNKNOWN');
  assert(result.comparisons.some(c=>c.kind==='LIST'&&c.status==='EXACT'));assert(result.comparisons.some(c=>c.kind==='SOURCE_TIME'&&c.status==='EXACT_MINUTE'));
 });
 test('native raw jobSeqNo/reqId and postedDate semantics: '+name,()=>{
  const rows=data.syntheticSourceEvidence.artifacts.filter(a=>a.kind==='PAGINATION_PAGE').flatMap(a=>JSON.parse(a.body).refineSearch.data.jobs);
  for(const raw of rows){
   assert.equal(raw.country,'China');assert.notEqual(raw.jobSeqNo,raw.reqId);
   const nativeId=ucbPhenomId(raw.jobSeqNo),job=expected.jobs.find(j=>j.sourceJobId===nativeId);assert(job);
   assert.notEqual(job.sourceJobId,ucbPhenomId(raw.reqId));
   assert.equal(job.officialUrl,raw.applyUrl??'https://careers.ucb.com/global/en/job/'+encodeURIComponent(raw.reqId));
   const p=data.model.projections.find(p=>p.sourceJobId===nativeId);assert.equal(p.officialPublishedAt,new Date(raw.postedDate).toISOString());assert.deepEqual(p.cities,['上海']);
  }
  if(name==='ucb-zero.json'){assert.equal(rows.length,0);assert.equal(expected.jobs.length,0);}
  if(name==='ucb-grace.json'){assert.equal(rows.length,1);assert.equal(expected.jobs.length,2);assert(data.model.projections.some(p=>p.missingSuccessCount===1));}
  if(name==='ucb-applyUrl.json')assert(expected.jobs.some(j=>j.officialUrl==='https://careers.ucb.com/global/zh/apply/synthetic-apply-1?source=synthetic'));
 });
}
const {expected:real}=fromNativeFixture('ucb-applyUrl.json');
const payload=()=>({companyPresent:true,anchorJobs:real.jobs.map(j=>({...j,sourceJobId:j.officialUrl})),visibleTitles:real.jobs.map(j=>({sourceJobId:j.officialUrl,renderedOriginalTitle:j.officialTitle}))});
test('actual compiler native IDs are preserved by exact public URL lookup',()=>assert.deepEqual(mergeRenderedList(payload(),real),real.jobs.map(j=>({...j,renderedOriginalTitle:j.officialTitle}))));
test('unknown href cannot be relabeled as an actual compiler job',()=>{const p=payload();p.anchorJobs[0].officialUrl+='&changed=1';p.anchorJobs[0].sourceJobId=p.anchorJobs[0].officialUrl;assert.throws(()=>mergeRenderedList(p,real),/UCB_UNREVIEWED_PUBLIC_URL/);});
test('duplicate rendered href from actual compiler jobs holds',()=>{const p=payload();p.anchorJobs.push(p.anchorJobs[0]);p.visibleTitles.push(p.visibleTitles[0]);assert.throws(()=>mergeRenderedList(p,real),/DUPLICATE_RENDERED_ANCHOR_ID/);});
test('ambiguous expected mapping from a mutated compiler copy holds',()=>{const e=structuredClone(real);e.jobs[1].officialUrl=e.jobs[0].officialUrl;assert.throws(()=>mergeRenderedList(payload(),e),/UCB_AMBIGUOUS_EXPECTED_URL/);});
