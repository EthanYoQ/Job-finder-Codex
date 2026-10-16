// No caller inputs or saved PASS files. Fixed original connector Promises stay
// in this closure while the one Python holder owns EX and durable MUTATION.
const INSTALL=__FIXED_INSTALL_BINDING__;
const digest=new Function(__FIXED_SHA256_SOURCE__+'\nreturn responseDigest;')();
const validators=new Function(__FIXED_FACTS_SOURCE__+'\nreturn {requireFact,canonical,fresh,githubFacts,retirementFact,candidateFact};')();
const {requireFact,canonical,fresh,githubFacts,retirementFact,candidateFact}=validators;
const official=Object.freeze({exec:tools.exec_command,stdin:tools.write_stdin,commit:tools.mcp__codex_apps__github_fetch_commit,tree:tools.mcp__codex_apps__github_fetch,sql:tools.mcp__codex_apps__supabase_execute_sql});
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
let attempted=false;
async function installFixedController(){
 requireFact(arguments.length===0,'INSTALL_NO_ARGUMENTS');
 if(INSTALL===null)return {status:'DISABLED',reason:'INSTALL_BINDING_UNQUALIFIED',artifactWrites:0};
 requireFact(!attempted,'INSTALL_ALREADY_ATTEMPTED');attempted=true;
 const b=INSTALL,{bindingSha256,...body}=b;
 requireFact(digest(canonical(body)).sha256===bindingSha256&&b.schemaVersion===1&&b.repo==='EthanYoQ/Job-finder-Codex'&&b.projectId==='yiopvxysxrtrnvqxwgbx'&&/^[a-f0-9]{40}$/.test(b.commitSha)&&/^[a-f0-9]{40}$/.test(b.treeSha),'INSTALL_BINDING');
 requireFact(Object.values(official).every(x=>typeof x==='function'),'INSTALL_OFFICIAL_TOOLS_REQUIRED');
 let session=null,serial=0,buffer='',ended=false,complete=false,nonce=null,sourceComplete=false;
 const absorb=r=>{requireFact(r&&r.isError!==true&&typeof r.output==='string','INSTALL_TOOL_SESSION_SHAPE');if(r.session_id!==undefined)requireFact(r.session_id===session,'INSTALL_FOREIGN_SESSION');buffer+=r.output.replaceAll('\r\n','\n');requireFact(buffer.length<=2*1024*1024,'INSTALL_OUTPUT_BOUND');if(r.exit_code!==undefined)ended=true;const at=buffer.indexOf('\n');if(at<0)return null;const value=JSON.parse(buffer.slice(0,at));buffer=buffer.slice(at+1);requireFact(value.kind!=='INSTALL_HOLD','INSTALL_HOLDER_HOLD');return value;};
 const exchange=async(op,payload,kind,allowExit=false)=>{requireFact(session!==null&&!ended,'INSTALL_HOLDER_LOST');const n=++serial;let r=await official.stdin({session_id:session,chars:JSON.stringify({op,serial:n,payload})+'\n',yield_time_ms:1000,max_output_tokens:20000}),v=absorb(r);while(v===null&&!ended){r=await official.stdin({session_id:session,chars:'',yield_time_ms:1000,max_output_tokens:20000});v=absorb(r);}requireFact(v?.kind===kind&&v.serial===n&&(allowExit||!ended),'INSTALL_RESPONSE_BINDING');if(ended&&allowExit&&op==='finish')requireFact(r.exit_code===0,'INSTALL_FINISH_EXIT');return v;};
 const capture=async(fn,args)=>{const startedAt=new Date().toISOString();const originalPromise=fn(args);requireFact(originalPromise instanceof Promise,'INSTALL_ORIGINAL_PROMISE');const raw=await originalPromise;const finishedAt=new Date().toISOString();requireFact(raw&&raw.isError!==true,'INSTALL_OFFICIAL_TOOL_ERROR');const rawBytes=JSON.stringify(raw);requireFact(rawBytes.length<=2*1024*1024,'INSTALL_RAW_BOUND');return {raw,packet:{rawBytes,rawSha256:digest(rawBytes).sha256,startedAt,finishedAt}};};
 try{
  requireFact(typeof b.holderSource==='string'&&b.holderSource.length>0&&b.holderSource.length<=2*1024*1024&&/^[\x09\x0a\x0d\x20-\x7e]*$/.test(b.holderSource)&&digest(b.holderSource).sha256===b.holderSha256,'INSTALL_EMBEDDED_HOLDER_PIN');
  const sourceBytes=b.holderSource.length;
  const code="import hashlib,json,os,sys,termios\nn="+sourceBytes+"\ndigest="+JSON.stringify(b.holderSha256)+"\nif os.isatty(0):\n a=termios.tcgetattr(0);a[3]&=~(termios.ICANON|termios.ECHO);a[6][termios.VMIN]=1;a[6][termios.VTIME]=0;termios.tcsetattr(0,termios.TCSANOW,a)\nprint(json.dumps({'kind':'INSTALL_SOURCE_READY','serial':0,'sourceBytes':n,'sourceSha256':digest}),flush=True)\nparts=[];left=n\nwhile left:\n part=os.read(0,min(left,65536))\n if not part:raise RuntimeError('INSTALL_SOURCE_EOF')\n parts.append(part);left-=len(part)\nraw=b''.join(parts)\nassert len(raw)==n and hashlib.sha256(raw).hexdigest()==digest\nexec(compile(raw,'<fixed-install-holder>','exec'),{'__name__':'__main__','__file__':'<fixed-install-holder>'})";
  const initial=await official.exec({cmd:'/usr/bin/python3 -I -u -c '+quote(code),workdir:'/workspace/scratch/5e9614251709',tty:true,yield_time_ms:1000,max_output_tokens:20000});requireFact(Number.isSafeInteger(initial.session_id)&&initial.exit_code===undefined,'INSTALL_ORIGINAL_SESSION');session=initial.session_id;
  let sourceReady=absorb(initial);while(sourceReady===null&&!ended)sourceReady=absorb(await official.stdin({session_id:session,chars:'',yield_time_ms:1000,max_output_tokens:20000}));
  requireFact(!ended&&sourceReady?.kind==='INSTALL_SOURCE_READY'&&sourceReady.serial===0&&sourceReady.sourceBytes===sourceBytes&&sourceReady.sourceSha256===b.holderSha256,'INSTALL_SOURCE_READY');
  let ready=null;
  for(let at=0;at<sourceBytes;at+=2048){requireFact(!ended,'INSTALL_SOURCE_HOLDER_LOST');const end=Math.min(at+2048,sourceBytes);const v=absorb(await official.stdin({session_id:session,chars:b.holderSource.slice(at,end),yield_time_ms:1000,max_output_tokens:20000}));requireFact(v===null||end===sourceBytes,'INSTALL_EARLY_SOURCE_EXECUTION');if(v!==null)ready=v;}
  while(ready===null&&!ended)ready=absorb(await official.stdin({session_id:session,chars:'',yield_time_ms:1000,max_output_tokens:20000}));requireFact(!ended&&ready?.kind==='INSTALL_READY'&&ready.serial===0&&typeof ready.nonce==='string'&&/^[a-f0-9-]{36}$/.test(ready.nonce),'INSTALL_READY');nonce=ready.nonce;sourceComplete=true;
  const staged=(await exchange('stage',null,'INSTALL_RESULT')).result;requireFact(staged.kind==='INSTALL_STAGED'&&staged.nonce===nonce,'INSTALL_STAGE_RECEIPT');
  // These four reads are NEW original Promises after all expensive copy/build
  // verification. Never refresh a timestamp on an old response.
  const commit=await capture(official.commit,{repo_full_name:b.repo,commit_sha:b.commitSha});
  const tree=await capture(official.tree,{url:'https://api.github.com/repos/EthanYoQ/Job-finder-Codex/git/commits/'+b.commitSha});
  const retirement=await capture(official.sql,{project_id:b.projectId,query:b.retirementSql});
  const candidate=await capture(official.sql,{project_id:b.projectId,query:b.registrationSql});
  const reader=(await exchange('reader',null,'INSTALL_RESULT')).result;
  requireFact(reader.kind==='INSTALL_READER_VERIFIED'&&reader.nonce===nonce&&reader.identity?.schemaVersion===1&&reader.identity.projectId===b.projectId&&canonical(reader.identity.readers)===canonical(b.readerExpected.readers),'INSTALL_READER_RECEIPT');
  const now=Date.now();githubFacts(commit.raw,tree.raw,b);retirementFact(retirement.raw,b.retiredCandidate,now);candidateFact(candidate.raw,b.expectedRow,now);fresh(reader.identity.checkedAt,now,45000);
  const facts={githubCommit:commit.packet,githubTree:tree.packet,retirement:retirement.packet,candidate:candidate.packet};for(const p of Object.values(facts)){fresh(p.startedAt,now);fresh(p.finishedAt,now);requireFact(Date.parse(p.startedAt)<=Date.parse(p.finishedAt),'INSTALL_CALL_CLOCK');}
  const result=(await exchange('publish',{schemaVersion:1,nonce,facts,readerIdentity:reader.identity},'INSTALL_RESULT')).result;
  requireFact(result.kind==='FIXED_CONTROLLER_INSTALLED_DISABLED'&&result.nonce===nonce&&result.commitSha===b.commitSha&&result.activationEnabled===false,'INSTALL_PUBLICATION_RECEIPT');
  await exchange('finish',null,'INSTALL_FINISHED',true);
  while(!ended){const r=await official.stdin({session_id:session,chars:'',yield_time_ms:1000,max_output_tokens:20000});absorb(r);if(ended)requireFact(r.exit_code===0,'INSTALL_FINISH_EXIT');}
  complete=true;return {...result,originalPromisesRetained:true,lifecycleExclusiveTransaction:true};
 }finally{if(session!==null&&!ended&&!complete){try{if(sourceComplete)await exchange('abandon',null,'INSTALL_UNKNOWN',true);else await official.stdin({session_id:session,chars:'\u0003',yield_time_ms:1000,max_output_tokens:20000});}catch{}}}
}
return Object.freeze({installFixedController});
