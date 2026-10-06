import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noLinks } from './runtime/preflight/preflight-launch.mjs';
import { packArchiveTransfer,unpackArchiveTransfer } from './archive-transfer.mjs';
const root=resolve(fileURLToPath(new URL('.',import.meta.url)))+'/';
const sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const scoped=(p:string)=>{const full=resolve(p);if(!full.startsWith(root))throw Error('HOST_PATH_SCOPE');return full;};
const [op,pathArg,arg,...extra]=process.argv.slice(2);
if(extra.length||typeof pathArg!=='string')throw Error('HOST_ARGUMENTS');
await noLinks(scoped(pathArg));
if(['prepare-archive-upload','restore-transfer'].includes(op)){if(typeof arg!=='string')throw Error('HOST_ARGUMENTS');await noLinks(scoped(arg));}
if(['pending','publish'].includes(op)&&arg!==undefined)throw Error('HOST_ARGUMENTS');
if(op==='read'){
 const path=scoped(pathArg);if((await lstat(path)).isSymbolicLink())throw Error('HOST_SYMLINK');
 const bytes=await readFile(path),text=bytes.toString('utf8'),offset=Number(arg??0);
 if(!Number.isInteger(offset)||offset<0)throw Error('HOST_OFFSET');
 console.log(JSON.stringify({sha256:sha(bytes),byteCount:bytes.length,charCount:text.length,offset,text:text.slice(offset,offset+100000),next:offset+100000<text.length?offset+100000:null}));
}else if(op==='pending'){
 const { compileCloudPilotCreatePendingSql }=await import('/workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/producer42/src/db/cloudPilotSqlControl.ts');
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
