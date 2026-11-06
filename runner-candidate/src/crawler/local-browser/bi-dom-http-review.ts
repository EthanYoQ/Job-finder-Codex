import assert from 'node:assert/strict';
import {biJobId} from '../biSemanticCompleteness';
// Called after the original native raw/quality replay; independently checks the visible UI set.
export function reviewBiDomHttp({dom,plan,replayedEvidence,uiContract,now,dispatchBefore}:any){
 assert.equal(plan.source.id,'source-boehringer-ingelheim-china-social');
 assert.equal(dom.source_url,'https://campus.51job.com/BI/recruitSociety.html');
 const observed=Date.parse(dom.captured_at),current=Date.parse(now);
 assert(Number.isFinite(observed)&&observed<=current&&current-observed<=1800000,'BI_DOM_TIME_WINDOW');
 assert(current<Date.parse(dispatchBefore),'BI_DOM_DISPATCH_EXPIRED');
 const artifacts=replayedEvidence.artifacts,api=artifacts.find((a:any)=>a.logicalKey==='51job-page-0001');
 assert(api&&uiContract,'BI_DOM_NATIVE_EVIDENCE_REQUIRED');
 const body=typeof api.body==='string'?api.body:new TextDecoder().decode(api.body);
 const match=/^\s*jsoncallback\((.*)\)\s*;?\s*$/s.exec(body);assert(match,'BI_DOM_API_JSONP');
 const raw=JSON.parse(match[1]!).resultbody;assert.equal(Number(raw.totalnum),raw.joblist.length);assert(raw.joblist.length<=500);
 const held=new Set((replayedEvidence.jobQuarantines??[]).map((q:any)=>q.recordIndex));
 const included=raw.joblist.filter((r:any,index:number)=>!held.has(index)&&!uiContract.exclusions.some((e:any)=>r.jobname.includes(e.code)&&r.jobareaname.includes(e.jobareaname)));
 const expected=new Map(included.map((r:any)=>[biJobId(r),r]));assert.equal(expected.size,included.length);
 const heldIds=new Set<string>(),unbound=(replayedEvidence.jobQuarantines??[]).filter((q:any)=>{const id=biJobId(raw.joblist[q.recordIndex]);if(id)heldIds.add(id);return !id;}).length;
 assert(Array.isArray(dom.jobs)&&dom.jobs.length>0);assert.equal(new Set(dom.jobs.map((r:any)=>r.jobId)).size,dom.jobs.length);
 const found=new Set<string>();let unidentified=0;
 for(const row of dom.jobs){
  if(heldIds.has(row.jobId))continue;
  const apiRow:any=expected.get(row.jobId);
  if(!apiRow){unidentified++;continue;}
  assert.equal(row.visible,true);const u=new URL(row.href,dom.source_url);
  assert.equal(u.origin,'https://campus.51job.com');assert.equal(u.pathname,'/BI/recruit_article_detail3.html');assert.equal(u.searchParams.get('jobId'),row.jobId);
  assert.equal(String(row.title??'').trim(),apiRow.jobname.trim());assert.equal(String(row.location??'').trim(),apiRow.jobareaname.trim());found.add(row.jobId);
 }
 assert.equal(found.size,expected.size,'BI_DOM_API_SET_SIZE');assert(unidentified<=unbound,'BI_DOM_UNEXPLAINED_IDS');
 return {status:'PASS',sourceId:plan.source.id,domObservedAt:dom.captured_at,apiRawCount:raw.joblist.length,officialTotal:Number(raw.totalnum),uiJobs:dom.jobs.length,exactIdsTitlesLocations:true};
}
