// Fixed stable activation outer. Original helper keeps its original source,
// remote fact, render, exact-16 registration and freshness checks.
const ACTIVATION_LIFECYCLE=null;
const activationDigest=new Function("function responseDigest(text){\n const bytes=unescape(encodeURIComponent(text)),length=bytes.length;\n const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];\n const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],words=[];\n for(let i=0;i<length;i++)words[i>>>2]=(words[i>>>2]??0)|(bytes.charCodeAt(i)<<((3-(i&3))*8));\n words[length>>>2]=(words[length>>>2]??0)|(0x80<<((3-(length&3))*8));\n const blocks=Math.ceil((length+9)/64);words[blocks*16-2]=Math.floor(length/0x20000000);words[blocks*16-1]=(length*8)>>>0;\n const rotr=(x,n)=>(x>>>n)|(x<<(32-n));\n for(let block=0;block<blocks;block++){\n  const w=Array.from({length:64},(_,i)=>words[block*16+i]??0);\n  for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=((rotr(a,7)^rotr(a,18)^(a>>>3))+w[i-16]+(rotr(b,17)^rotr(b,19)^(b>>>10))+w[i-7])|0;}\n  let [a,b,c,d,e,f,g,h]=H;\n  for(let i=0;i<64;i++){const t1=(h+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[i]+w[i])|0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))|0;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}\n  [a,b,c,d,e,f,g,h].forEach((x,i)=>H[i]=(H[i]+x)|0);\n }\n return {sha256:H.map(x=>(x>>>0).toString(16).padStart(8,\"0\")).join(\"\"),byteCount:length,charCount:text.length};\n}\n"+'\nreturn responseDigest;')();
const activationRows=new Function("function rows(result){if(result.isError)throw Error(\"HOST_SQL_TOOL_ERROR:\"+JSON.stringify(result));const t=result.structuredContent?.result??JSON.parse(result.content.find(x=>x.type===\"text\").text).result; if(typeof t!==\"string\")throw Error(\"HOST_SQL_RESULT_SHAPE\");const m=t.match(/\\n<untrusted-data-[^>]+>\\n([\\s\\S]*?)\\n<\\/untrusted-data-/);if(!m)throw Error(\"HOST_SQL_ROWS_MISSING\");const r=JSON.parse(m[1]);if(!Array.isArray(r))throw Error(\"HOST_SQL_ROWS_INVALID\");return r;}"+'\nreturn rows;')();
const activationRequire=(ok,code)=>{if(!ok)throw Error(code);};
const activationQuote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const activationTools=Object.freeze({exec_command:tools.exec_command,write_stdin:tools.write_stdin,mcp__codex_apps__supabase_execute_sql:tools.mcp__codex_apps__supabase_execute_sql});
const activationRowKeys=['id','goalId','version','commitSha','migrationVersion','schemaHash','dbSnapshotHash','rosterHash','sourcePlanHash','sourceConfigHash','adapterBundleHash','sourceTreeHash','runtimeTreeHash','oracleVersion','minimumStableCompanyCount','status'];
const activationCanonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(activationCanonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+activationCanonical(x[k])).join(',')+'}';
function activationBindingValid(b){
 if(!b||b.schemaVersion!==1)return false;
 const {bindingSha256,...rest}=b,d=b.deployment,row=d?.expectedRow;
 return activationDigest(activationCanonical(rest)).sha256===bindingSha256&&d?.kind==='LIVE_DEPLOYMENT'&&d.fixturePreloadSha256===null&&d.projectId==='yiopvxysxrtrnvqxwgbx'&&d.sourceId==='source-takeda-china-social'&&row&&Object.keys(row).sort().join(',')===activationRowKeys.slice().sort().join(',')&&row.commitSha===d.build.commitSha&&row.commitSha===b.remoteCommit.commitSha&&b.remoteCommit.kind==='OFFICIAL_GITHUB_COMMIT_READ'&&b.enabledEntryBytes===b.disabledEntryBytes-1&&['sourceManifestSha256','canonicalDefaultSha256','builderSha256','deploymentSha256','cliSha256','disabledEntrySha256','enabledEntrySha256','bindingSha256'].every(k=>/^[a-f0-9]{64}$/.test(b[k]));
}
let activationAttempted=false;
async function activateFixedDeployment(){
 activationRequire(arguments.length===0,'ACTIVATION_NO_ARGUMENTS');
 if(ACTIVATION_LIFECYCLE===null)return {status:'DISABLED',reason:'LIFECYCLE_ACTIVATION_UNQUALIFIED',artifactWrites:0};
 activationRequire(!activationAttempted,'ACTIVATION_ALREADY_ATTEMPTED');activationAttempted=true;
 const b=ACTIVATION_LIFECYCLE,d=b.deploymentBinding;
 activationRequire(activationBindingValid(d),'ACTIVATION_FIXED_BINDING');
 let session=null,serial=0,buffer='',ended=false,committed=false;
 const absorb=r=>{activationRequire(r&&typeof r.output==='string','EXCLUSIVE_TOOL_SHAPE');if(r.session_id!==undefined)activationRequire(r.session_id===session,'EXCLUSIVE_FOREIGN_SESSION');buffer+=r.output.replaceAll('\r\n','\n');activationRequire(buffer.length<=1024*1024,'EXCLUSIVE_OUTPUT_SIZE');if(r.exit_code!==undefined)ended=true;const at=buffer.indexOf('\n');if(at<0)return null;const v=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);activationRequire(v.kind!=='EXCLUSIVE_HOLD','EXCLUSIVE_HOLDER_HOLD');return v;};
 const exchange=async(op,payload,kind,allowExit=false)=>{
  activationRequire(session!==null&&!ended,'EXCLUSIVE_HOLDER_LOST');const current=++serial;
  let r=await activationTools.write_stdin({session_id:session,chars:JSON.stringify({op,serial:current,payload})+'\n',yield_time_ms:1000,max_output_tokens:20000}),v=absorb(r);
  while(v===null&&!ended){r=await activationTools.write_stdin({session_id:session,chars:'',yield_time_ms:1000,max_output_tokens:20000});v=absorb(r);}
  activationRequire(v&&v.kind===kind&&v.serial===current,'EXCLUSIVE_RESPONSE_BINDING');activationRequire(allowExit||!ended,'EXCLUSIVE_HOLDER_LOST');
  if(allowExit&&ended&&op==='finish')activationRequire(r.exit_code===0,'EXCLUSIVE_FINISH_EXIT');return v;
 };
 try{
  const code="import hashlib,os,stat,sys\np="+JSON.stringify(b.holderPath)+"\nfd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)\ns=os.fstat(fd)\nassert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and not s.st_mode&0o022\nwith os.fdopen(fd,'rb') as f:raw=f.read()\nassert hashlib.sha256(raw).hexdigest()=="+JSON.stringify(b.holderSha256)+"\nexec(compile(raw,p,'exec'),{'__name__':'__main__','__file__':p})";
  const first=await activationTools.exec_command({cmd:'/usr/bin/python3 -I -u -c '+activationQuote(code),workdir:b.stableDirectory,tty:true,yield_time_ms:1000,max_output_tokens:20000});
  activationRequire(Number.isSafeInteger(first.session_id)&&first.exit_code===undefined,'EXCLUSIVE_ORIGINAL_SESSION');session=first.session_id;
  let ready=absorb(first);while(ready===null&&!ended)ready=absorb(await activationTools.write_stdin({session_id:session,chars:'',yield_time_ms:1000,max_output_tokens:20000}));
  activationRequire(!ended&&ready?.kind==='EXCLUSIVE_READY'&&ready.serial===0,'EXCLUSIVE_READY');
  const q=(await exchange('qualify',null,'EXCLUSIVE_RESULT')).result;
  activationRequire(q.kind==='FIXED_ACTIVATION_QUALIFIED'&&q.bindingSha256===d.bindingSha256&&q.disabledSha256===d.disabledEntrySha256&&q.enabledSha256===d.enabledEntrySha256&&q.enabledBytes===d.enabledEntryBytes,'ACTIVATION_QUALIFICATION_RECEIPT');
  // The same EX holder remains live through this original external await.
  const originalRegistrationPromise=activationTools.mcp__codex_apps__supabase_execute_sql({project_id:d.deployment.projectId,query:b.registrationSql});
  activationRequire(originalRegistrationPromise instanceof Promise,'ACTIVATION_ORIGINAL_PROMISE');
  const raw=await originalRegistrationPromise;activationRequire(raw&&raw.isError!==true,'ACTIVATION_REGISTRATION_TOOL_ERROR');
  const observed=activationRows(raw),expected=d.deployment.expectedRow;
  activationRequire(observed.length===1&&observed[0].candidate&&Object.keys(expected).every(k=>Object.hasOwn(observed[0].candidate,k)&&observed[0].candidate[k]===expected[k]),'ACTIVATION_REGISTRATION_16');
  const checkedAt=observed[0].checkedAt,at=Date.parse(checkedAt);activationRequire(typeof checkedAt==='string'&&Number.isFinite(at)&&Date.now()>=at&&Date.now()-at<60000,'ACTIVATION_REGISTRATION_AGE');
  const rawBytes=JSON.stringify(raw),rawSha256=activationDigest(rawBytes).sha256;
  const result=(await exchange('commit',{schemaVersion:1,rawBytes,rawSha256,checkedAt},'EXCLUSIVE_RESULT')).result;
  activationRequire(result.kind==='FIXED_DEPLOYMENT_ACTIVATED'&&result.disabledSha256===d.disabledEntrySha256&&result.enabledSha256===d.enabledEntrySha256&&result.enabledBytes===d.enabledEntryBytes&&result.rawSha256===rawSha256&&result.checkedAt===checkedAt&&result.onlyActivationBooleanChanged===true,'ACTIVATION_WRITE_RECEIPT');
  await exchange('finish',null,'EXCLUSIVE_FINISHED',true);
  while(!ended){const r=await activationTools.write_stdin({session_id:session,chars:'',yield_time_ms:1000,max_output_tokens:20000});absorb(r);if(ended)activationRequire(r.exit_code===0,'EXCLUSIVE_FINISH_EXIT');}
  committed=true;return {...result,originalPromiseRetained:true,lifecycleExclusiveTransaction:true,productionAuthority:false};
 }finally{
  if(session!==null&&!ended&&!committed){try{await exchange('abandon',null,'EXCLUSIVE_UNKNOWN',true);}catch{}}
 }
}
return Object.freeze({activateFixedDeployment});
