// Fixed stable activation outer. Original helper keeps its original source,
// remote fact, render, exact-16 registration and freshness checks.
const ACTIVATION_LIFECYCLE=__FIXED_LIFECYCLE_BINDING__;
const activationDigest=new Function(__FIXED_SHA256_SOURCE__+'\nreturn responseDigest;')();
const activationRows=new Function(__FIXED_ROWS_SOURCE__+'\nreturn rows;')();
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
