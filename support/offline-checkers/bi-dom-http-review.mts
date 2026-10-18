import assert from 'node:assert/strict';
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
 const included=raw.joblist.filter((r:any)=>!uiContract.exclusions.some((e:any)=>r.jobname.includes(e.code)&&r.jobareaname.includes(e.jobareaname)));
 const expected=new Map(included.map((r:any)=>[String(r.jobid),r]));assert.equal(expected.size,included.length);
 assert(Array.isArray(dom.jobs)&&dom.jobs.length>0);assert.equal(new Set(dom.jobs.map((r:any)=>r.jobId)).size,dom.jobs.length);
 assert.equal(dom.jobs.length,expected.size,'BI_DOM_API_SET_SIZE');
 for(const row of dom.jobs){
  assert.equal(row.visible,true);const u=new URL(row.href,dom.source_url);
  assert.equal(u.origin,'https://campus.51job.com');assert.equal(u.pathname,'/BI/recruit_article_detail3.html');assert.equal(u.searchParams.get('jobId'),row.jobId);
  const apiRow:any=expected.get(row.jobId);assert(apiRow,'BI_DOM_API_ID');assert.equal(row.title.trim(),apiRow.jobname.trim());assert.equal(row.location.trim(),apiRow.jobareaname.trim());
 }
 return {status:'PASS',sourceId:plan.source.id,domObservedAt:dom.captured_at,apiRawCount:raw.joblist.length,officialTotal:Number(raw.totalnum),uiJobs:dom.jobs.length,exactIdsTitlesLocations:true};
}
