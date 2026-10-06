import {readFile,writeFile,readdir,lstat,link,unlink} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const PROJECT='yiopvxysxrtrnvqxwgbx';
const kinds=new Set(['LEASE_ACQUIRE','LEASE_RENEW','LEASE_RELEASE','CREATE_PENDING','READ_CONTEXT','READ_PUBLICATION_CONTEXT','ARCHIVE_STORE','PUBLISH','READ_OUTCOME']);
const sha=x=>createHash('sha256').update(x).digest('hex');
async function readRequest(file){
 if((await lstat(file)).isSymbolicLink())throw Error('REQUEST_SYMLINK');
 const r=JSON.parse(await readFile(file,'utf8'));
 if(Object.keys(r).sort().join(',')!=='expiresAt,kind,payload,requestId,requestSha256,schemaVersion'||r.schemaVersion!==1||!kinds.has(r.kind)||
 !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(r.requestId)||basename(file)!==r.requestId+'.request.json')throw Error('REQUEST_SHAPE');
 const {requestSha256,...body}=r;if(sha(JSON.stringify(body))!==requestSha256)throw Error('REQUEST_HASH');
 if(r.kind!=='ARCHIVE_STORE'&&r.payload.projectId!==PROJECT)throw Error('REQUEST_PROJECT');
 if(!Number.isFinite(Date.parse(r.expiresAt)))throw Error('REQUEST_EXPIRY');
 return r;
}
async function writeResponse(dir,r,result){
 const text=JSON.stringify({schemaVersion:1,requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind,result});
 const temp=join(dir,r.requestId+'.response-'+randomUUID()+'.tmp'),dest=join(dir,r.requestId+'.response.json');
 await writeFile(temp,text,{flag:'wx',mode:0o600});
 try{await link(temp,dest);}finally{await unlink(temp);}
}
async function settleExpiredReviewHold(dir,r){
 // Called only after original expiry and a validated MAY_HAVE_BEEN_SENT marker.
 // A hold never establishes no-write, authorizes replay, or changes a deadline.
 if(r.kind!=='PUBLISH')return false;
 const file=join(dir,r.requestId+'.review-hold.json');
 let stat;try{stat=await lstat(file);}catch(error){if(error.code==='ENOENT')return false;throw error;}
 if(stat.isSymbolicLink()||!stat.isFile())throw Error('REVIEW_HOLD_FILE');
 const h=JSON.parse(await readFile(file,'utf8'));
 if(!h||Object.keys(h).sort().join(',')!=='classification,dispatchBefore,expiresAt,kind,noWriteEstablished,outcome,projectId,recordedAt,requestId,requestSha256,retryAuthorized,schemaVersion'||
  h.schemaVersion!==1||h.classification!=='PLATFORM_RISK_REVIEW_HOLD'||h.requestId!==r.requestId||h.requestSha256!==r.requestSha256||h.kind!==r.kind||
  h.projectId!==r.payload.projectId||h.dispatchBefore!==r.payload.dispatchBefore||h.expiresAt!==r.expiresAt||h.outcome!=='UNKNOWN'||h.noWriteEstablished!==false||h.retryAuthorized!==false||
  !Number.isFinite(Date.parse(h.recordedAt)))throw Error('REVIEW_HOLD_BINDING');
 try{await writeResponse(dir,r,{status:'FAILED',outcome:'UNKNOWN',code:'UNKNOWN'});}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  // An owner success may win this race. Preserve it byte-for-byte; never replace
  // any response. Conversely, a late owner success cannot replace expiry UNKNOWN.
  const existing=JSON.parse(await readFile(join(dir,r.requestId+'.response.json'),'utf8'));
  if(existing.schemaVersion!==1||existing.requestId!==r.requestId||existing.requestSha256!==r.requestSha256||existing.kind!==r.kind)throw Error('RESPONSE_ALREADY_EXISTS');
 }
 return true;
}
const [command,directory,arg,expectedRequestSha256]=process.argv.slice(2);const dir=resolve(directory??'');
if(!dir.startsWith('/workspace/scratch/5e9614251709/jb-workspace-recovery-20261006T1136Z/hosts-next/astellas/host/'))throw Error('RELAY_DIRECTORY_OUTSIDE_TASK');
if(command==='next'||command==='next-meta'){
 const names=await readdir(dir),rows=[];
 for(const name of names.filter(n=>n.endsWith('.request.json')).sort()){
  const r=await readRequest(join(dir,name));
  if(names.includes(r.requestId+'.response.json'))continue;
  rows.push({...command==='next-meta'?{requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind}:r,expired:Date.now()>=Date.parse(r.expiresAt),dispatchRecorded:names.includes(r.requestId+'.dispatch.json')});
 }
 console.log(JSON.stringify(rows));
}else if(command==='mark-dispatch'){
 const r=await readRequest(join(dir,arg+'.request.json'));
 if(!/^[a-f0-9]{64}$/.test(expectedRequestSha256??'')||r.requestSha256!==expectedRequestSha256)throw Error('REQUEST_REVIEW_HASH');
 if(Date.now()>=Date.parse(r.expiresAt)||r.payload.dispatchBefore&&Date.now()>=Date.parse(r.payload.dispatchBefore))throw Error('REQUEST_EXPIRED');
 await writeFile(join(dir,arg+'.dispatch.json'),JSON.stringify({schemaVersion:1,requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind,state:'MAY_HAVE_BEEN_SENT',markedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({marked:true,requestId:r.requestId}));
}else if(command==='expire-undispatched'){
 const r=await readRequest(join(dir,arg+'.request.json'));
 if(!/^[a-f0-9]{64}$/.test(expectedRequestSha256??'')||r.requestSha256!==expectedRequestSha256)throw Error('REQUEST_REVIEW_HASH');
 if(Date.now()<Date.parse(r.expiresAt))throw Error('REQUEST_NOT_EXPIRED');
 const markerPath=join(dir,r.requestId+'.dispatch.json');
 // Claim the SAME exclusive marker as mark-dispatch. Even a sender that passed
 // its time check before expiry can no longer dispatch after this wins the race.
 let marker={schemaVersion:1,requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind,state:'NOT_DISPATCHED',markedAt:new Date().toISOString()};
 let reviewHoldPresent=false;
 if(r.kind==='PUBLISH')try{await lstat(join(dir,r.requestId+'.review-hold.json'));reviewHoldPresent=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(reviewHoldPresent){
  // A missing/corrupt dispatch marker beside a hold cannot prove NOT_DISPATCHED.
  if((await lstat(markerPath)).isSymbolicLink())throw Error('DISPATCH_SYMLINK');
  marker=JSON.parse(await readFile(markerPath,'utf8'));
 }else{
  try{await writeFile(markerPath,JSON.stringify(marker),{flag:'wx',mode:0o600});}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   if((await lstat(markerPath)).isSymbolicLink())throw Error('DISPATCH_SYMLINK');
   marker=JSON.parse(await readFile(markerPath,'utf8'));
  }
 }
 if(marker.schemaVersion!==1||marker.requestId!==r.requestId||marker.requestSha256!==r.requestSha256||marker.kind!==r.kind||!['NOT_DISPATCHED','MAY_HAVE_BEEN_SENT'].includes(marker.state))throw Error('DISPATCH_BINDING');
 if(reviewHoldPresent&&marker.state!=='MAY_HAVE_BEEN_SENT')throw Error('REVIEW_HOLD_DISPATCH_BINDING');
 if(marker.state==='MAY_HAVE_BEEN_SENT'){
  if(await settleExpiredReviewHold(dir,r))console.log(JSON.stringify({settled:true,reason:'REVIEW_HOLD_EXPIRED',requestId:r.requestId}));
  else console.log(JSON.stringify({settled:false,reason:'DISPATCH_UNCERTAIN',requestId:r.requestId}));
 }else{
  const result={status:'FAILED',outcome:'NOT_DISPATCHED',code:'REQUEST_EXPIRED'};
  try{await writeResponse(dir,r,result);}catch(error){
   if(error.code!=='EEXIST')throw error;
   const existing=JSON.parse(await readFile(join(dir,r.requestId+'.response.json'),'utf8'));
   if(existing.schemaVersion!==1||existing.requestId!==r.requestId||existing.requestSha256!==r.requestSha256||existing.kind!==r.kind||JSON.stringify(existing.result)!==JSON.stringify(result))throw Error('RESPONSE_ALREADY_EXISTS');
  }
  console.log(JSON.stringify({settled:true,requestId:r.requestId}));
 }
}else if(command==='respond'){
 const input=JSON.parse(await readFile(arg,'utf8'));const r=await readRequest(join(dir,input.requestId+'.request.json'));
 if(input.requestSha256!==r.requestSha256)throw Error('RESPONSE_HASH');
 const dest=join(dir,r.requestId+'.response.json');
 try{await lstat(dest);throw Error('RESPONSE_ALREADY_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
 await writeResponse(dir,r,input.result);
 console.log(JSON.stringify({written:true,requestId:r.requestId,kind:r.kind}));
}else throw Error('UNKNOWN_LOCAL_FILE_COMMAND');
