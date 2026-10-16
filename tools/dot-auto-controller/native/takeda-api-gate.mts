import fs from 'node:fs';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
export async function projectTakedaApi(beforePublic:any,out:string,batchId:string){
const base=path.resolve(import.meta.dirname,'../vendor'),read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8')),sha=(x:any)=>createHash('sha256').update(x).digest('hex');
const input={sourceId:'source-takeda-china-social',companyId:'company-takeda-china',batchId};
const prior=beforePublic.search,priorCoverage=beforePublic.coverage,company=prior.companies.find((c:any)=>c.id===input.companyId),companyCoverage=priorCoverage.companies.find((c:any)=>c.id===input.companyId);assert(company&&companyCoverage);
const result:any={generatedAt:new Date().toISOString(),status:'PASS',mode:'LOCAL_REAL_DEPLOYED_API_PROJECTION_ONLY_NO_NETWORK_NO_SQL',sourceId:input.sourceId,batchId,rootProofs:[]};
for(const [i,name] of ['main','fallback'].entries()){
 const root=path.join(base,'reader-'+name),readerFile=path.join(out,'reader-diagnostic-'+name+'.json'),reader=read(readerFile);
 const manifest=read(path.resolve(import.meta.dirname,'../config/reader-api-pins.json'))[name];
 const apiPath='src/server/portablePublicationApi.ts',apiSha=sha(fs.readFileSync(path.join(root,apiPath)));assert.equal(apiSha,manifest.apiSha256);
 const {searchPortableSnapshot,coverageFromPortableSnapshot}=await import(pathToFileURL(path.join(root,apiPath)).href);
 const handlerPath='src/server/publicApi.ts',handlerSha=sha(fs.readFileSync(path.join(root,handlerPath)));
 assert.equal(handlerSha,manifest.handlerSha256);const {handlePublicApi}=await import(pathToFileURL(path.join(root,handlerPath)).href);
 const phases:any={};for(const phase of ['before','after']){
  const source=reader[phase];assert.equal(source.sourceId,input.sourceId);if(phase==='after')assert.equal(source.selectedSourceResultId,input.batchId+'--'+input.sourceId);
  const snapshot={sources:[source],companies:[{...company,category:companyCoverage.category,required:true,sourceIds:[source.sourceId],publishingSourceIds:[source.sourceId],health:source.health,jobs:source.jobs}],coverage:{requiredCompanyCount:1,excludedCompanyCount:0},lastUpdatedAt:source.lastSuccessAt};
  const projected=searchPortableSnapshot({city:'全部城市',limit:50,offset:0},snapshot);assert.equal(projected.companies.length,1);phases[phase]=projected.companies[0];phases[phase+'Coverage']=coverageFromPortableSnapshot({keyword:'',limit:41,offset:0},snapshot).companies[0];
 }
 assert.deepEqual(phases.before,company,'BEFORE_READER_TO_PUBLIC_SEARCH_COMPANY_ALL_FIELDS_MUST_MATCH');assert.deepEqual(phases.beforeCoverage,companyCoverage,'BEFORE_READER_TO_PUBLIC_COVERAGE_COMPANY_ALL_FIELDS_MUST_MATCH');
 const aggregatePhases:any={},aggregateSnapshots:any={};
 for(const phase of ['before','after']){
  const source=reader[phase];
  const companies=priorCoverage.companies.map((c:any)=>{const visible=c.id===company.id?phases[phase]:prior.companies.find((p:any)=>p.id===c.id),required=c.state!=='USER_AUTHORIZED_PHASE1_EXCLUSION',health=c.id===company.id?source.health:c.health==='NOT_APPLICABLE'?'UNVERIFIED':c.health;return {...c,pinyin:visible?.pinyin??c.id,required,publishingSourceIds:c.state==='PUBLISHING'?[c.id===company.id?source.sourceId:c.id]:[],sourceIds:[c.id],health,jobs:visible?.jobs??[]};});
  const lastUpdatedAt=priorCoverage.companies.map((c:any)=>c.id===company.id?source.lastSuccessAt:c.lastSuccessAt).filter(Boolean).sort().at(-1)??null;
  const aggregateSnapshot={sources:[source],companies,coverage:{requiredCompanyCount:prior.coverageSummary.requiredCompanyCount,excludedCompanyCount:prior.coverageSummary.excludedCompanyCount},lastUpdatedAt};aggregateSnapshots[phase]=aggregateSnapshot;
  const aggregate=searchPortableSnapshot({city:'全部城市',limit:50,offset:0},aggregateSnapshot);aggregatePhases[phase]=Object.fromEntries(Object.entries(aggregate).filter(([key])=>key!=='companies'));
 }
 assert.deepEqual(aggregatePhases.before,Object.fromEntries(Object.entries(prior).filter(([key])=>!['companies','snapshotRefresh'].includes(key))),'BEFORE_ALL_AGGREGATE_AND_FACET_FIELDS_MUST_MATCH_REAL_BASELINE');
 phases.beforeAggregate=aggregatePhases.before;phases.afterAggregate=aggregatePhases.after;
 for(const phase of ['before','after']){
 const phaseSearch={...prior,...aggregatePhases[phase],companies:prior.companies.map((c:any)=>c.id===company.id?phases[phase]:c)};delete phaseSearch.snapshotRefresh;
 const phaseCoverage={...priorCoverage,companies:priorCoverage.companies.map((c:any)=>c.id===company.id?phases[phase+'Coverage']:c),coverageSummary:aggregatePhases[phase].coverageSummary};delete phaseCoverage.snapshotRefresh;
 const expectedCases:any=[];
 const targetQueries=[
  {name:'target_company',query:{city:'全部城市',companyIds:company.id,limit:'50',offset:'0'}},
  {name:'target_city_shanghai',query:{city:'上海',companyIds:company.id,limit:'50',offset:'0'}},
  {name:'target_province_guangdong',query:{city:'全部城市',province:'广东',companyIds:company.id,limit:'50',offset:'0'}},
  {name:'target_keyword_category',query:{city:'全部城市',companyIds:company.id,keyword:phases[phase].jobs[0]?.title.slice(0,100)??'武田',categories:phases[phase].jobs[0]?.category??'其他',limit:'50',offset:'0'}}
 ];
 for(const tc of targetQueries){
  const reply=await handlePublicApi({method:'GET',path:'/api/search',query:tc.query,headers:{'x-job-search-consent':'accepted'},body:undefined,ip:'127.0.0.1',userAgent:'C60 offline exact API projection'}, {db:new Proxy({}, {get(){throw Error('OFFLINE_DB_FORBIDDEN')}}),checkDatabaseReadiness:async()=>{throw Error('OFFLINE_DB_FORBIDDEN')},readPortableSnapshot:async()=>aggregateSnapshots[phase]});
  assert.equal(reply.status,200);expectedCases.push({name:tc.name,path:'/api/search?'+new URLSearchParams(Object.fromEntries(Object.entries(tc.query).filter((entry): entry is [string,string]=>typeof entry[1]==='string'))),expected:reply.body});
 }
 for(const [offset,limit] of [[0,17],[17,50]])expectedCases.push({name:'search_company_page_'+offset,path:'/api/search?'+new URLSearchParams({city:'全部城市',offset:String(offset),limit:String(limit)}),expected:{...phaseSearch,companies:phaseSearch.companies.slice(offset,offset+limit)}});
 for(const [offset,limit] of [[0,20],[20,21]])expectedCases.push({name:'coverage_page_'+offset,path:'/api/coverage?'+new URLSearchParams({offset:String(offset),limit:String(limit)}),expected:{...phaseCoverage,companies:phaseCoverage.companies.slice(offset,offset+limit),offset,limit,hasMore:offset+limit<phaseCoverage.companies.length}});
 expectedCases.push({name:'coverage_target_keyword',path:'/api/coverage?'+new URLSearchParams({keyword:'武田',offset:'0',limit:'41'}),expected:{...phaseCoverage,companies:[phases[phase+'Coverage']],offset:0,limit:41,hasMore:false}});
 phases[phase+'RequestCases']=expectedCases;

 }

 fs.writeFileSync(path.join(out,'expected-api-'+name+'.json'),JSON.stringify(phases,null,2)+'\n');
 result.rootProofs.push({name,apiPath,apiSha256:apiSha,handlerPath,handlerSha256:handlerSha,requestCases:phases.afterRequestCases.map((x:any)=>x.name),jobLocationSha256:sha(fs.readFileSync(path.join(root,'src/domain/jobLocation.ts'))),readerDiagnosticPath:readerFile,readerDiagnosticSha256:sha(fs.readFileSync(readerFile)),beforeExactAllJobFields:true,beforeExactSearchCompany:true,beforeExactCoverageCompany:true,beforeExactAllAggregateAndFacetFields:true,beforeCount:phases.before.jobs.length,afterCount:phases.after.jobs.length});
 if(i===0)result.expected=phases;else assert.deepEqual(result.expected,phases,'MAIN_AND_FALLBACK_API_PROJECTIONS_MUST_MATCH');
}
const old=new Map<any,any>(result.expected.before.jobs.map((j:any)=>[j.id,j])),next=new Map<any,any>(result.expected.after.jobs.map((j:any)=>[j.id,j]));
result.delta={addedJobs:result.expected.after.jobs.filter((j:any)=>!old.has(j.id)),addedIds:[...next.keys()].filter(id=>!old.has(id)),removedIds:[...old.keys()].filter(id=>!next.has(id)),changedJobs:result.expected.after.jobs.filter((j:any)=>old.has(j.id)&&JSON.stringify(old.get(j.id))!==JSON.stringify(j)).map((j:any)=>({id:j.id,title:j.title,changes:Object.keys({...old.get(j.id),...j}).sort().filter(k=>JSON.stringify((old.get(j.id) as any)?.[k]??null)!==JSON.stringify(j[k]??null)).map(k=>({field:k,previous:(old.get(j.id) as any)?.[k]??null,current:j[k]??null}))})).filter((x:any)=>x.changes.length)};
delete result.expected;fs.writeFileSync(path.join(out,'EXPECTED_PUBLIC_DELTA.json'),JSON.stringify(result,null,2)+'\n');return {result,expected:read(path.join(out,'expected-api-main.json'))};
}
