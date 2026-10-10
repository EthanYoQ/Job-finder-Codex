import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {canonical,sha} from '../src/journal.mjs';
/** Real job.orz.md CURRENT token protocol; token is never journaled. */
/** @param {{expected?: any,fetchImpl?:typeof fetch,now?:()=>number}} options */
export async function currentPublicRound({expected,fetchImpl=fetch,now=Date.now}={}){
 const startedAt=now();let deadline=performance.now()+45000,checkToken;const reads=[];
 const get=async path=>{
  const left=Math.floor(deadline-performance.now());if(left<=0)throw Error('CURRENT_45S_EXPIRED');
  const response=await fetchImpl('https://job.orz.md'+path,{cache:'no-store',redirect:'error',headers:{'x-job-search-consent':'accepted',...(checkToken?{'x-job-snapshot-check':checkToken}:{})},signal:AbortSignal.timeout(left)});
  if(response.redirected)throw Error('CURRENT_PUBLIC_REDIRECT_FORBIDDEN');
  const bytes=await response.text();if(!response.ok)throw Error('CURRENT_PUBLIC_HTTP_'+response.status);
  const data=JSON.parse(bytes),refresh=data.snapshotRefresh;if(typeof refresh?.check!=='string')throw Error('CURRENT_TOKEN_MISSING');
  if(!checkToken){checkToken=refresh.check;const expires=Number(checkToken.split('.')[1]);if(!Number.isFinite(expires))throw Error('CURRENT_TOKEN_EXPIRY');deadline=Math.min(deadline,performance.now()+expires-now());}
  if(refresh.check!==checkToken)throw Error('CURRENT_TOKEN_CHANGED');
  delete refresh.check;reads.push({path,httpStatus:response.status,bodySha256:sha(bytes),receivedAt:new Date(now()).toISOString(),snapshotRefresh:structuredClone(refresh)});
  if(performance.now()>=deadline)throw Error('CURRENT_45S_EXPIRED');return data;
 };
 let coverage=await get('/api/coverage?limit=41');
 while(coverage.snapshotRefresh.state!=='CURRENT'){if(performance.now()+2500>=deadline)throw Error('CURRENT_45S_EXPIRED');await new Promise(r=>setTimeout(r,2500));coverage=await get('/api/coverage?limit=41');}
 const search=await get('/api/search?'+new URLSearchParams({city:'全部城市',limit:'50',offset:'0'}));
 assert.equal(search.snapshotRefresh.state,'CURRENT');assert.equal(canonical(search.snapshotRefresh),canonical(coverage.snapshotRefresh));
 assert.equal(coverage.hasMore,false);assert.equal(coverage.offset,0);assert(coverage.companies.length<=coverage.limit);assert(search.companies.length<50);
 // Coverage includes publishing companies with zero jobs; search omits them.
 const jobs=search.companies.flatMap(c=>c.jobs);assert.equal(new Set(jobs.map(j=>j.id)).size,jobs.length);assert.equal(jobs.length,search.totalJobs);assert.equal(jobs.length,search.publishedJobSummary.totalJobs);assert(search.companies.every(c=>c.jobs.every(j=>j.companyId===c.id)));
 if(expected){
  assert.equal(expected.afterRequestCases.length,9);const withoutSnapshot=o=>Object.fromEntries(Object.entries(o).filter(([k])=>k!=='snapshotRefresh'));
  for(const testCase of expected.afterRequestCases){const actual=await get(testCase.path);assert.equal(actual.snapshotRefresh.state,'CURRENT');assert.equal(canonical(actual.snapshotRefresh),canonical(search.snapshotRefresh));assert.equal(canonical(withoutSnapshot(actual)),canonical(testCase.expected),testCase.name+':ALL_FIELDS');}
  const company='company-takeda-china';assert.equal(canonical(search.companies.find(c=>c.id===company)),canonical(expected.after));assert.equal(canonical(coverage.companies.find(c=>c.id===company)),canonical(expected.afterCoverage));assert.equal(canonical(Object.fromEntries(Object.entries(search).filter(([k])=>!['companies','snapshotRefresh'].includes(k)))),canonical(expected.afterAggregate));
 }
 return {schemaVersion:1,status:'CURRENT_ALL_FIELDS_PASS',startedAt,finishedAt:now(),reads,search,coverage};
}
