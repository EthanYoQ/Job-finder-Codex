import{describe,it,expect,vi}from'vitest';
import{readPortablePublicSnapshot,type PortableSnapshotDb}from'../../src/db/portablePublicSnapshotRepository';
import{searchPortableSnapshot,coverageFromPortableSnapshot}from'../../src/server/portablePublicationApi';
import{handlePublicApi}from'../../src/server/publicApi';
import{accepted,failed,job,plan,NOW}from'../helpers/portablePublicSnapshotFixture';
async function snapshot(fail=false){const a=accepted();const tx={crawlBatchSourceResult:{findMany:async()=>[a.result,...(fail?[failed()]:[])]},lifecycleSetEvidenceMember:{findMany:async()=>a.members},job:{findMany:async()=>[job()]}};return readPortablePublicSnapshot({$transaction:async work=>work(tx)} as PortableSnapshotDb,{currentTime:NOW},[plan]);}
const req=(path='/api/search')=>({method:'GET',path,query:{city:'上海'},headers:{'x-job-search-consent':'accepted'},body:undefined,ip:'127.0.0.10'});
describe('portable complete-snapshot API adapter',()=>{
 it('discloses the configured CSPC channel and Servier portal without promoting held sources or inventing live totals',async()=>{
  const s=await snapshot(),before=structuredClone(s),r=coverageFromPortableSnapshot({keyword:''},s);
  const cspc=r.companies.find(c=>c.id==='company-cspc')!,servier=r.companies.find(c=>c.id==='company-servier-china')!;
  expect(cspc).toMatchObject({state:'VERIFYING',lastSuccessAt:null,sourceScopeNote:expect.stringContaining('人工 D36 指定入口')});
  expect(cspc.sourceScopeNote).toContain('不代表集团及子公司全量');
  expect(servier).toMatchObject({state:'VERIFYING',lastSuccessAt:null,sourceScopeNote:expect.stringContaining('47734')});
  expect(servier.sourceScopeNote).toContain('未披露工作地的职位保持未知');
  expect([cspc.sourceScopeNote,servier.sourceScopeNote].join(' ')).not.toMatch(/31|37|94|95|已抓全|全中国/);
  expect(r.companies.find(c=>c.id===plan.company.id)).not.toHaveProperty('sourceScopeNote');
  expect(s).toEqual(before);
 });
 it.each([['company-cspc','source-cspc-social','人工 D36 指定入口'],['company-servier-china','source-servier-china-social','47734']])('preserves %s scope disclosure beside filtered search results',async(companyId,sourceId,label)=>{
  const s=await snapshot(),original=s.companies.find(c=>c.id===plan.company.id)!,bounded=s.companies.find(c=>c.id===companyId)!;
  bounded.publishingSourceIds=[sourceId];bounded.jobs=original.jobs.map(j=>({...j,companyId,sourceId}));original.jobs=[];
  const before=structuredClone(s),result=searchPortableSnapshot({city:'上海',keyword:'销售'},s);
  expect(result.companies).toHaveLength(1);
  expect(result.companies[0]).toMatchObject({id:companyId,sourceScopeNote:expect.stringContaining(label)});
  expect(result.totalJobs).toBe(1);expect(result.publishedJobSummary.totalJobs).toBe(1);
  expect(s).toEqual(before);
 });
 it('shows Servier portal/China/UNKNOWN counts from a publishing verified source independently of city filters',async()=>{
  const s=await snapshot(),c=s.companies.find(c=>c.id==='company-servier-china')!;
  c.publishingSourceIds=['source-servier-china-social'];
  c.jobs=s.companies.find(c=>c.id===plan.company.id)!.jobs.map(j=>({...j,companyId:c.id,sourceId:c.sourceIds[0]!}));
  s.sources.push({...s.sources[0]!,companyId:c.id,sourceId:c.sourceIds[0]!,state:'PUBLISHING',sourceScopeSummary:{portalJobCount:95,verifiedChinaJobCount:94,unknownCountryJobCount:1}});
  const note=coverageFromPortableSnapshot({keyword:'施维雅'},s).companies[0]!.sourceScopeNote;
  expect(note).toContain('门户职位 95 个，明确中国工作地 94 个，国家待核 1 个');
  expect(note).toContain('官方标记在招，未计入中国职位');
  expect(searchPortableSnapshot({city:'上海',companyIds:[c.id]},s).companies[0]!.sourceScopeNote).toBe(note);
  s.sources.at(-1)!.state='HOLD';
  expect(coverageFromPortableSnapshot({keyword:'施维雅'},s).companies[0]!.sourceScopeNote).not.toContain('95');
 });
 it('returns only verified jobs and the required40 coverage count',async()=>{const r=searchPortableSnapshot({city:'上海'},await snapshot());expect(r.totalJobs).toBe(1);expect(r.companies[0]?.jobs[0]?.officialTitle).toBe('销售职位');expect(r.coverageSummary).toMatchObject({requiredCompanyCount:40,publishingCompanyCount:1,excludedCompanyCount:1});});
 it('filters city and preserves positively nationwide locations',async()=>{const s=await snapshot();expect(searchPortableSnapshot({city:'北京'},s).totalJobs).toBe(0);s.companies.find(c=>c.id===plan.company.id)!.jobs[0]!.cities=['全国'];expect(searchPortableSnapshot({city:'北京'},s).totalJobs).toBe(1);});
 it.each(['中国','China'])('does not turn country-only %s metadata into a city match or delete its record',async(country)=>{const s=await snapshot();const jobs=s.companies.find(c=>c.id===plan.company.id)!.jobs;Object.assign(jobs[0]!,{title:'Affiliate Financial Controller, China',officialTitle:'Affiliate Financial Controller, China',officialUrl:'https://www.astellas.com/content/dam/astellas-com/global/zh/china_career_affiliate_financial_controller.pdf',city:country,cities:[country]});const before=structuredClone(jobs);for(const city of ['北京','上海','广州'])expect(searchPortableSnapshot({city},s).totalJobs).toBe(0);expect(jobs).toEqual(before);});
 it('keeps a positively resolved Beijing PDF role out of Shanghai and Guangzhou',async()=>{const s=await snapshot();const j=s.companies.find(c=>c.id===plan.company.id)!.jobs[0]!;Object.assign(j,{title:'Affiliate Financial Controller, China',city:'北京市',cities:['北京市','中国']});expect(searchPortableSnapshot({city:'北京'},s).totalJobs).toBe(1);expect(searchPortableSnapshot({city:'上海'},s).totalJobs).toBe(0);expect(searchPortableSnapshot({city:'广州'},s).totalJobs).toBe(0);});
 it('matches explicitly resolved Beijing/Shanghai locations without leaking into Guangzhou',async()=>{const s=await snapshot();const j=s.companies.find(c=>c.id===plan.company.id)!.jobs[0]!;Object.assign(j,{title:'Real World Data Scientist',city:'北京',cities:['北京','上海']});expect(searchPortableSnapshot({city:'北京'},s).totalJobs).toBe(1);expect(searchPortableSnapshot({city:'上海'},s).totalJobs).toBe(1);expect(searchPortableSnapshot({city:'广州'},s).totalJobs).toBe(0);});
 it('supports category, keyword, company and new-job filters without a second query',async()=>{const s=await snapshot();expect(searchPortableSnapshot({city:'上海',categories:['销售'],keyword:'销售'},s).totalJobs).toBe(1);expect(searchPortableSnapshot({city:'上海',categories:['医学事务']},s).totalJobs).toBe(0);expect(searchPortableSnapshot({city:'上海',companyIds:['other']},s).totalJobs).toBe(0);expect(searchPortableSnapshot({city:'上海',newWithinDays:7},s).totalJobs).toBe(0);});
 it('keeps failed-latest good-prior visible with degraded coverage',async()=>{const s=await snapshot(true);expect(searchPortableSnapshot({city:'上海'},s).totalJobs).toBe(1);expect(searchPortableSnapshot({city:'上海'},s).coverageSummary.degradedCompanyCount).toBe(1);expect(coverageFromPortableSnapshot({keyword:'豪森'},s).companies[0]).toMatchObject({state:'PUBLISHING',health:'DEGRADED'});});
 it('renders excluded and unverified companies without declaring a zero result',async()=>{const s=await snapshot();const r=coverageFromPortableSnapshot({keyword:''},s);expect(r.companies).toHaveLength(41);expect(r.companies.find(c=>c.id==='company-united-lab')?.state).toBe('USER_AUTHORIZED_PHASE1_EXCLUSION');expect(r.companies.find(c=>c.id==='company-cspc')?.state).toBe('VERIFYING');});
 it('routes search through the complete reader and never calls the legacy job query',async()=>{const s=await snapshot(),legacy=vi.fn(()=>{throw Error('legacy must not run')});const r=await handlePublicApi(req(),{db:{job:{findMany:legacy}} as never,checkDatabaseReadiness:async()=>true,readPortableSnapshot:async()=>s});expect(r.status).toBe(200);expect(r.body).toMatchObject({totalJobs:1,coverageSummary:{requiredCompanyCount:40}});expect(legacy).not.toHaveBeenCalled();});
 it('returns more than ten verified jobs in portable mode without raw receipts',async()=>{const s=await snapshot();const c=s.companies.find(c=>c.id===plan.company.id)!;c.jobs=Array.from({length:11},(_,i)=>({...c.jobs[0]!,id:'job-'+i,officialTitle:'职位'+i,title:'职位'+i}));const r=await handlePublicApi(req(),{db:{} as never,checkDatabaseReadiness:async()=>true,readPortableSnapshot:async()=>s});expect(r.body).toMatchObject({totalJobs:11});expect((r.body as any).companies[0].jobs).toHaveLength(11);expect(JSON.stringify(r.body)).not.toMatch(/completenessCertificate|artifactManifestSha256|rawBody|sourceEvidenceSha256/);});
 it('routes coverage through the same verified snapshot',async()=>{const s=await snapshot();const r=await handlePublicApi({...req('/api/coverage'),query:{}},{db:{} as never,checkDatabaseReadiness:async()=>true,readPortableSnapshot:async()=>s});expect(r.status).toBe(200);expect(r.body).toMatchObject({coverageSummary:{requiredCompanyCount:40},hasMore:false});});
 it('does not bypass existing consent or fall back after a reader failure',async()=>{const read=vi.fn(async()=>{throw Error('READER_FAILURE')});const deps={db:{} as never,checkDatabaseReadiness:async()=>true,readPortableSnapshot:read};expect((await handlePublicApi({...req(),headers:{}},deps)).status).toBe(403);expect(read).not.toHaveBeenCalled();await expect(handlePublicApi(req(),deps)).rejects.toThrow('READER_FAILURE');});
});


describe('portable city-pending discovery', () => {
  async function locationsSnapshot() {
    const s = await snapshot();
    const company = s.companies.find(c => c.id === plan.company.id)!;
    const original = company.jobs[0]!;
    company.jobs = [
      { ...original, id: 'pending', city: '城市待核', cities: ['城市待核'], locationRaw: 'title: Shanghai; structured: Beijing' },
      { ...original, id: 'country-cn', city: '中国', cities: ['中国'], locationRaw: 'China' },
      { ...original, id: 'country-en', city: 'China', cities: ['China', '中国'], locationRaw: 'China' },
      { ...original, id: 'beijing', city: '北京市', cities: ['北京市', '中国'] },
      { ...original, id: 'other-city', city: '杭州', cities: ['杭州', 'China'] },
      { ...original, id: 'nationwide', city: '全国', cities: ['全国', '中国'] }
    ];
    return s;
  }

  it('provides pending and country-only jobs while preserving source and original location', async () => {
    const s = await locationsSnapshot();
    const before = structuredClone(s);
    const result = searchPortableSnapshot({ city: '城市待核' }, s);
    expect(result.totalJobs).toBe(3);
    expect(result.companies[0]!.jobs.map(j => j.id).sort()).toEqual(['country-cn', 'country-en', 'pending']);
    expect(result.companies[0]!.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'pending', city: '城市待核', cityPending: true, locationRaw: 'title: Shanghai; structured: Beijing', sourceId: plan.source.id })
    ]));
    expect(result.companies[0]!.jobs.every(j => j.cityPending)).toBe(true);
    expect(s).toEqual(before);
  });

  it('keeps exact city and nationwide matches separate from unresolved records', async () => {
    const s = await locationsSnapshot();
    expect(searchPortableSnapshot({ city: '北京' }, s).companies[0]!.jobs.map(j => j.id).sort()).toEqual(['beijing', 'nationwide']);
    for (const city of ['上海', '广州']) {
      expect(searchPortableSnapshot({ city }, s).companies[0]!.jobs.map(j => j.id)).toEqual(['nationwide']);
    }
  });

  it.each([['北京', '上海', '广州', '城市待核'], ['全国', '城市待核']])('keeps mixed marker locations %j pending and counted while excluding every exact city', async (...cities) => {
    const s = await locationsSnapshot();
    s.companies.find(c => c.id === plan.company.id)!.jobs = [{
      ...s.companies.find(c => c.id === plan.company.id)!.jobs[0]!,
      city: '北京', cities
    }];
    for (const city of ['北京', '上海', '广州']) expect(searchPortableSnapshot({ city }, s).totalJobs).toBe(0);
    const pending = searchPortableSnapshot({ city: '城市待核' }, s);
    expect(pending.totalJobs).toBe(1);
    expect(pending.publishedJobSummary).toEqual({ totalJobs: 1, cityPendingJobs: 1 });
  });

  it('keeps all-published counts independent of city, keyword, category, and company filters', async () => {
    const s = await locationsSnapshot();
    const hidden = s.companies.find(c => !c.publishingSourceIds.length && c.required)!;
    hidden.jobs = [{ ...s.companies.find(c => c.id === plan.company.id)!.jobs[0]!, id: 'not-publishing' }];
    const excluded = s.companies.find(c => !c.required)!;
    excluded.publishingSourceIds = ['excluded'];
    excluded.jobs = [{ ...hidden.jobs[0]!, id: 'excluded' }];
    const result = searchPortableSnapshot({ city: '北京', keyword: 'no-match', categories: ['医学事务'], companyIds: ['none'] }, s);
    expect(result.totalJobs).toBe(0);
    expect(result.publishedJobSummary).toEqual({ totalJobs: 6, cityPendingJobs: 3 });
    expect(searchPortableSnapshot({ city: '城市待核' }, s).publishedJobSummary).toEqual(result.publishedJobSummary);
  });

  it('applies keyword, category, company, and new-job filters to the pending view', async () => {
    const s = await locationsSnapshot();
    const pending = s.companies.find(c => c.id === plan.company.id)!.jobs[0]!;
    pending.title = 'Pending medical role'; pending.category = '医学事务'; pending.isNew = true;
    const result = searchPortableSnapshot({ city: '城市待核', keyword: 'Pending', categories: ['医学事务'], companyIds: [plan.company.id], newWithinDays: 7 }, s);
    expect(result.companies[0]!.jobs.map(j => j.id)).toEqual(['pending']);
    expect(result.totalJobs).toBe(1);
  });

  it('accepts the pending query only with the verified portable reader', async () => {
    const s = await locationsSnapshot();
    const legacy = vi.fn(() => { throw Error('legacy must not run'); });
    const request = { ...req(), query: { city: '城市待核' } };
    const deps = { db: { job: { findMany: legacy } } as never, checkDatabaseReadiness: async () => true };
    const result = await handlePublicApi(request, { ...deps, readPortableSnapshot: async () => s });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ totalJobs: 3, publishedJobSummary: { totalJobs: 6, cityPendingJobs: 3 } });
    expect(JSON.stringify(result.body)).not.toMatch(/completenessCertificate|artifactManifestSha256|rawBody|sourceEvidenceSha256/);
    expect((await handlePublicApi(request, deps)).status).toBe(400);
    expect(legacy).not.toHaveBeenCalled();
  });
});
