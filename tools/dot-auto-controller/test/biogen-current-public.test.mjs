import test from 'node:test';import assert from 'node:assert/strict';import {currentPublicRound} from '../native/biogen-current-public.mjs';
test('CURRENT verification rejects redirected response and never opts into redirect following',async()=>{let options;await assert.rejects(currentPublicRound({fetchImpl:async(url,o)=>{assert.equal(new URL(url).origin,'https://job.orz.md');options=o;return {redirected:true};}}),/CURRENT_PUBLIC_REDIRECT_FORBIDDEN/);assert.equal(options.redirect,'error');});

const now = 1791590400000;
const companyId = 'company-biogen-china';
const coveragePath = '/api/coverage?limit=41';
const searchPath = '/api/search?' + new URLSearchParams({city:'全部城市',limit:'50',offset:'0'});

// Synthetic API replies follow the frozen reader's two distinct conditions:
// coverage counts publishing companies, while search omits zero-job companies.
function fixture({publishingCompanyCount = 2, withJobs = true} = {}) {
  const companies = withJobs ? [{
    id: companyId, companyName: '渤健', pinyin: 'biogen',
    jobs: [1, 2].map(n => ({id: 'job-' + n, companyId, title: '合成职位 ' + n}))
  }] : [];
  const coverageSummary = {requiredCompanyCount:publishingCompanyCount,
    publishingCompanyCount,excludedCompanyCount:0,degradedCompanyCount:0};
  const search = {companies,totalJobs:withJobs ? 2 : 0,coverageSummary,
    publishedJobSummary:{totalJobs:withJobs ? 2 : 0,cityPendingJobs:0},
    lastUpdatedAt:null,cityFacets:[],provinceFacets:[]};
  const coverage = {companies:Array.from({length:publishingCompanyCount},(_,i) => ({
    id:i === 0 ? companyId : 'company-zero-' + i,
    companyName:i === 0 ? '渤健' : '合成零职位公司 ' + i,
    state:'PUBLISHING',health:'HEALTHY',lastSuccessAt:null
  })),offset:0,limit:41,hasMore:false,coverageSummary};
  const replies = new Map([[coveragePath,coverage],[searchPath,search]]);
  const paths = [];
  const fetchImpl = async url => {
    const parsed = new URL(url);
    assert.equal(parsed.origin,'https://job.orz.md');
    const path = parsed.pathname + parsed.search;
    assert(replies.has(path),'Unexpected mocked request: ' + path);
    paths.push(path);
    return {ok:true,status:200,redirected:false,text:async() => JSON.stringify({
      ...replies.get(path),snapshotRefresh:{state:'CURRENT',check:'synthetic.' + (now + 45000) + '.test'}
    })};
  };
  return {search,coverage,replies,paths,fetchImpl,now:() => now};
}

function withExpected(f) {
  const cases = [
    ['target_company','/api/search?city=全部城市&companyIds=' + companyId,f.search],
    ['target_city_shanghai','/api/search?city=上海&companyIds=' + companyId,f.search],
    ['target_province_guangdong','/api/search?province=广东&companyIds=' + companyId,f.search],
    ['target_keyword_category','/api/search?keyword=合成&companyIds=' + companyId,f.search],
    ['search_company_page_0','/api/search?city=全部城市&offset=0&limit=17',f.search],
    ['search_company_page_17','/api/search?city=全部城市&offset=17&limit=50',{...f.search,companies:[]}],
    ['coverage_page_0','/api/coverage?offset=0&limit=20',{...f.coverage,limit:20}],
    ['coverage_page_20','/api/coverage?offset=20&limit=21',{...f.coverage,companies:[],offset:20,limit:21}],
    ['coverage_target_keyword','/api/coverage?keyword=渤健&offset=0&limit=41',{
      ...f.coverage,companies:[f.coverage.companies[0]]}]
  ];
  const afterRequestCases = cases.map(([name,rawPath,body]) => {
    const url = new URL(rawPath,'https://job.orz.md');
    const path = url.pathname + url.search;
    f.replies.set(path,structuredClone(body));
    return {name,path,expected:structuredClone(body)};
  });
  f.expected = structuredClone({afterRequestCases,after:f.search.companies[0]??null,
    afterCoverage:f.coverage.companies[0],
    afterAggregate:Object.fromEntries(Object.entries(f.search).filter(([key]) => key !== 'companies'))});
  return f;
}

for (const [name,publishingCompanyCount,withJobs] of [
  ['no publishing companies',0,false],
  ['one zero-job publishing company',1,false],
  ['multiple zero-job publishing companies',3,false],
  ['job-bearing and zero-job publishing companies',3,true]
]) {
  test('CURRENT accepts ' + name,async() => {
    const f = fixture({publishingCompanyCount,withJobs});
    const result = await currentPublicRound(f);
    assert.equal(result.status,'CURRENT_ALL_FIELDS_PASS');
    assert.equal(result.search.companies.length,withJobs ? 1 : 0);
    assert.equal(result.search.coverageSummary.publishingCompanyCount,publishingCompanyCount);
    assert.equal(result.search.totalJobs,withJobs ? 2 : 0);
    assert.deepEqual(f.paths,[coveragePath,searchPath]);
  });
}

test('CURRENT verifies all nine expected projections with a zero-job publishing company',async() => {
  const f = withExpected(fixture());
  const result = await currentPublicRound(f);
  assert.equal(result.status,'CURRENT_ALL_FIELDS_PASS');
  assert.deepEqual(f.paths,[coveragePath,searchPath,...f.expected.afterRequestCases.map(c => c.path)]);
});

for (const [name,mutate,actual,expected] of [
  ['search total',f => {f.search.totalJobs++;},2,3],
  ['published total',f => {f.search.publishedJobSummary.totalJobs++;},2,3],
  ['duplicate job IDs',f => {f.search.companies[0].jobs[1].id = 'job-1';},1,2],
  ['wrong company ownership',f => {f.search.companies[0].jobs[0].companyId = 'company-wrong';},false,true]
]) {
  test('CURRENT still rejects ' + name + ' with a zero-job publishing company',async() => {
    const f = fixture();
    mutate(f);
    await assert.rejects(currentPublicRound(f),{code:'ERR_ASSERTION',actual,expected});
  });
}

for (let index = 0; index < 9; index++) {
  test('CURRENT still compares all fields of projection ' + (index + 1),async() => {
    const f = withExpected(fixture());
    const requestCase = f.expected.afterRequestCases[index];
    f.replies.get(requestCase.path).unexpectedField = 'projection drift';
    await assert.rejects(currentPublicRound(f),error => {
      assert.equal(error.code,'ERR_ASSERTION');
      assert(error.message.includes(requestCase.name + ':ALL_FIELDS'));
      return true;
    });
    assert.equal(f.paths.length,index + 3);
  });
}

for (const [name,mutate] of [
  ['target search company',f => {f.search.companies[0].jobs[0].title = 'changed';}],
  ['target coverage company',f => {f.coverage.companies[0].health = 'DEGRADED';}],
  ['search aggregate',f => {f.search.cityFacets.push({city:'上海',province:'上海',jobCount:2});}]
]) {
  test('CURRENT still compares the complete ' + name,async() => {
    const f = withExpected(fixture());
    mutate(f);
    await assert.rejects(currentPublicRound(f),{code:'ERR_ASSERTION'});
    assert.equal(f.paths.length,11);
  });
}

test('CURRENT still requires exactly nine expected projections',async() => {
  const f = withExpected(fixture());
  f.expected.afterRequestCases.pop();
  await assert.rejects(currentPublicRound(f),{code:'ERR_ASSERTION',actual:8,expected:9});
  assert.equal(f.paths.length,2);
});

test('CURRENT expected target may be absent for zero-job publication',async()=>{const f=withExpected(fixture({withJobs:false}));assert.equal(f.expected.after,null);assert.equal((await currentPublicRound(f)).status,'CURRENT_ALL_FIELDS_PASS');});
