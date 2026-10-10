import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadBinding, verifyBinding, taskFile, readChecked, HOST_ROOT, PRODUCER_ROOT, RELAY_ROOT, TASK_ROOT, SOURCE, SOURCE_HASH, MODE } from './connector-host-binding.mjs';
import { packArchiveTransfer,unpackArchiveTransfer } from './archive-transfer.mjs';
const root=resolve(fileURLToPath(new URL('.',import.meta.url)))+'/';
const sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const scoped=(p:string)=>{const full=resolve(p);if(!full.startsWith(root))throw Error('HOST_PATH_SCOPE');return full;};
const [op,pathArg,arg]=process.argv.slice(2);
if(op?.startsWith('connector-')){
 const cfg=loadBinding();
 const request=()=>{
  const path=taskFile(pathArg),r=JSON.parse(readChecked(path).bytes.toString('utf8'));
  const {requestSha256,...body}=r;
  if(r.schemaVersion!==1||Object.keys(r).sort().join(',')!=='expiresAt,kind,payload,requestId,requestSha256,schemaVersion'||sha(JSON.stringify(body))!==requestSha256||path!==RELAY_ROOT+'/'+r.requestId+'.request.json'||r.payload?.projectId!==cfg.projectId||!Number.isFinite(Date.parse(r.expiresAt)))throw Error('HOST_REQUEST_BINDING');
  return {path,r};
 };
 if(op==='connector-read'){
  const bytes=readChecked(taskFile(pathArg)).bytes,text=bytes.toString('utf8'),offset=Number(arg??0);
  if(!Number.isInteger(offset)||offset<0)throw Error('HOST_OFFSET');
  console.log(JSON.stringify({sha256:sha(bytes),byteCount:bytes.length,charCount:text.length,offset,text:text.slice(offset,offset+100000),next:offset+100000<text.length?offset+100000:null}));
 }else if(['connector-save-part','connector-save-assemble','connector-save-finalize'].includes(op)){
  const dest=taskFile(pathArg);if(!dest.endsWith('.host-result.json'))throw Error('HOST_SAVE_SCOPE');
  const requestPath=dest.replace(/\.host-result\.json$/,'.request.json'),r=JSON.parse(readChecked(requestPath).bytes.toString('utf8')),{requestSha256,...body}=r;
  if(r.schemaVersion!==1||sha(JSON.stringify(body))!==requestSha256||requestPath!==RELAY_ROOT+'/'+r.requestId+'.request.json'||r.payload?.projectId!==cfg.projectId)throw Error('HOST_RESPONSE_BINDING');
  const data=JSON.parse(arg??''),metaKeys=['requestSha256','sha256','byteCount','charCount','count'],keys=(v:any,expected:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===expected.sort().join(',');
  const valid=(v:any,part=false)=>keys(v,part?[...metaKeys,'index','text']:metaKeys)&&v.requestSha256===requestSha256&&/^[a-f0-9]{64}$/.test(v.sha256??'')&&Number.isSafeInteger(v.byteCount)&&v.byteCount>0&&v.byteCount<=16*1024*1024&&Number.isSafeInteger(v.charCount)&&v.charCount>0&&v.charCount<=v.byteCount&&Number.isSafeInteger(v.count)&&v.count===Math.ceil(v.charCount/16000)&&v.count<=2048;
  const partPath=(index:number)=>taskFile(dest.replace(/\.json$/,'.part-'+String(index).padStart(6,'0')+'.json'));
  const ready=taskFile(dest.replace(/\.json$/,'.ready.json'));
  const sameMeta=(a:any,b:any)=>metaKeys.every(k=>a[k]===b[k]);
  const requirePart=(index:number,expected:any)=>{
   const part=JSON.parse(readChecked(partPath(index),{max:256000}).bytes.toString('utf8'));
   if(!valid(part,true)||part.index!==index||!sameMeta(part,expected)||typeof part.text!=='string'||part.text.length!==Math.min(16000,part.charCount-index*16000))throw Error('HOST_RESPONSE_PART');return part;
  };
  const validateComplete=(bytes:Buffer,expected:any)=>{
   const text=bytes.toString('utf8'),packet=JSON.parse(text);
   if(bytes.length!==expected.byteCount||text.length!==expected.charCount||sha(bytes)!==expected.sha256||packet.requestId!==r.requestId||packet.requestSha256!==requestSha256||!keys(packet,Object.hasOwn(packet,'diagnostic')?['requestId','requestSha256','result','diagnostic']:['requestId','requestSha256','result']))throw Error('HOST_RESPONSE_HASH');
  };
  if(op==='connector-save-part'){
   if(!valid(data,true)||!Number.isSafeInteger(data.index)||data.index<0||data.index>=data.count||typeof data.text!=='string'||data.text.length!==Math.min(16000,data.charCount-data.index*16000))throw Error('HOST_RESPONSE_PART');
   if(data.index>0)requirePart(data.index-1,data);
   for(const p of [ready,dest]){try{await lstat(p);throw Error('HOST_RESPONSE_ALREADY_SEALED');}catch(e:any){if(e.code!=='ENOENT')throw e;}}
   await writeFile(partPath(data.index),JSON.stringify(data),{flag:'wx',mode:0o600});console.log(JSON.stringify({stored:true,index:data.index}));
  }else{
   if(!valid(data))throw Error('HOST_RESPONSE_BINDING');
   if(op==='connector-save-assemble'){
    const parts=[];for(let index=0;index<data.count;index++)parts.push(requirePart(index,data).text);
    const bytes=Buffer.from(parts.join(''),'utf8');validateComplete(bytes,data);await writeFile(ready,bytes,{flag:'wx',mode:0o600});
   }else{
    const bytes=readChecked(ready).bytes;validateComplete(bytes,data);await writeFile(dest,bytes,{flag:'wx',mode:0o600});
   }
   console.log(JSON.stringify({sha256:data.sha256,byteCount:data.byteCount}));
  }
 }else{
  verifyBinding();
  if(op==='connector-validate')console.log(JSON.stringify({mode:MODE,root:HOST_ROOT,repo:PRODUCER_ROOT,relayDirectory:RELAY_ROOT,taskRoot:TASK_ROOT,project:cfg.projectId,sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256,candidateId:cfg.control.candidate.id,buildContentSha256:cfg.control.build.contentSha256}));
  else if(op==='connector-context'){
   const {r}=request();
   if(!['READ_CONTEXT','READ_PUBLICATION_CONTEXT'].includes(r.kind)||Date.now()>=Date.parse(r.expiresAt)||r.payload.dispatchBefore&&Date.now()>=Date.parse(r.payload.dispatchBefore))throw Error('HOST_CONTEXT_REQUEST');
   if(r.kind==='READ_CONTEXT'&&(r.payload.sourceId!==SOURCE||r.payload.sourceConfigSha256!==SOURCE_HASH||r.payload.purpose!=='PRE_CAPTURE'))throw Error('HOST_CONTEXT_SOURCE_BINDING');
   // Import original modules only after the exact Node/build/dependency checks.
   const {register}=await import(pathToFileURL(PRODUCER_ROOT+'/node_modules/tsx/dist/esm/api/index.mjs').href);register({tsconfig:PRODUCER_ROOT+'/tsconfig.json'});
   const {CLOUD_PILOT_SOURCE,compileCloudPilotPublicationContextSql}=await import(pathToFileURL(PRODUCER_ROOT+'/src/db/cloudPilotSqlControl.ts').href);
   const {SOURCE_QUALITY_POLICY_ID}=await import(pathToFileURL(PRODUCER_ROOT+'/src/crawler/sourceQualityAdmission.ts').href);
   if(CLOUD_PILOT_SOURCE.id!==SOURCE||CLOUD_PILOT_SOURCE.sourceConfigSha256!==SOURCE_HASH||CLOUD_PILOT_SOURCE.ownerId!==cfg.ownerId)throw Error('HOST_SOURCE_MODULE_DRIFT');
   const sql=compileCloudPilotPublicationContextSql(cfg.control,SOURCE_QUALITY_POLICY_ID);
   if(r.kind==='READ_PUBLICATION_CONTEXT'&&sql!==r.payload.sql)throw Error('HOST_CONTEXT_SQL_BINDING');
   console.log(JSON.stringify({sql,sha256:sha(sql),requestId:r.requestId,requestSha256:r.requestSha256,candidateId:cfg.control.candidate.id,buildContentSha256:cfg.control.build.contentSha256}));
  }else if(op==='connector-publish'){
   const {path,r}=request();
   if(r.kind!=='PUBLISH'||typeof r.payload.sql!=='string'||!Number.isFinite(Date.parse(r.payload.dispatchBefore))||Date.parse(r.payload.dispatchBefore)>=Date.parse(r.expiresAt)||Date.now()>=Date.parse(r.payload.dispatchBefore)||Date.now()>=Date.parse(r.expiresAt))throw Error('HOST_PUBLISH_REQUEST');
   const sql=r.payload.sql,output=taskFile(path+'.sql');await writeFile(output,sql,{flag:'wx',mode:0o600});
   console.log(JSON.stringify({output,sha256:sha(sql),bytes:Buffer.byteLength(sql),jobUpserts:(sql.match(/INSERT INTO public\.\"Job\"/g)??[]).length,dispatchBefore:r.payload.dispatchBefore,expiresAt:r.expiresAt,projectId:r.payload.projectId,requestId:r.requestId,requestSha256:r.requestSha256,candidateId:cfg.control.candidate.id,buildContentSha256:cfg.control.build.contentSha256}));
  }else throw Error('HOST_OPERATION');
 }
}else if(op==='read'){
 const path=scoped(pathArg);if((await lstat(path)).isSymbolicLink())throw Error('HOST_SYMLINK');
 const bytes=await readFile(path),text=bytes.toString('utf8'),offset=Number(arg??0);
 if(!Number.isInteger(offset)||offset<0)throw Error('HOST_OFFSET');
 console.log(JSON.stringify({sha256:sha(bytes),byteCount:bytes.length,charCount:text.length,offset,text:text.slice(offset,offset+100000),next:offset+100000<text.length?offset+100000:null}));
}else if(op==='pending'){
 const { compileCloudPilotCreatePendingSql }=await import('/workspace/shared/job-finder-recovery/candidate-investigation/cloud-lilly-active-pilot/src/db/cloudPilotSqlControl.ts');
 const path=scoped(pathArg),r=JSON.parse(await readFile(path,'utf8'));
 const {requestSha256,...body}=r;
 if(r.kind!=='CREATE_PENDING'||sha(JSON.stringify(body))!==requestSha256||Date.now()>=Date.parse(r.expiresAt))throw Error('HOST_PENDING_REQUEST');
 const base=JSON.parse(await readFile(root+'control-base.json','utf8'));
 const input={...base,expiresAt:r.expiresAt,holderId:r.payload.holderId,planned:r.payload.planned};
 const sql=compileCloudPilotCreatePendingSql(input),output=path+'.sql';
 await writeFile(path+'.control.json',JSON.stringify(input),{flag:'wx',mode:0o600});
 await writeFile(output,sql,{flag:'wx',mode:0o600});
 const binding={requestId:r.requestId,requestSha256:r.requestSha256,projectId:base.projectId,candidateId:base.candidate.id,buildContentSha256:base.build.contentSha256,output,sha256:sha(sql),bytes:Buffer.byteLength(sql)};
 await writeFile(path+'.sql-binding.json',JSON.stringify(binding),{flag:'wx',mode:0o600});
 console.log(JSON.stringify(binding));
 }else if(op==='prepare-archive-upload'){
 const {auditNovoPublicArchive}=await import('./audit-novo-public-archive.mjs');
 const path=scoped(pathArg),bytes=await readFile(path),bundle=JSON.parse(bytes.toString('utf8'));
 const expected=JSON.parse(await readFile(scoped(arg),'utf8'));

 const audit=auditNovoPublicArchive(bundle,{expected,sourceConfigSha256:expected.sourceConfigSha256});
 const packed=packArchiveTransfer(bytes),output=path+'.transfer.json';
 await writeFile(output,packed,{flag:'wx',mode:0o600});
 console.log(JSON.stringify({sha256:sha(bytes),bytes:bytes.length,audit,output,packedSha256:sha(packed),packedBytes:packed.length}));
}else if(op==='publish'){
 const path=scoped(pathArg),r=JSON.parse(await readFile(path,'utf8')),{requestSha256,...body}=r;
 if(r.kind!=='PUBLISH'||sha(JSON.stringify(body))!==requestSha256)throw Error('HOST_PUBLISH_REQUEST');
 const sql=r.payload.sql,output=path+'.sql';await writeFile(output,sql,{flag:'wx',mode:0o600});
 console.log(JSON.stringify({output,sha256:sha(sql),bytes:Buffer.byteLength(sql),jobUpserts:(sql.match(/INSERT INTO public\."Job"/g)??[]).length,dispatchBefore:r.payload.dispatchBefore,expiresAt:r.expiresAt,projectId:r.payload.projectId}));
 }else if(op==='restore-transfer'){
 const input=JSON.parse(await readFile(scoped(pathArg),'utf8')),dest=scoped(arg);
 const choices=[input.text,input.text.endsWith('\n')?input.text.slice(0,-1):input.text+'\n'];
 const exact=choices.find(x=>sha(x)===input.expectedPackedSha256);if(exact===undefined)throw Error('HOST_RESTORED_TRANSFER_HASH');
 const bytes=unpackArchiveTransfer(Buffer.from(exact),input.expectedOriginalSha256,input.expectedOriginalByteCount);
 await writeFile(dest,bytes,{flag:'wx',mode:0o600});console.log(JSON.stringify({dest,sha256:sha(bytes),bytes:bytes.length}));
}else throw Error('HOST_OPERATION');
