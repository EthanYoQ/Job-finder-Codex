import fs from 'node:fs';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
export async function projectHengruiApi(beforePublic:any,out:string,batchId:string){
const base=path.resolve(import.meta.dirname,'../vendor'),read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8')),sha=(x:any)=>createHash('sha256').update(x).digest('hex');
const input={sourceId:'source-hengrui-social',companyId:'company-hengrui',batchId};
const prior=beforePublic.search,priorCoverage=beforePublic.coverage,company=prior.companies.find((c:any)=>c.id===input.companyId),companyCoverage=priorCoverage.companies.find((c:any)=>c.id===input.companyId);assert(companyCoverage,'HENGRUI_REQUIRED_COVERAGE_COMPANY_MISSING');assert.notEqual(companyCoverage.state,'USER_AUTHORIZED_PHASE1_EXCLUSION','HENGRUI_SOURCE_OUTSIDE_REQUIRED_SCOPE');
const result:any={generatedAt:new Date().toISOString(),status:'PASS',mode:'LOCAL_PINNED_API_PROJECTION_ONLY_NO_NETWORK_NO_SQL',sourceId:input.sourceId,batchId,rootProofs:[]};
for(const [i,name] of ['main','fallback'].entries()){
 const root=path.join(base,'reader-'+name),readerFile=path.join(out,'reader-diagnostic-'+name+'.json'),reader=read(readerFile);
 const manifest=read(path.resolve(import.meta.dirname,'../config/reader-api-pins.json'))[name];
 const apiPath='src/server/portablePublicationApi.ts',apiSha=sha(fs.readFileSync(path.join(root,apiPath)));assert.equal(apiSha,manifest.apiSha256);
 const {searchPortableSnapshot,coverageFromPortableSnapshot}=await import(pathToFileURL(path.join(root,apiPath)).href);
 const handlerPath='src/server/publicApi.ts',handlerSha=sha(fs.readFileSync(path.join(root,handlerPath)));
 assert.equal(handlerSha,manifest.handlerSha256);const {handlePublicApi}=await import(pathToFileURL(path.join(root,handlerPath)).href);
 const readerPin=read(path.resolve(import.meta.dirname,'../config/reader-pins.json'))[name];for(const [file,digest] of Object.entries({...readerPin.localDerivativeFileHashes,...readerPin.readerFileHashes}))assert.equal(sha(fs.readFileSync(path.join(root,file))),digest,'READER_DEPENDENCY_PIN:'+file);
 const companyProjectionPins=read(path.resolve(import.meta.dirname,'../config/hengrui-api-dependency-pins.json'))[name];for(const [file,digest] of Object.entries(companyProjectionPins))assert.equal(sha(fs.readFileSync(path.join(root,file))),digest,'HENGRUI_COMPANY_PROJECTION_PIN:'+file);
 const {candidateCompanies}=await import(pathToFileURL(path.join(root,'src/data/companyRegistry.ts')).href);
 const {P0_LAUNCH_MANIFEST}=await import(pathToFileURL(path.join(root,'src/release/launchManifest.ts')).href);
 const {getPortableCoverageScope}=await import(pathToFileURL(path.join(root,'src/release/portableCoveragePolicy.ts')).href);
 const identity=candidateCompanies.find((c:any)=>c.id===input.companyId),scope=getPortableCoverageScope();
 assert(identity&&scope.requiredCompanyIds.includes(input.companyId)&&scope.requiredSourceIds.includes(input.sourceId),'HENGRUI_SOURCE_OUTSIDE_REQUIRED_SCOPE');
 const sourceIds=P0_LAUNCH_MANIFEST.companies.filter((c:any)=>c.companyId===input.companyId).map((c:any)=>c.source.sourceId).sort();assert.deepEqual(sourceIds,[input.sourceId]);
 // Exactly the original repository's company projection: unpublished sources
 // contribute no jobs or publishingSourceIds. Search may therefore be absent.
 const projectCompany=(source:any)=>{const available=source.state==='PUBLISHING'?[source]:[],allAvailable=available.length===sourceIds.length;return {id:identity.id,companyName:identity.officialChineseName,pinyin:identity.pinyinName,category:identity.category,required:true,sourceIds,publishingSourceIds:available.map((s:any)=>s.sourceId),health:allAvailable&&available.every((s:any)=>s.health==='HEALTHY')?'HEALTHY':available.length>0||source.health==='DEGRADED'?'DEGRADED':'UNVERIFIED',jobs:available.flatMap((s:any)=>s.jobs)};};
 const phases:any={};for(const phase of ['before','after']){
  const source=reader[phase];assert.equal(source.sourceId,input.sourceId);assert.equal(source.companyId,input.companyId,'HENGRUI_READER_COMPANY_SCOPE');if(phase==='after')assert.equal(source.selectedSourceResultId,input.batchId+'--'+input.sourceId);
  const snapshot={sources:[source],companies:[projectCompany(source)],coverage:{requiredCompanyCount:1,excludedCompanyCount:0},lastUpdatedAt:source.state==='PUBLISHING'?source.lastSuccessAt:null};
  const projected=searchPortableSnapshot({city:'全部城市',limit:50,offset:0},snapshot);assert(projected.companies.length<=1);phases[phase]=projected.companies[0]??null;phases[phase+'Coverage']=coverageFromPortableSnapshot({keyword:'',limit:41,offset:0},snapshot).companies[0];
 }
 assert.deepEqual(phases.before,company??null,'BEFORE_READER_TO_PUBLIC_SEARCH_COMPANY_ALL_FIELDS_MUST_MATCH');assert.deepEqual(phases.beforeCoverage,companyCoverage,'BEFORE_READER_TO_PUBLIC_COVERAGE_COMPANY_ALL_FIELDS_MUST_MATCH');
 const aggregatePhases:any={},aggregateSnapshots:any={};
 for(const phase of ['before','after']){
  const source=reader[phase];
  const companies=priorCoverage.companies.map((c:any)=>{if(c.id===input.companyId)return projectCompany(source);const canonical=candidateCompanies.find((x:any)=>x.id===c.id);assert(canonical,'UNKNOWN_PUBLIC_COMPANY');const visible=prior.companies.find((p:any)=>p.id===c.id),required=c.state!=='USER_AUTHORIZED_PHASE1_EXCLUSION',ids=P0_LAUNCH_MANIFEST.companies.filter((x:any)=>x.companyId===c.id).map((x:any)=>x.source.sourceId);return {...c,pinyin:canonical.pinyinName,required,publishingSourceIds:c.state==='PUBLISHING'?ids:[],sourceIds:ids,health:c.health==='NOT_APPLICABLE'?'UNVERIFIED':c.health,jobs:visible?.jobs??[]};});
  const lastUpdatedAt=priorCoverage.companies.map((c:any)=>c.id===input.companyId?(source.state==='PUBLISHING'?source.lastSuccessAt:null):c.state==='PUBLISHING'?c.lastSuccessAt:null).filter(Boolean).sort().at(-1)??null;
  const sources=[source,...priorCoverage.companies.filter((c:any)=>c.id!==input.companyId).flatMap((c:any)=>P0_LAUNCH_MANIFEST.companies.filter((x:any)=>x.companyId===c.id).map((x:any)=>({sourceId:x.source.sourceId,companyId:c.id,lastSuccessAt:c.lastSuccessAt})))];
  const aggregateSnapshot={sources,companies,coverage:{requiredCompanyCount:prior.coverageSummary.requiredCompanyCount,excludedCompanyCount:prior.coverageSummary.excludedCompanyCount},lastUpdatedAt};aggregateSnapshots[phase]=aggregateSnapshot;
  const aggregate=searchPortableSnapshot({city:'全部城市',limit:50,offset:0},aggregateSnapshot);phases[phase+'Search']=aggregate;phases[phase+'FullCoverage']=coverageFromPortableSnapshot({keyword:'',limit:41,offset:0},aggregateSnapshot);aggregatePhases[phase]=Object.fromEntries(Object.entries(aggregate).filter(([key])=>key!=='companies'));
 }
 assert.deepEqual(aggregatePhases.before,Object.fromEntries(Object.entries(prior).filter(([key])=>!['companies','snapshotRefresh'].includes(key))),'BEFORE_ALL_AGGREGATE_AND_FACET_FIELDS_MUST_MATCH_REAL_BASELINE');
 assert.deepEqual(phases.beforeSearch,Object.fromEntries(Object.entries(prior).filter(([key])=>key!=='snapshotRefresh')),'BEFORE_COMPLETE_SEARCH_MUST_MATCH');
 assert.deepEqual(phases.beforeFullCoverage,Object.fromEntries(Object.entries(priorCoverage).filter(([key])=>key!=='snapshotRefresh')),'BEFORE_COMPLETE_COVERAGE_MUST_MATCH');
 phases.beforeAggregate=aggregatePhases.before;phases.afterAggregate=aggregatePhases.after;
 for(const phase of ['before','after']){
 const expectedCases:any=[];
 const targetQueries=[
  {name:'target_company',query:{city:'全部城市',companyIds:input.companyId,limit:'50',offset:'0'}},
  {name:'target_city_shanghai',query:{city:'上海',companyIds:input.companyId,limit:'50',offset:'0'}},
  {name:'target_province_guangdong',query:{city:'全部城市',province:'广东',companyIds:input.companyId,limit:'50',offset:'0'}},
  {name:'target_keyword_category',query:{city:'全部城市',companyIds:input.companyId,keyword:phases[phase]?.jobs[0]?.title.slice(0,100)??'恒瑞',categories:phases[phase]?.jobs[0]?.category??'其他',limit:'50',offset:'0'}}
 ];
 const cases=[...targetQueries.map(tc=>({...tc,api:'/api/search'})),
 ...[[0,17],[17,50]].map(([offset,limit])=>({name:'search_company_page_'+offset,api:'/api/search',query:{city:'全部城市',offset:String(offset),limit:String(limit)}})),
 ...[[0,20],[20,21]].map(([offset,limit])=>({name:'coverage_page_'+offset,api:'/api/coverage',query:{offset:String(offset),limit:String(limit)}})),
 {name:'coverage_target_keyword',api:'/api/coverage',query:{keyword:'恒瑞',offset:'0',limit:'41'}}];
 for(const tc of cases){
  const reply=await handlePublicApi({method:'GET',path:tc.api,query:tc.query,headers:{'x-job-search-consent':'accepted'},body:undefined,ip:'127.0.0.1',userAgent:'C60 offline exact API projection'}, {db:new Proxy({}, {get(){throw Error('OFFLINE_DB_FORBIDDEN')}}),checkDatabaseReadiness:async()=>{throw Error('OFFLINE_DB_FORBIDDEN')},readPortableSnapshot:async()=>aggregateSnapshots[phase]});
  assert.equal(reply.status,200);expectedCases.push({name:tc.name,path:tc.api+'?'+new URLSearchParams(Object.fromEntries(Object.entries(tc.query).filter((entry): entry is [string,string]=>typeof entry[1]==='string'))),expected:reply.body});
 }
 phases[phase+'RequestCases']=expectedCases;

 }

 fs.writeFileSync(path.join(out,'expected-api-'+name+'.json'),JSON.stringify(phases,null,2)+'\n');
 result.rootProofs.push({name,apiPath,apiSha256:apiSha,handlerPath,handlerSha256:handlerSha,companyProjectionPins,requestCases:phases.afterRequestCases.map((x:any)=>x.name),jobLocationSha256:sha(fs.readFileSync(path.join(root,'src/domain/jobLocation.ts'))),readerDiagnosticPath:readerFile,readerDiagnosticSha256:sha(fs.readFileSync(readerFile)),beforeExactAllJobFields:true,beforeExactSearchCompany:true,beforeExactCoverageCompany:true,beforeExactAllAggregateAndFacetFields:true,beforeCount:phases.before?.jobs.length??0,afterCount:phases.after?.jobs.length??0});
 if(i===0)result.expected=phases;else assert.deepEqual(result.expected,phases,'MAIN_AND_FALLBACK_API_PROJECTIONS_MUST_MATCH');
}
const beforeJobs=result.expected.before?.jobs??[],afterJobs=result.expected.after?.jobs??[];const old=new Map<any,any>(beforeJobs.map((j:any)=>[j.id,j])),next=new Map<any,any>(afterJobs.map((j:any)=>[j.id,j]));
result.delta={addedJobs:afterJobs.filter((j:any)=>!old.has(j.id)),addedIds:[...next.keys()].filter(id=>!old.has(id)),removedIds:[...old.keys()].filter(id=>!next.has(id)),changedJobs:afterJobs.filter((j:any)=>old.has(j.id)&&JSON.stringify(old.get(j.id))!==JSON.stringify(j)).map((j:any)=>({id:j.id,title:j.title,changes:Object.keys({...old.get(j.id),...j}).sort().filter(k=>JSON.stringify((old.get(j.id) as any)?.[k]??null)!==JSON.stringify(j[k]??null)).map(k=>({field:k,previous:(old.get(j.id) as any)?.[k]??null,current:j[k]??null}))})).filter((x:any)=>x.changes.length)};
delete result.expected;fs.writeFileSync(path.join(out,'EXPECTED_PUBLIC_DELTA.json'),JSON.stringify(result,null,2)+'\n');return {result,expected:read(path.join(out,'expected-api-main.json'))};
}
