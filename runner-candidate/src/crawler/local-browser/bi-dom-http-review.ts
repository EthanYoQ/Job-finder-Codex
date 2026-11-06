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
 const held=new Set<number>((replayedEvidence.jobQuarantines??[]).map((q:any)=>q.recordIndex));
 const included=raw.joblist.filter((r:any,index:number)=>!held.has(index)&&!uiContract.exclusions.some((e:any)=>r.jobname.includes(e.code)&&r.jobareaname.includes(e.jobareaname)));
 const expected=new Map<string,any>(included.map((r:any)=>[biJobId(r)!,r]));assert.equal(expected.size,included.length);
 const heldIds=new Set<string>(),unbound=(replayedEvidence.jobQuarantines??[]).filter((q:any)=>{const id=biJobId(raw.joblist[q.recordIndex]);if(id)heldIds.add(id);return !id;}).length;
 assert(Array.isArray(dom.jobs)&&dom.jobs.length>0);
 const domIds=dom.jobs.map((r:any)=>biJobId({jobid:r?.jobId})).filter(Boolean);assert.equal(new Set(domIds).size,domIds.length);
 const found=new Set<string>();let unidentified=0;
 for(const row of dom.jobs){
  if(heldIds.has(row?.jobId))continue;
  const apiRow:any=expected.get(row?.jobId);
  if(!apiRow){unidentified++;continue;}
  found.add(row.jobId);
  try{
  assert.equal(row.visible,true);const u=new URL(row.href,dom.source_url);
  assert.equal(u.origin,'https://campus.51job.com');assert.equal(u.pathname,'/BI/recruit_article_detail3.html');assert.equal(u.searchParams.get('jobId'),row.jobId);
  }catch{held.add(raw.joblist.indexOf(apiRow));}
 }
 const unboundDomRecordIndices:number[]=[...expected].filter(([id])=>!found.has(id)).map(([,row])=>raw.joblist.indexOf(row));
 const unmatchedHeld=[...held].filter(index=>{const id=biJobId(raw.joblist[index]);return id&&!domIds.includes(id);});
 assert(unboundDomRecordIndices.length<=unidentified,'BI_DOM_API_SET_SIZE');assert(unidentified<=unbound+unboundDomRecordIndices.length+unmatchedHeld.length,'BI_DOM_UNEXPLAINED_IDS');
 if(unidentified)unboundDomRecordIndices.push(...unmatchedHeld);
 for(const index of unboundDomRecordIndices)held.add(index);
 return {status:'PASS',sourceId:plan.source.id,domObservedAt:dom.captured_at,apiRawCount:raw.joblist.length,officialTotal:Number(raw.totalnum),uiJobs:dom.jobs.length,verifiedIdsAndLinks:held.size===0,quarantinedRecordIndices:[...held].sort((a,b)=>a-b),unboundDomRecordIndices};
}
