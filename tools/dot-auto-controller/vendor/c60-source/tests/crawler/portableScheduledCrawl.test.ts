import{describe,it,expect,vi}from'vitest';
const hooks=vi.hoisted(()=>({acquire:vi.fn(),sync:vi.fn(async()=>({companyCount:41,sourceCount:41,hiddenUnplannedVisibleJobCount:0})),release:vi.fn(),wrap:vi.fn((db:any)=>db)}));
vi.mock('../../src/crawler/portableCrawlLease',()=>({withPortableCrawlLease:async(_db:any,work:any)=>{hooks.acquire(_db);try{return await work({lockId:'formal-crawl',holderId:'test-owner',signal:new AbortController().signal});}finally{hooks.release();}}}));
vi.mock('../../src/db/portableRuntimeDatabase',()=>({createPortableFencedRuntimeDatabase:hooks.wrap}));
vi.mock('../../src/db/companyRegistrySync',()=>({syncLaunchCohortSourcesToDb:hooks.sync}));
import{runPortableScheduledCrawl}from'../../src/crawler/portableScheduledCrawl';
import{buildStagedSourceCrawlPlans,sourcePlanConfigSha256}from'../../src/crawler/sourcePlan';
import{candidateCompanies}from'../../src/data/companyRegistry';
import{P0_LAUNCH_MANIFEST,selectLaunchCompanies}from'../../src/release/launchManifest';
const companies=selectLaunchCompanies(P0_LAUNCH_MANIFEST,candidateCompanies),plans=buildStagedSourceCrawlPlans(companies);
const authority={companies,plans,identity:{expectedPlannedSourceCount:41}} as any;
describe('portable canonical scheduled entry',()=>{
 it('rejects a missing or identical lease client before acquisition or authority lookup',async()=>{
  const db={},resolveAuthority=vi.fn(async()=>authority),before=hooks.acquire.mock.calls.length;
  for(const leaseDb of [undefined,db])await expect(runPortableScheduledCrawl({db,leaseDb,workspaceRoot:'/tmp',resolveAuthority} as any)).rejects.toThrow('PORTABLE_SEPARATE_LEASE_CLIENT_REQUIRED');
  expect(resolveAuthority).not.toHaveBeenCalled();expect(hooks.acquire.mock.calls.length).toBe(before);
 });
 it('routes lease ownership to the control client and runtime writes to the primary client',async()=>{
  const db={},leaseDb={} as any,runBatch=vi.fn(async(_plans:any,deps:any)=>{expect(deps.db).toBe(db);return {status:'SUCCESS'} as any;});
  await runPortableScheduledCrawl({db,leaseDb,workspaceRoot:'/tmp',resolveAuthority:async()=>authority,runBatch});
  expect(hooks.acquire.mock.calls.at(-1)![0]).toBe(leaseDb);expect(hooks.wrap.mock.calls.at(-1)![0]).toBe(db);
 });
 it('keeps historical41/required40, starts CSPC/Qilu, and does not fetch excluded or unreviewed sources',async()=>{
  const fetch=vi.fn(()=>{throw Error('NETWORK_NOT_EXPECTED')});vi.stubGlobal('fetch',fetch);
  const runBatch=vi.fn(async(p:readonly any[],d:any)=>{
   expect(p.map(p=>p.source.id).slice(0,2)).toEqual(['source-cspc-social','source-qilu-social']);expect(new Set(p.map(p=>p.source.id)).size).toBe(41);
   expect(d.sourceAdmissionPolicy).toBe('PLAN_BOUND_SOURCE_QUALITY_V1');
   expect(await d.fetch(p.find(p=>p.source.id==='source-united-lab-social'))).toMatchObject({ok:false,failureReason:'USER_AUTHORIZED_COVERAGE_EXCLUSION'});
   expect(await d.fetch(p.find(p=>p.source.id==='source-sanofi-china-social'))).toMatchObject({ok:false,failureReason:'SOURCE_QUALITY_POLICY_NOT_REVIEWED'});
   return {status:'INCOMPLETE',batchId:'test'} as any;
  });
  const r=await runPortableScheduledCrawl({db:{},leaseDb:{} as any,workspaceRoot:'/tmp/portable-test',resolveAuthority:async()=>authority,runBatch});
  expect(r.coverage.requiredSourceIds).toHaveLength(40);expect(r.result.status).toBe('INCOMPLETE');expect(fetch).not.toHaveBeenCalled();expect(hooks.release).toHaveBeenCalled();vi.unstubAllGlobals();
 });
 it('rejects incomplete runtime authority before registry sync',async()=>{const before=hooks.sync.mock.calls.length;await expect(runPortableScheduledCrawl({db:{},leaseDb:{} as any,workspaceRoot:'/tmp',resolveAuthority:async()=>({...authority,plans:plans.slice(1)}),runBatch:vi.fn()})).rejects.toThrow('EXACT_LAUNCH_COHORT');expect(hooks.sync.mock.calls.length).toBe(before);});
 it('wires only the portable runtime to current-configuration receipt history',async()=>{
  const findMany=vi.fn(async()=>[]),legacy=vi.fn(async()=>[{crawledAt:new Date(),successful:true}]);
  const db={crawlBatchSourceResult:{findMany},crawlObservation:{findMany:legacy}};
  const runBatch=vi.fn(async(_plans:any,d:any)=>{
   const p=plans.find(p=>p.source.id==='source-astellas-china-social')!;
   expect(await d.getRecentObservations(p.source.id)).toEqual([]);
   expect(findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({sourceId:p.source.id,sourceConfigHash:sourcePlanConfigSha256(p)})}));
   expect(legacy).not.toHaveBeenCalled();return {status:'SUCCESS'} as any;
  });
  await runPortableScheduledCrawl({db,leaseDb:{} as any,workspaceRoot:'/tmp',resolveAuthority:async()=>authority,runBatch});
 });

});
