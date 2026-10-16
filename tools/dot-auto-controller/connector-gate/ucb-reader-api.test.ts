/** Original pinned main/fallback repositories and HTTP handlers. The DB read
 * port supplies explicit synthetic rows derived from the actual compiler packet. */
import {beforeAll,afterEach,it,expect,vi} from 'vitest';import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {initialize,configureSyntheticFixtureRuntime,fixture,priorFrom,digest,NOW} from './ucb-synthetic-fixture.mts';
import {prepareUcbConnectorPublicationReview} from './ucb-publication-review.mts';
import {executeIngestionCommands} from '../vendor/c60-source/src/db/ingestionRepository.ts';
import {parseJobProjectionDeltaReceipt} from '../vendor/c60-source/src/domain/jobProjectionDeltaReceipt.ts';
const pkg=path.resolve(import.meta.dirname,'..'),SOURCE='source-ucb-china-social';
beforeAll(()=>{initialize();configureSyntheticFixtureRuntime({setClock:at=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);},installFetch:fn=>vi.stubGlobal('fetch',fn)});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
async function syntheticPhysicalRows(f:any,packet:any){
 const c=packet.commit,r=c.sourceResult,receipt=parseJobProjectionDeltaReceipt(r.completenessCertificate,r.completenessCertificateSha256),jobs:any[]=[];
 await executeIngestionCommands(c.commands.filter((x:any)=>x.type==='UPSERT_JOB'),{batchId:r.batchId},{$transaction:async(fn:any)=>fn({job:{upsert:async(args:any)=>{jobs.push({id:'synthetic-job-'+jobs.length,humanCorrectedTitle:null,humanCorrectedCategory:null,...args.create});}},crawlObservation:{create:async()=>{throw Error('SYNTHETIC_UNREQUESTED_WRITE');}}})} as any);
 const tuple={releaseCandidateId:r.releaseCandidateId,batchId:r.batchId,sourceId:r.sourceId,sourceResultId:r.id};
 const members=receipt.members.map(m=>({...tuple,setKind:m.setKind,jobKey:m.jobKey,jobKeySha256:digest(m.jobKey),lifecycleStatus:'ACTIVE',missingCount:m.missingCount}));
 const observation=c.commands.find((x:any)=>x.type==='UPSERT_CRAWL_OBSERVATION').observation;
 const row={...r,startedAt:new Date(r.startedAt),finishedAt:new Date(r.finishedAt),batch:{...f.input.publication.control.planned.batch,status:'SUCCESS',finishedAt:new Date(r.finishedAt)},observations:[{...observation,...c.observationProvenance,crawledAt:new Date(observation.crawledAt),observedFrom:new Date(c.observationProvenance.observedFrom),observedTo:new Date(c.observationProvenance.observedTo)}],_count:{transportAttempts:c.priorTransportAttempts.length,evidenceArtifacts:c.artifacts.length,observations:1,paginationEvidence:c.pagination.length,lossLedgerEntries:c.lossLedger.length,lifecycleSetMembers:members.length}};
 return {results:[row],members,jobs,receipt};
}
async function reader(name:string,plan:any,data:any){
 const root=path.join(pkg,'vendor/reader-'+name),pin=JSON.parse(fs.readFileSync(pkg+'/config/reader-pins.json','utf8'))[name],apiPin=JSON.parse(fs.readFileSync(pkg+'/config/reader-api-pins.json','utf8'))[name];
 for(const [file,hash]of Object.entries({...pin.localDerivativeFileHashes,...pin.readerFileHashes}))expect(digest(fs.readFileSync(path.join(root,file)))).toBe(hash);
 expect(digest(fs.readFileSync(root+'/src/server/portablePublicationApi.ts'))).toBe(apiPin.apiSha256);expect(digest(fs.readFileSync(root+'/src/server/publicApi.ts'))).toBe(apiPin.handlerSha256);
 const repository=await import(pathToFileURL(root+'/src/db/portablePublicSnapshotRepository.ts').href),handler=await import(pathToFileURL(root+'/src/server/publicApi.ts').href);
 const calls:string[]=[];const db={$transaction:async(fn:any,options:any)=>{expect(options).toEqual({isolationLevel:'RepeatableRead',maxWait:5000,timeout:10000});return fn({crawlBatchSourceResult:{findMany:async(args:any)=>{calls.push('results');expect(args.where.OR).toEqual([{sourceId:SOURCE,sourceConfigHash:'0423b01f438925ad3e34e29aeda58fe6353fbd264d4472a09bcb1fba281bd146'}]);return structuredClone(data.results);}},lifecycleSetEvidenceMember:{findMany:async(args:any)=>{calls.push('members');return structuredClone(data.members.filter((m:any)=>args.where.sourceResultId.in.includes(m.sourceResultId)));}},job:{findMany:async()=>{calls.push('jobs');return structuredClone(data.jobs);}}});}};
 const snapshot=await repository.readPortablePublicSnapshot(db,{currentTime:new Date()},[plan]);
 const api:any={};for(const [label,url,query]of [['all','/api/search',{city:'全部城市',limit:'50',offset:'0'}],['target','/api/search',{city:'上海',companyIds:'company-ucb-china',limit:'50',offset:'0'}],['coverage','/api/coverage',{keyword:'优时比',limit:'41',offset:'0'}]] as const){
  const reply=await handler.handlePublicApi({method:'GET',path:url,query,headers:{'x-job-search-consent':'accepted'},body:undefined,ip:'127.0.0.1',userAgent:'Synthetic UCB offline reader test'},{db:new Proxy({},{get(){throw Error('REAL_DB_FORBIDDEN');}}),checkDatabaseReadiness:async()=>{throw Error('REAL_DB_FORBIDDEN');},readPortableSnapshot:async()=>snapshot});expect(reply.status).toBe(200);api[label]=reply.body;
 }
 return {snapshot,api,calls};
}
function assertHttpProjection(output:any,count:number,state='PUBLISHING',health='HEALTHY'){
 for(const label of ['all','target']){const body=output.api[label];expect(body.totalJobs).toBe(count);expect(body.publishedJobSummary.totalJobs).toBe(count);expect(body.lastUpdatedAt).toBe(output.snapshot.lastUpdatedAt);const jobs=body.companies.flatMap((c:any)=>c.jobs);expect(jobs).toHaveLength(count);for(const j of jobs){expect(j.sourceId).toBe(SOURCE);expect(j.companyId).toBe('company-ucb-china');expect(j.officialPublishedAt).toBe('2026-08-24T05:54:14.000Z');expect(j.cities).toEqual(['上海']);}}
 expect(output.api.coverage.companies).toHaveLength(1);expect(output.api.coverage.companies[0]).toMatchObject({id:'company-ucb-china',state,health});
}

it.each([0,1,51])('both pinned readers and actual HTTP handlers project the original %i-row packet identically',async count=>{
 const f=await fixture({syntheticOptions:{count}}),gate=await prepareUcbConnectorPublicationReview(f.input),data=await syntheticPhysicalRows(f,gate.packet),before={results:[],members:[],jobs:[]};
 const outputs=[];for(const name of ['main','fallback']){const b=await reader(name,f.input.publication.source.plan,before);expect(b.snapshot.sources[0]).toMatchObject({state:'HOLD',visibleJobCount:null});const a=await reader(name,f.input.publication.source.plan,data);expect(a.snapshot.sources[0]).toMatchObject({state:'PUBLISHING',visibleJobCount:count,selectedSourceResultId:gate.packet.commit.sourceResult.id});expect(a.snapshot.sources[0].jobs.every((j:any)=>j.officialPublishedAt==='2026-08-24T05:54:14.000Z')).toBe(true);assertHttpProjection(b,0,'VERIFYING','NOT_APPLICABLE');assertHttpProjection(a,count);outputs.push({before:b,after:a});}expect(outputs[0]).toEqual(outputs[1]);expect(data.receipt.detailEvidenceState).toBe('UNKNOWN');
});
it.each(['source','config','receipt','membership','projection','invalid-committed-successor'])('both original readers HOLD changed %s evidence',async mode=>{
 const f=await fixture({syntheticOptions:{count:1}}),gate=await prepareUcbConnectorPublicationReview(f.input),data:any=await syntheticPhysicalRows(f,gate.packet);
 if(mode==='source')data.results[0].sourceId='source-biogen-china-social';if(mode==='config')data.results[0].sourceConfigHash='0'.repeat(64);if(mode==='receipt')data.results[0].completenessCertificateSha256='0'.repeat(64);if(mode==='membership')data.members=[];if(mode==='projection')data.jobs[0].officialTitle='Corrupted synthetic title';
 if(mode==='invalid-committed-successor'){const newer=structuredClone(data.results[0]);newer.id+='-unknown';newer.batchId+='-unknown';newer.startedAt=new Date(Date.now()+1);newer.finishedAt=new Date(Date.now()+2);newer.atomicCommitState='COMMITTED';newer.completenessState='VERIFIED';newer.completenessCertificate=null;newer.completenessCertificateSha256=null;newer.batch={...newer.batch,id:newer.batchId,status:'SUCCESS',finishedAt:newer.finishedAt};data.results.push(newer);vi.setSystemTime(Date.now()+3);}
 const a=await reader('main',f.input.publication.source.plan,data),b=await reader('fallback',f.input.publication.source.plan,data);expect(a).toEqual(b);expect(a.snapshot.sources[0].state).toBe('HOLD');expect(a.snapshot.sources[0].jobs).toEqual([]);
});
it('original delta lifecycle preserves GRACE and its real last-present evidence across both readers',async()=>{
 const first=await fixture({syntheticOptions:{count:2}}),firstGate=await prepareUcbConnectorPublicationReview(first.input),old=await syntheticPhysicalRows(first,firstGate.packet),prior=await priorFrom(first,firstGate.packet);
 const next=await fixture({at:'2026-10-11T22:00:00.000Z',prior,syntheticOptions:{count:1}}),gate=await prepareUcbConnectorPublicationReview(next.input),data=await syntheticPhysicalRows(next,gate.packet);data.results.unshift(...old.results);data.members.unshift(...old.members);
 expect(data.receipt.members.filter(m=>m.setKind==='GRACE')).toHaveLength(1);
 const a=await reader('main',next.input.publication.source.plan,data),b=await reader('fallback',next.input.publication.source.plan,data);expect(a).toEqual(b);expect(a.snapshot.sources[0].state).toBe('PUBLISHING');expect(a.snapshot.sources[0].jobs.filter((j:any)=>j.inGrace)).toHaveLength(1);
});

it('an unresolved successor retains only the original verified last-good projection and observation time',async()=>{
 const f=await fixture({syntheticOptions:{count:1}}),gate=await prepareUcbConnectorPublicationReview(f.input),data=await syntheticPhysicalRows(f,gate.packet),baseline=await reader('main',f.input.publication.source.plan,data);
 const newer=structuredClone(data.results[0]);newer.id+='-pending';newer.batchId+='-pending';newer.startedAt=new Date(Date.now()+1);newer.finishedAt=null;newer.atomicCommitState='PENDING';newer.completenessState='PENDING';newer.completenessCertificate=null;newer.completenessCertificateSha256=null;newer.batch={...newer.batch,id:newer.batchId,status:'RUNNING',finishedAt:null};data.results.push(newer);vi.setSystemTime(Date.now()+2);
 const a=await reader('main',f.input.publication.source.plan,data),b=await reader('fallback',f.input.publication.source.plan,data);expect(a).toEqual(b);const old=baseline.snapshot.sources[0],current=a.snapshot.sources[0];expect(current).toMatchObject({state:'PUBLISHING',health:'DEGRADED',selectedSourceResultId:old.selectedSourceResultId,lastAcceptedAt:old.lastAcceptedAt,lastSuccessAt:old.lastSuccessAt});expect(current.reasons).toContain('LATEST_ATTEMPT_RUNNING');expect(current.jobs).toEqual(old.jobs);expect(a.snapshot.lastUpdatedAt).toBe(baseline.snapshot.lastUpdatedAt);assertHttpProjection(a,1,'PUBLISHING','DEGRADED');expect(a.api.all.companies).toEqual(baseline.api.all.companies);expect(a.api.coverage.companies[0].lastSuccessAt).toBe(baseline.api.coverage.companies[0].lastSuccessAt);
});
