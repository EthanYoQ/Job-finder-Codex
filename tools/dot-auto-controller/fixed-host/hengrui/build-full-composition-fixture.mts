/** Offline synthetic fixture built by the actual schema50 gate/compiler. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {initialize,configureSyntheticFixtureRuntime,fixture,request,dirs} from '../../connector-gate/hengrui-synthetic-fixture.mts';
import {prepareHengruiConnectorPublicationReview} from '../../connector-gate/hengrui-publication-review.mts';
import {executeIngestionCommands} from '../../vendor/c60-source/src/db/ingestionRepository.ts';
import {compileCloudPilotPublicationContextSql} from '../../vendor/c60-source/src/db/cloudPilotSqlControl.ts';
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
if(process.argv.length!==3)throw Error('SYNTHETIC_FIXTURE_OUTPUT_REQUIRED');
const target=resolve(process.argv[2]!);const rel=relative(resolve(import.meta.dirname,'../../../..'),target);if(rel===''||(rel!=='..'&&!rel.startsWith('../')&&!isAbsolute(rel)))throw Error('SYNTHETIC_EVIDENCE_INPUT_OVERLAP');
initialize();configureSyntheticFixtureRuntime({setClock:at=>{if(Math.abs(Date.now()-Date.parse(at))>1000)throw Error('REAL_CLOCK');},installFetch:fn=>{globalThis.fetch=fn as typeof fetch;}});
try{
 const f=await fixture({at:new Date().toISOString(),syntheticOptions:{count:7},syntheticArtifactParent:dirname(target)}),gate=await prepareHengruiConnectorPublicationReview(f.input),packet=gate.packet,source=f.input.publication.source,projections:any[]=[];
 await executeIngestionCommands(packet.commit.commands.filter((c:any)=>c.type==='UPSERT_JOB'),{batchId:source.batchId},{$transaction:async(fn:any)=>fn({job:{upsert:async(a:any)=>{projections.push(a.create);}},crawlObservation:{create:async()=>{throw Error('UNREQUESTED_OBSERVATION');}}})} as any);
 const model=Prisma.dmmf.datamodel.models.find(m=>m.name==='CrawlBatchSourceResult')!;
 const row=Object.fromEntries(model.fields.filter(f=>f.kind!=='object').map(f=>[f.name,(packet.commit.sourceResult as any)[f.name]??null]));
 const tuple={releaseCandidateId:f.input.publication.control.candidate.id,batchId:source.batchId,sourceId:source.plan.source.id,sourceResultId:source.pending.id};
 const relay=readFileSync(resolve('vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts'),'utf8');
 const section=relay.slice(relay.indexOf('async readAndVerifyOwnedHengruiOutcome(')),a=section.indexOf('const literal='),b=section.indexOf('const sql=');
 const compiler='const sourceResult={id:tuple.sourceResultId,batchId:tuple.batchId};\n'+section.slice(a,b).trim().replace(':string','')+'\n'+section.slice(b,section.indexOf(';',b)+1)+'\nreturn sql;';
 if(sha(compiler)!=='9e0c909bc5a31d1f37e9a112c9d7b28e875b189f2ec27b7a6114c7a30f168442')throw Error('ORIGINAL_COMPILER_PIN');
 const readSql=new Function('tuple',compiler)(tuple),expiresAt=new Date(Date.now()+450000).toISOString();
 const req=(kind:string,payload:any)=>{const body={schemaVersion:1,requestId:randomUUID(),kind,expiresAt,payload};return {...body,requestSha256:sha(JSON.stringify(body))};};
 const {projectId,build,candidate,databaseIdentity}=f.input.publication.control;
 const requests={PUBLISH:request(packet),READ_CONTEXT:req('READ_CONTEXT',{sourceId:tuple.sourceId,sourceConfigSha256:source.pending.sourceConfigHash}),
  READ_PUBLICATION_CONTEXT:req('READ_PUBLICATION_CONTEXT',{projectId:'yiopvxysxrtrnvqxwgbx',sql:compileCloudPilotPublicationContextSql({projectId,build,candidate,databaseIdentity} as any,source.sourceAdmissionPolicy),dispatchBefore:new Date(Date.parse(expiresAt)-25000).toISOString()}),
  READ_OUTCOME:req('READ_OUTCOME',{projectId:'yiopvxysxrtrnvqxwgbx',sql:readSql,dispatchBefore:new Date(Date.parse(expiresAt)-25000).toISOString()})};
 // The fixed full-composition harness expects the project on every request.
 (requests.READ_CONTEXT.payload as any).projectId='yiopvxysxrtrnvqxwgbx';const {requestSha256,...body}=requests.READ_CONTEXT;requests.READ_CONTEXT.requestSha256=sha(JSON.stringify(body));
 const data={kind:'SYNTHETIC_ORIGINAL_SCHEMA50_COMPILER_FIXTURE',context:f.input.publication.control.context,requests,
  model:{sqlSha256:sha(packet.sql),row,batch:{id:source.batchId,releaseCandidateId:tuple.releaseCandidateId,status:'SUCCESS',atomicCommittedCount:1,completenessVerifiedCount:1},holderId:'',projections},
  ax:JSON.parse(readFileSync(resolve('public-verification/test/observed-ax-grammar.json'),'utf8').replaceAll('company-takeda-china','company-hengrui').replaceAll('武田中国','江苏恒瑞医药股份有限公司').replaceAll('武田','恒瑞').replaceAll('E5','C3')).samples};
 writeFileSync(target,JSON.stringify(data));console.log(JSON.stringify({kind:data.kind,bytes:readFileSync(target).length,modelFields:Object.keys(row).length,realDatabaseCalls:0,networkCalls:0}));
}finally{console.error(JSON.stringify({retainedSyntheticArchiveDirectories:dirs,deletedEvidence:false}));}
