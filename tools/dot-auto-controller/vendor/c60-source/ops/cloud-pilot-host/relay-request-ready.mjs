/** FilePilotRelay publication barrier. A final name alone is never consumable. */
import fs from 'node:fs';
import {open,link,unlink,lstat} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
const UUID='[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
const finalName=new RegExp('^('+UUID+')\\.request\\.json$');
const readyName=new RegExp('^('+UUID+')\\.request\\.ready$');
export function requestReadyPath(file){const m=finalName.exec(basename(file));if(!m)throw Error('REQUEST_READY_NAME');return join(dirname(file),m[1]+'.request.ready');}
/** Includes orphan markers deliberately: the subsequent final read must reject. */
export function readyRequestNames(names){return names.filter(n=>n.endsWith('.request.ready')).sort().map(n=>{const m=readyName.exec(n);if(!m)throw Error('REQUEST_READY_NAME');return m[1]+'.request.json';});}
const identity=s=>[s.dev,s.ino,s.uid,s.gid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
export function assertRelayRequestReady(file){
 const marker=requestReadyPath(file);let fd;
 const valid=s=>s.isFile()&&!s.isSymbolicLink()&&Number(s.uid)===process.getuid()&&(s.mode&0o7777n)===0o600n&&s.nlink===1n&&s.size===0n;
 try{const before=fs.lstatSync(marker,{bigint:true});if(!valid(before))throw Error('REQUEST_READY_FILE');
  fd=fs.openSync(marker,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const opened=fs.fstatSync(fd,{bigint:true});if(!valid(opened)||identity(before)!==identity(opened))throw Error('REQUEST_READY_CHANGED');
  if(fs.readSync(fd,Buffer.alloc(1),0,1,null)!==0)throw Error('REQUEST_READY_CONTENT');
  const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(marker,{bigint:true});if(!valid(after)||!valid(named)||identity(opened)!==identity(after)||identity(after)!==identity(named))throw Error('REQUEST_READY_CHANGED');
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
async function absent(file){try{await lstat(file);}catch(e){if(e.code==='ENOENT')return;throw e;}const e=new Error('REQUEST_PUBLICATION_EXISTS');e.code='EEXIST';throw e;}
async function syncFile(file,flags){const fd=await open(file,flags);try{await fd.sync();}finally{await fd.close();}}
/** No failure cleanup: interrupted publication remains auditable and unreplayable. */
export async function publishRelayRequest(file,text,{deadline,dispatchBefore,signal}={}){
 const ready=requestReadyPath(file),temp=file.replace(/\.request\.json$/,'.request-publishing-'+randomUUID()+'.tmp');
 const check=()=>{signal?.throwIfAborted();if(!Number.isFinite(deadline)||Date.now()>=deadline)throw Error('RELAY_DEADLINE');if(dispatchBefore!==undefined&&(!Number.isFinite(dispatchBefore)||Date.now()>=dispatchBefore))throw Error('RELAY_DISPATCH_BUDGET');};
 check();await absent(ready);await absent(file);
 const fd=await open(temp,'wx',0o600);let original;
 try{await fd.writeFile(text);await fd.sync();original=await fd.stat();}finally{await fd.close();}
 check();await absent(ready);await link(temp,file);await unlink(temp);
 const final=await lstat(file);if(!final.isFile()||final.isSymbolicLink()||final.uid!==process.getuid()||(final.mode&0o7777)!==0o600||final.nlink!==1||final.ino!==original.ino||final.dev!==original.dev||final.size!==original.size)throw Error('REQUEST_PUBLICATION_CHANGED');
 await syncFile(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);await syncFile(dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 check();const marker=await open(ready,'wx',0o600);try{await marker.sync();}finally{await marker.close();}
 await syncFile(dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
 assertRelayRequestReady(file);
}
