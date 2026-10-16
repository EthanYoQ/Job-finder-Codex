/** Prepared full-tier fixture emitter, NOT_RUN in the source-only candidate.
 * Requires its own measured native runtime. Synthetic HTTP inputs go through
 * original Tupu capture, admission, schema50 review, compiler and Prisma mapper.
 * It is never a database, browser, installation or production qualification. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {initialize,configureSyntheticFixtureRuntime,fixture,request,dirs} from '../../connector-gate/viatris-synthetic-fixture.mts';
import {prepareViatrisConnectorPublicationReview} from '../../connector-gate/viatris-publication-review.mts';
import {executeIngestionCommands} from '../../vendor/c60-source/src/db/ingestionRepository.ts';
import {compileCloudPilotPublicationContextSql} from '../../vendor/c60-source/src/db/cloudPilotSqlControl.ts';
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
if(process.argv.length<3||process.argv.length>4)throw Error('SYNTHETIC_FIXTURE_OUTPUT_REQUIRED');
const options=process.argv[3]?JSON.parse(process.argv[3]):{count:7};
if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['count','pageSize'].includes(k))||!Number.isSafeInteger(options.count)||options.count<0||options.count>1000||options.pageSize!==undefined&&(!Number.isSafeInteger(options.pageSize)||options.pageSize<1||options.pageSize>100))throw Error('SYNTHETIC_VIATRIS_OPTIONS');
const target=resolve(process.argv[2]!);const rel=relative(resolve(import.meta.dirname,'../../../..'),target);if(rel===''||(rel!=='..'&&!rel.startsWith('../')&&!isAbsolute(rel)))throw Error('SYNTHETIC_EVIDENCE_INPUT_OVERLAP');
initialize();configureSyntheticFixtureRuntime({setClock:at=>{if(Math.abs(Date.now()-Date.parse(at))>1000)throw Error('REAL_CLOCK');},installFetch:fn=>{globalThis.fetch=fn as typeof fetch;}});
try{
 const f=await fixture({at:new Date().toISOString(),syntheticOptions:options,syntheticArtifactParent:dirname(target)}),gate=await prepareViatrisConnectorPublicationReview(f.input),packet=gate.packet,source=f.input.publication.source,projections:any[]=[];
 await executeIngestionCommands(packet.commit.commands.filter((c:any)=>c.type==='UPSERT_JOB'),{batchId:source.batchId},{$transaction:async(fn:any)=>fn({job:{upsert:async(a:any)=>{projections.push(a.create);}},crawlObservation:{create:async()=>{throw Error('UNREQUESTED_OBSERVATION');}}})} as any);
 const model=Prisma.dmmf.datamodel.models.find(m=>m.name==='CrawlBatchSourceResult')!;
 const row=Object.fromEntries(model.fields.filter(f=>f.kind!=='object').map(f=>[f.name,(packet.commit.sourceResult as any)[f.name]??null]));
 const tuple={releaseCandidateId:f.input.publication.control.candidate.id,batchId:source.batchId,sourceId:source.plan.source.id,sourceResultId:source.pending.id};
 const relay=readFileSync(resolve('vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts'),'utf8');
 const marker='async readAndVerifyOwnedViatrisOutcome(';if(relay.split(marker).length!==2)throw Error('ORIGINAL_VIATRIS_METHOD_REQUIRED');
 const section=relay.slice(relay.indexOf(marker)).split('\n  }\n',1)[0]!,a=section.indexOf('const literal='),b=section.indexOf('const sql=');
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
 const data={kind:'SYNTHETIC_ORIGINAL_SCHEMA50_VIATRIS_COMPILER_FIXTURE',syntheticFixtureOptions:options,syntheticSourceEvidence:source.result.fetchEvidence,context:f.input.publication.control.context,requests,
  model:{sqlSha256:sha(packet.sql),row,batch:{id:source.batchId,releaseCandidateId:tuple.releaseCandidateId,status:'SUCCESS',atomicCommittedCount:1,completenessVerifiedCount:1},holderId:'',projections},
  ax:JSON.parse(readFileSync(resolve('public-verification/test/observed-ax-grammar.json'),'utf8').replaceAll('company-takeda-china','company-viatris').replaceAll('武田中国','晖致中国').replaceAll('武田','晖致').replaceAll('E5','B6')).samples};
 if(source.plan.source.id!=='source-viatris-social'||source.plan.company.id!=='company-viatris'||source.pending.sourceConfigHash!=='5eab6bd8ba6973176376f492b9ce2105d81d8cae5afd4d3518daa6ad3dfcdad9'||projections.length!==options.count||projections.some(p=>p.sourceId!=='source-viatris-social'||p.companyId!=='company-viatris'))throw Error('SYNTHETIC_VIATRIS_NATIVE_SCOPE');
 // count:0 deliberately reaches the original failing Tupu adapter before this
 // line; no empty success packet or invented completeness certificate exists.
 writeFileSync(target,JSON.stringify(data),{flag:'wx',mode:0o600});console.log(JSON.stringify({kind:data.kind,bytes:readFileSync(target).length,modelFields:Object.keys(row).length,realDatabaseCalls:0,networkCalls:0}));
}finally{console.error(JSON.stringify({retainedSyntheticArchiveDirectories:dirs,deletedEvidence:false}));}
