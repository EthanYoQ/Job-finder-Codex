/** Small offline UCB fixture generation. All production source modules and
 * dependencies are read-only; emitted scripts, archives and logs are external.
 * Args: current package, existing runtime package, pinned Node, external evidence.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';
const [currentArg,runtimeArg,nodeArg,evidenceArg]=process.argv.slice(2);
assert.ok(currentArg&&runtimeArg&&nodeArg&&evidenceArg,'CURRENT_RUNTIME_NODE_EVIDENCE_REQUIRED');
const current=path.resolve(currentArg),runtime=path.resolve(runtimeArg),node=path.resolve(nodeArg),evidence=path.resolve(evidenceArg),sha=x=>createHash('sha256').update(x).digest('hex');
for(const root of [current,runtime])assert.ok(evidence!==root&&!evidence.startsWith(root+path.sep),'EVIDENCE_MUST_BE_EXTERNAL');
fs.mkdirSync(evidence,{recursive:true,mode:0o700});const temporary=fs.mkdtempSync(path.join(evidence,'fixture-build-'));
for(const d of ['tmp','cache'])fs.mkdirSync(path.join(temporary,d));
const provenance=[];
for(const rel of ['connector-gate/ucb-synthetic-fixture.mts','connector-gate/ucb-publication-review.mts','connector-gate/ucb-due-policy.mts','test/fixtures/ucb-phenom-synthetic.mts','vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts','vendor/c60-source/src/crawler/officialJsonSourceFetch.ts','vendor/c60-source/src/crawler/sourceQualityAdmission.ts','vendor/c60-source/src/crawler/sourcePlan.ts','vendor/c60-source/src/crawler/ucbOfficialPostedDate.ts','vendor/c60-source/src/crawler/runtimeAtomicEvidence.ts','vendor/c60-source/src/crawler/artifactArchive.ts','vendor/c60-source/src/db/ingestionRepository.ts','vendor/c60-source/src/db/cloudPilotSqlControl.ts','vendor/c60-source/src/domain/jobProjectionDeltaReceipt.ts','config/reader-pins.json','config/reader-api-pins.json']){
 const bytes=fs.readFileSync(path.join(current,rel));assert.equal(sha(fs.readFileSync(path.join(runtime,rel))),sha(bytes),'UNCHANGED_ORIGINAL_NATIVE_SOURCE:'+rel);provenance.push({relative:rel,sha256:sha(bytes)});
}
for(const reader of ['main','fallback'])for(const rel of ['src/db/portablePublicSnapshotRepository.ts','src/server/portablePublicationApi.ts','src/server/publicApi.ts']){
 const key='vendor/reader-'+reader+'/'+rel,bytes=fs.readFileSync(path.join(current,key));assert.equal(sha(fs.readFileSync(path.join(runtime,key))),sha(bytes),'UNCHANGED_ORIGINAL_READER:'+key);provenance.push({relative:key,sha256:sha(bytes)});
}
const url=rel=>JSON.stringify(pathToFileURL(path.join(runtime,rel)).href);
const script=path.join(temporary,'build-ucb.mts');
const source=`import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
import {initialize,configureSyntheticFixtureRuntime,fixture,request,priorFrom,dirs} from ${url('connector-gate/ucb-synthetic-fixture.mts')};
import {syntheticUcbRows} from ${url('test/fixtures/ucb-phenom-synthetic.mts')};
import {prepareUcbConnectorPublicationReview} from ${url('connector-gate/ucb-publication-review.mts')};
import {executeIngestionCommands} from ${url('vendor/c60-source/src/db/ingestionRepository.ts')};
import {compileCloudPilotPublicationContextSql} from ${url('vendor/c60-source/src/db/cloudPilotSqlControl.ts')};
import {parseJobProjectionDeltaReceipt} from ${url('vendor/c60-source/src/domain/jobProjectionDeltaReceipt.ts')};
const pkg=${JSON.stringify(runtime)},out=${JSON.stringify(temporary)},sha=(x:any)=>createHash('sha256').update(x).digest('hex');
const require=createRequire(path.join(pkg,'package.json')),{Prisma}=require('@prisma/client');
const RealDate=Date;let clock=RealDate.now();
class FixtureDate extends RealDate{constructor(...args:any[]){super(...(args.length?args:[clock]) as [any]);}static now(){return clock;}static [Symbol.hasInstance](value:any){return value instanceof RealDate;}}
globalThis.Date=FixtureDate as DateConstructor;
initialize();configureSyntheticFixtureRuntime({setClock:at=>{clock=RealDate.parse(at);},installFetch:fn=>{globalThis.fetch=fn as typeof fetch;}});
async function make(options:any,at=new RealDate().toISOString(),prior:any=null){const f=await fixture({at,prior,syntheticOptions:options,syntheticArtifactParent:out}),gate=await prepareUcbConnectorPublicationReview(f.input);return {f,packet:gate.packet};}
async function physical(item:any){
 const {f,packet}=item,c=packet.commit,r=c.sourceResult,receipt=parseJobProjectionDeltaReceipt(r.completenessCertificate,r.completenessCertificateSha256),jobs:any[]=[];
 await executeIngestionCommands(c.commands.filter((x:any)=>x.type==='UPSERT_JOB'),{batchId:r.batchId},{$transaction:async(fn:any)=>fn({job:{upsert:async(a:any)=>{jobs.push({id:'synthetic-job-'+jobs.length,humanCorrectedTitle:null,humanCorrectedCategory:null,...a.create});}},crawlObservation:{create:async()=>{throw Error('SYNTHETIC_UNREQUESTED_WRITE');}}})} as any);
 const tuple={releaseCandidateId:r.releaseCandidateId,batchId:r.batchId,sourceId:r.sourceId,sourceResultId:r.id};
 const members=receipt.members.map((m:any)=>({...tuple,setKind:m.setKind,jobKey:m.jobKey,jobKeySha256:sha(m.jobKey),lifecycleStatus:'ACTIVE',missingCount:m.missingCount}));
 const observation=c.commands.find((x:any)=>x.type==='UPSERT_CRAWL_OBSERVATION').observation;
 const row={...r,startedAt:new Date(r.startedAt),finishedAt:new Date(r.finishedAt),batch:{...f.input.publication.control.planned.batch,status:'SUCCESS',finishedAt:new Date(r.finishedAt)},observations:[{...observation,...c.observationProvenance,crawledAt:new Date(observation.crawledAt),observedFrom:new Date(c.observationProvenance.observedFrom),observedTo:new Date(c.observationProvenance.observedTo)}],_count:{transportAttempts:c.priorTransportAttempts.length,evidenceArtifacts:c.artifacts.length,observations:1,paginationEvidence:c.pagination.length,lossLedgerEntries:c.lossLedger.length,lifecycleSetMembers:members.length}};
 return {results:[row],members,jobs,receipt};
}
async function read(name:string,plan:any,data:any){
 const root=path.join(pkg,'vendor/reader-'+name),pin=JSON.parse(fs.readFileSync(pkg+'/config/reader-pins.json','utf8'))[name],apiPin=JSON.parse(fs.readFileSync(pkg+'/config/reader-api-pins.json','utf8'))[name];
 for(const [file,hash]of Object.entries({...pin.localDerivativeFileHashes,...pin.readerFileHashes}))assert.equal(sha(fs.readFileSync(path.join(root,file))),hash);
 assert.equal(sha(fs.readFileSync(root+'/src/server/portablePublicationApi.ts')),apiPin.apiSha256);assert.equal(sha(fs.readFileSync(root+'/src/server/publicApi.ts')),apiPin.handlerSha256);
 const repository=await import(pathToFileURL(root+'/src/db/portablePublicSnapshotRepository.ts').href),handler=await import(pathToFileURL(root+'/src/server/publicApi.ts').href);
 const calls:string[]=[];const db={$transaction:async(fn:any,options:any)=>{assert.deepEqual(options,{isolationLevel:'RepeatableRead',maxWait:5000,timeout:10000});return fn({crawlBatchSourceResult:{findMany:async(args:any)=>{calls.push('results');assert.deepEqual(args.where.OR,[{sourceId:'source-ucb-china-social',sourceConfigHash:'0423b01f438925ad3e34e29aeda58fe6353fbd264d4472a09bcb1fba281bd146'}]);return structuredClone(data.results);}},lifecycleSetEvidenceMember:{findMany:async(args:any)=>{calls.push('members');return structuredClone(data.members.filter((m:any)=>args.where.sourceResultId.in.includes(m.sourceResultId)));}},job:{findMany:async()=>{calls.push('jobs');return structuredClone(data.jobs);}}});}};
 const snapshot=await repository.readPortablePublicSnapshot(db,{currentTime:new Date()},[plan]),api:any={};
 for(const [label,url,query]of [['all','/api/search',{city:'全部城市',limit:'50',offset:'0'}],['target','/api/search',{city:'上海',companyIds:'company-ucb-china',limit:'50',offset:'0'}],['coverage','/api/coverage',{keyword:'优时比',limit:'41',offset:'0'}]] as const){
 const reply=await handler.handlePublicApi({method:'GET',path:url,query,headers:{'x-job-search-consent':'accepted'},body:undefined,ip:'127.0.0.1',userAgent:'Synthetic UCB four-source composition'},{db:new Proxy({},{get(){throw Error('REAL_DB_FORBIDDEN');}}),checkDatabaseReadiness:async()=>{throw Error('REAL_DB_FORBIDDEN');},readPortableSnapshot:async()=>snapshot});assert.equal(reply.status,200);api[label]=reply.body;}
 return {snapshot,api,calls};
}
async function both(item:any,data:any){const a=await read('main',item.f.input.publication.source.plan,data),b=await read('fallback',item.f.input.publication.source.plan,data);assert.deepEqual(a,b);return a;}
async function emit(key:string,item:any,options:any){
 const {f,packet}=item,source=f.input.publication.source,projections:any[]=[];
 await executeIngestionCommands(packet.commit.commands.filter((c:any)=>c.type==='UPSERT_JOB'),{batchId:source.batchId},{$transaction:async(fn:any)=>fn({job:{upsert:async(a:any)=>{projections.push(a.create);}},crawlObservation:{create:async()=>{throw Error('UNREQUESTED_OBSERVATION');}}})} as any);
 const model=Prisma.dmmf.datamodel.models.find((m:any)=>m.name==='CrawlBatchSourceResult'),row=Object.fromEntries(model.fields.filter((f:any)=>f.kind!=='object').map((f:any)=>[f.name,(packet.commit.sourceResult as any)[f.name]??null]));
 const tuple={releaseCandidateId:f.input.publication.control.candidate.id,batchId:source.batchId,sourceId:source.plan.source.id,sourceResultId:source.pending.id};
 const relay=fs.readFileSync(path.join(pkg,'vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts'),'utf8'),section=relay.slice(relay.indexOf('async readAndVerifyOwnedUcbOutcome(')),a=section.indexOf('const literal='),b=section.indexOf('const sql=');
 const compiler='const sourceResult={id:tuple.sourceResultId,batchId:tuple.batchId};\\n'+section.slice(a,b).trim().replace(':string','')+'\\n'+section.slice(b,section.indexOf(';',b)+1)+'\\nreturn sql;';
 assert.equal(sha(compiler),'9e0c909bc5a31d1f37e9a112c9d7b28e875b189f2ec27b7a6114c7a30f168442','ORIGINAL_OUTCOME_SQL_COMPILER');
 const readSql=new Function('tuple',compiler)(tuple),expiresAt=new Date(Date.now()+450000).toISOString(),req=(kind:string,payload:any)=>{const body={schemaVersion:1,requestId:randomUUID(),kind,expiresAt,payload};return {...body,requestSha256:sha(JSON.stringify(body))};};
 const {projectId,build,candidate,databaseIdentity}=f.input.publication.control;
 const requests={PUBLISH:request(packet),READ_CONTEXT:req('READ_CONTEXT',{projectId,sourceId:tuple.sourceId,sourceConfigSha256:source.pending.sourceConfigHash}),READ_PUBLICATION_CONTEXT:req('READ_PUBLICATION_CONTEXT',{projectId,sql:compileCloudPilotPublicationContextSql({projectId,build,candidate,databaseIdentity} as any,source.sourceAdmissionPolicy),dispatchBefore:new Date(Date.parse(expiresAt)-25000).toISOString()}),READ_OUTCOME:req('READ_OUTCOME',{projectId,sql:readSql,dispatchBefore:new Date(Date.parse(expiresAt)-25000).toISOString()})};
 const data={kind:'SYNTHETIC_ORIGINAL_SCHEMA50_UCB_COMPILER_FIXTURE',syntheticFixtureOptions:options,syntheticSourceEvidence:source.result.fetchEvidence,context:f.input.publication.control.context,requests,model:{sqlSha256:sha(packet.sql),row,batch:{id:source.batchId,releaseCandidateId:tuple.releaseCandidateId,status:'SUCCESS',atomicCommittedCount:1,completenessVerifiedCount:1},holderId:'',projections},ax:JSON.parse(fs.readFileSync(path.join(pkg,'public-verification/test/observed-ax-grammar.json'),'utf8').replaceAll('company-takeda-china','company-ucb-china').replaceAll('武田中国','优时比中国').replaceAll('武田','优时比').replaceAll('E5','E6')).samples};
 const output=path.join(out,'ucb-'+key+'.json');fs.writeFileSync(output,JSON.stringify(data),{flag:'wx'});return {path:output,sha256:sha(fs.readFileSync(output)),options,projectionCount:projections.length,firstPublic:f.input.publication.control.context.latestAccepted===null,sourceEvidence:source.result.fetchEvidence};
}
const variants:any={},readerCases:any[]=[];
try{
 const seven=await make({count:7});variants.seven=await emit('seven',seven,{count:7});
 const rows=syntheticUcbRows(7);rows[0].applyUrl='https://careers.ucb.com/global/zh/apply/synthetic-apply-1?source=synthetic';
 for(const row of rows)assert.notEqual(row.jobSeqNo,row.reqId);
 const apply=await make({rows});variants.applyUrl=await emit('applyUrl',apply,{rows});
 const applyData=await physical(apply),applyRead=await both(apply,applyData);assert.equal(applyRead.snapshot.sources[0].jobs.length,7);assert.ok(applyRead.snapshot.sources[0].jobs.some((j:any)=>j.officialUrl===rows[0].applyUrl));readerCases.push({name:'native-jobSeqNo-not-reqId-and-applyUrl',passed:true});
 const zero=await make({count:0});variants.zero=await emit('zero',zero,{count:0});const zeroData=await physical(zero),empty=await both(zero,{results:[],members:[],jobs:[]}),zeroRead=await both(zero,zeroData);assert.equal(empty.snapshot.sources[0].state,'HOLD');assert.equal(empty.snapshot.sources[0].visibleJobCount,null);assert.equal(zeroRead.snapshot.sources[0].state,'PUBLISHING');assert.equal(zeroRead.snapshot.sources[0].visibleJobCount,0);assert.equal(zeroRead.api.all.totalJobs,0);readerCases.push({name:'zero-unpublished-vs-verified-empty',passed:true,before:empty,after:zeroRead});
 const past=new RealDate(RealDate.now()-13*60*60*1000).toISOString(),first=await make({count:2},past),old=await physical(first),prior=await priorFrom(first.f,first.packet),grace=await make({count:1},new RealDate().toISOString(),prior);variants.grace=await emit('grace',grace,{count:1,priorCount:2});const graceData=await physical(grace);graceData.results.unshift(...old.results);graceData.members.unshift(...old.members);const graceMembers=graceData.receipt.members.filter((m:any)=>m.setKind==='GRACE');assert.equal(graceMembers.length,1);assert.equal(graceMembers[0].missingCount,1);assert.equal(graceMembers[0].lastConfirmedObservedAt,old.receipt.observedAt);assert.equal(graceMembers[0].lastPresentResultId,first.packet.commit.sourceResult.id);assert.equal(graceMembers[0].lifecycleLastSeenAt,graceMembers[0].lastConfirmedObservedAt);const graceRead=await both(grace,graceData);assert.equal(graceRead.snapshot.sources[0].state,'PUBLISHING');assert.equal(graceRead.snapshot.sources[0].jobs.filter((j:any)=>j.inGrace).length,1);readerCases.push({name:'native-grace-last-present-evidence',passed:true,after:graceRead});
 const baselineData=await physical(seven),baseline=await both(seven,baselineData),pending=structuredClone(baselineData.results[0]);pending.id+='-pending';pending.batchId+='-pending';pending.startedAt=new Date(Date.now()+1);pending.finishedAt=null;pending.atomicCommitState='PENDING';pending.completenessState='PENDING';pending.completenessCertificate=null;pending.completenessCertificateSha256=null;pending.batch={...pending.batch,id:pending.batchId,status:'RUNNING',finishedAt:null};baselineData.results.push(pending);clock+=3;const retained=await both(seven,baselineData);assert.equal(retained.snapshot.sources[0].health,'DEGRADED');assert.deepEqual(retained.snapshot.sources[0].jobs,baseline.snapshot.sources[0].jobs);assert.equal(retained.snapshot.lastUpdatedAt,baseline.snapshot.lastUpdatedAt);assert.equal(retained.snapshot.sources[0].lastSuccessAt,baseline.snapshot.sources[0].lastSuccessAt);assert.deepEqual(retained.api.all.companies,baseline.api.all.companies);assert.equal(retained.api.coverage.companies[0].lastSuccessAt,baseline.api.coverage.companies[0].lastSuccessAt);readerCases.push({name:'pending-successor-last-good-retained',passed:true,before:baseline,after:retained});
 const invalid=structuredClone(pending);invalid.id+='-invalid';invalid.batchId+='-invalid';invalid.startedAt=new Date(Date.now()+1);invalid.finishedAt=new Date(Date.now()+2);invalid.atomicCommitState='COMMITTED';invalid.completenessState='VERIFIED';invalid.batch={...invalid.batch,id:invalid.batchId,status:'SUCCESS',finishedAt:invalid.finishedAt};baselineData.results.push(invalid);clock+=3;const held=await both(seven,baselineData);assert.equal(held.snapshot.sources[0].state,'HOLD');assert.deepEqual(held.snapshot.sources[0].jobs,[]);readerCases.push({name:'invalid-committed-successor-holds-last-good',passed:true,after:held});
 fs.writeFileSync(path.join(out,'native-result.json'),JSON.stringify({variants,readerCases,retainedSyntheticArchiveDirectories:dirs},null,2)+'\\n',{flag:'wx'});
 console.log(JSON.stringify({passed:true,variants:Object.keys(variants),readerCases:readerCases.length,networkCalls:0}));
}finally{globalThis.Date=RealDate;console.error(JSON.stringify({retainedSyntheticArchiveDirectories:dirs,deletedEvidence:false}));}
`;
fs.writeFileSync(script,source,{flag:'wx'});
const env={...process.env,JOBFINDER_CLOUD_SOURCE_ID:'source-ucb-china-social',TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1',TMPDIR:path.join(temporary,'tmp'),XDG_CACHE_HOME:path.join(temporary,'cache')};
const args=['--require',path.join(runtime,'test/no-network.cjs'),'--import',path.join(runtime,'vendor/c60-source/node_modules/tsx/dist/loader.mjs'),script];
const run=spawnSync(node,args,{cwd:runtime,env,encoding:'utf8',maxBuffer:16*1024*1024});
fs.writeFileSync(path.join(temporary,'stdout.log'),run.stdout??'',{flag:'wx'});fs.writeFileSync(path.join(temporary,'stderr.log'),run.stderr??'',{flag:'wx'});assert.equal(run.status,0,'ORIGINAL_UCB_FIXTURE_FAILED:'+run.stderr);
const native=JSON.parse(fs.readFileSync(path.join(temporary,'native-result.json'),'utf8'));
const result={kind:'FOUR_SOURCE_UCB_FIXTURE_SET',...native,provenance,currentPackage:current,runtimePackage:runtime,node:{path:node,sha256:sha(fs.readFileSync(node))},temporary,realDatabaseCalls:0,realBrowserCalls:0,networkCalls:0,newInstalls:0,dependencyCopies:0,deletedEvidence:false};
const manifest=path.join(temporary,'manifest.json');fs.writeFileSync(manifest,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({manifest,variants:Object.keys(native.variants),readerCases:native.readerCases.length,passed:true}));
