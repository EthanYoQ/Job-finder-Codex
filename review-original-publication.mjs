import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const B='/workspace/scratch/5e9614251709',R=B+'/takeda-original-recovery-20261017T0417Z',V=B+'/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source';
const [run,id,relay,contextRequestId,phase]=process.argv.slice(2),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
fs.mkdirSync(run+'/relay',{recursive:true});fs.mkdirSync(run+'/review',{recursive:true});
const request=read(relay+'/'+id+'.request.json');fs.copyFileSync(relay+'/'+id+'.request.json',run+'/relay/'+id+'.request.json');const sqlPath=run+'/relay/'+id+'.request.json.sql';if(fs.existsSync(sqlPath))assert.equal(fs.readFileSync(sqlPath,'utf8'),request.payload.sql);else fs.writeFileSync(sqlPath,request.payload.sql,{flag:'wx'});
const starts=fs.readFileSync(run+'/diagnostics/process.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(x=>x.event==='WRAPPER_START');assert.equal(starts.length,1);
const source=request.payload.sourceId??JSON.parse(fs.readFileSync(path.dirname(run)+'/host-config.json','utf8')).sourceId;
const special={'source-biogen-china-social':['biogen-packet-gate.mts','reviewBiogenPacket'],'source-hengrui-social':['hengrui-packet-gate.mts','reviewHengruiPacket']}[source];
// Run heavy packet/readers in a completed process before raw replay loads its modules.
if(phase!=='packet-only'){
 const loader=V+'/node_modules/tsx/dist/loader.mjs';
 const commands=[['--import',loader,process.argv[1],run,id,relay,contextRequestId,'packet-only'],...(special?[]:[['--import',loader,R+'/offline-checkers/replay-original-json-archive.mts',run]]),['--import',loader,R+'/offline-checkers/project-original-target-api.mts',run]];
 for(const args of commands){
 const timeout=Math.min(Date.parse(request.payload.dispatchBefore),Date.parse(request.expiresAt),starts[0].outerDeadline)-Date.now();assert(timeout>0,'ORIGINAL_REVIEW_DEADLINE');
  execFileSync(process.execPath,args,{stdio:['ignore','ignore','pipe'],timeout});
 }
}else{
 process.chdir(V);
const [file,fn]=special??['original-portable-sql-review.mts','reviewOriginalPortableSql'];const review=(await import(R+'/offline-checkers/'+file))[fn];
// Reuse the exact original publication read, whose server digest is bound into this packet.
const {decodeDeclarations}=await import(V+'/../../native/review-packet-envelope.mts');
const declaration=/DECLARE affected bigint; job_data jsonb; ([\s\S]*?) current_context jsonb;/.exec(request.payload.sql);assert(declaration);
const expectedContext=decodeDeclarations(declaration[1]).context;
let publicationContext;
if(expectedContext.snapshotSha256){
 assert(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(contextRequestId??''),'ORIGINAL_PUBLICATION_CONTEXT_REQUEST_ID_REQUIRED');
 const response=read(relay+'/'+contextRequestId+'.response.json'),readRequest=read(relay+'/'+contextRequestId+'.request.json');
 assert.equal(readRequest.requestId,contextRequestId);assert.equal(response.requestId,contextRequestId);
 assert.equal(readRequest.kind,'READ_PUBLICATION_CONTEXT');assert.equal(response.kind,'READ_PUBLICATION_CONTEXT');assert.equal(response.result?.status,'SUCCEEDED');
 assert.equal(readRequest.requestSha256,response.requestSha256);assert.equal(readRequest.payload.projectId,request.payload.projectId);
 assert.equal(response.result.rows?.[0]?.context?.snapshotSha256,expectedContext.snapshotSha256,'ORIGINAL_PUBLICATION_CONTEXT_RESPONSE_REQUIRED');
 publicationContext=response.result.rows[0].context;
}else publicationContext=read(path.dirname(run)+'/READER_BEFORE.json').publicationContext;
const packet=await review(run,id,run+'/review/PACKET_REVIEW.json',{originalOuterDeadline:starts[0].outerDeadline,publicationContext});
const {replayOriginalPortableReaders}=await import(R+'/offline-checkers/original-portable-reader-replay.mts');
await replayOriginalPortableReaders({run,outputDirectory:run+'/review',before:read(path.dirname(run)+'/READER_BEFORE.json'),packet});
}
console.log(JSON.stringify({requestId:id,requestSha256:request.requestSha256}));
