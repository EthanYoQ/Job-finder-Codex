
const cfg=load("proxyNode22:astellas:cloudPilotHostConfig");
const parseMachineJson=new Function('output','record',load('proxyNode22:astellas:cloudPilotMachineJson'));
const machineJson=output=>parseMachineJson(output,diagnostic=>store('proxyNode22:astellas:lastMachineJsonDiagnostic',diagnostic));
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
async function cmd(command,max=10000,deadline=Date.now()+90000){
 const startedAt=Date.now();if(!Number.isFinite(deadline)||deadline<=startedAt)throw Error("HOST_LOCAL_COMMAND_BUDGET_EXHAUSTED");
 let r=await tools.exec_command({cmd:"env PATH=/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin:\"$PATH\" JOBFINDER_CLOUD_SOURCE_ID=source-astellas-china-social TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 "+command,workdir:cfg.repo,max_output_tokens:max,yield_time_ms:Math.min(10000,Math.max(1,deadline-startedAt))});
 let output=r.output??"",session=r.session_id;
 if(session)notify({status:"HOST_LOCAL_COMMAND_RUNNING",session,deadline:new Date(deadline).toISOString()});
 while(r.session_id){
  session=r.session_id;const remaining=deadline-Date.now();
  if(remaining<=0){store("proxyNode22:astellas:cloudHostLocalCommandOutcome",{status:"BUDGET_EXHAUSTED",session,startedAt,deadline});throw Error("HOST_LOCAL_COMMAND_BUDGET_EXHAUSTED:"+session);}
  try{r=await tools.write_stdin({session_id:session,chars:"",yield_time_ms:Math.min(1000,remaining),max_output_tokens:max});}
  catch(error){store("proxyNode22:astellas:cloudHostLocalCommandOutcome",{status:"POLL_UNRESOLVED_NO_RETRY",session,startedAt,deadline,error:String(error)});throw error;}
  output+=r.output??"";
 }
 store("proxyNode22:astellas:cloudHostLocalCommandOutcome",{status:"TERMINAL",session,startedAt,finishedAt:Date.now(),exitCode:r.exit_code});
 if(r.exit_code!==0)throw Error("HOST_COMMAND:"+output);return output;
}
async function save(path,value){const data=typeof value==="string"?value:JSON.stringify(value);const result=await tools.apply_patch("*** Begin Patch\n*** Add File: "+path+"\n"+data.split("\n").map(x=>"+"+x).join("\n")+"\n*** End Patch");if(result?.isError)throw Error("HOST_SAVE");return path;}
async function readFile(path,deadline=Date.now()+90000){let offset=0,parts=[],hash,total;while(true){const r=machineJson(await cmd("/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node "+q(cfg.root+"/host-files.mts")+" read "+q(path)+" "+offset,100000,deadline));if(hash&&hash!==r.sha256)throw Error("HOST_READ_CHANGED");hash=r.sha256;total=r.charCount;parts.push(r.text);if(r.next===null)break;offset=r.next;}const text=parts.join("");if(text.length!==total)throw Error("HOST_READ_INCOMPLETE");return {text,hash};}
function rows(result){if(result.isError)throw Error("HOST_SQL_TOOL_ERROR:"+JSON.stringify(result));const t=result.structuredContent?.result??JSON.parse(result.content.find(x=>x.type==="text").text).result; if(typeof t!=="string")throw Error("HOST_SQL_RESULT_SHAPE");const m=t.match(/\n<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-/);if(!m)throw Error("HOST_SQL_ROWS_MISSING");const r=JSON.parse(m[1]);if(!Array.isArray(r))throw Error("HOST_SQL_ROWS_INVALID");return r;}
async function mark(r,dir){const deadline=Date.parse(r.payload?.dispatchBefore??r.expiresAt);const current=JSON.parse((await readFile(dir+"/"+r.requestId+".request.json",deadline)).text);const {expired,dispatchRecorded,...expected}=r;if(JSON.stringify(current)!==JSON.stringify(expected))throw Error("HOST_REQUEST_CHANGED");await cmd("/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node "+q(cfg.root+"/relay-files.mjs")+" mark-dispatch "+q(dir)+" "+q(r.requestId)+" "+q(r.requestSha256),10000,deadline);}
async function respond(r,dir,result,diagnostic){const p=dir+"/"+r.requestId+".host-result.json";await save(p,{requestId:r.requestId,requestSha256:r.requestSha256,result,...diagnostic?{diagnostic}:{}});await cmd("/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node "+q(cfg.root+"/relay-files.mjs")+" respond "+q(dir)+" "+q(p));}
function publicationFailure(raw,r,sql,proof){
 // Only the observed database error envelope for one compiler-produced atomic
 // DO establishes rollback. Transport exceptions and arbitrary error-like text
 // remain UNKNOWN, including statement-completion ambiguity (40003).
 const exactDbStarted=proof?.validated===true&&proof.requestId===r.requestId&&proof.requestSha256===r.requestSha256&&proof.declarationMode==='FROZEN_COMPILER_SHARED_JSON_V1';
 const packet=exactDbStarted?sql.match(/^SET LOCAL statement_timeout = '120000ms';\nDO (\$atomic_[a-f0-9]{32}\$)\n(DECLARE affected bigint; job_data jsonb; [\s\S]*\nEND;)\n\1;$/):null;
 if(r.kind==='PUBLISH'&&packet&&!packet[2].includes(packet[1])&&raw?.isError===true&&raw.structuredContent?.error_code==='INVALID_ARGUMENT'&&raw.content?.length===1&&raw.content[0]?.type==='text'){
  try{
   const error=JSON.parse(raw.content[0].text)?.error;
   const raised=error?.name==='HttpException'&&typeof error.message==='string'?error.message.match(/^Failed to run sql query: ERROR: +P0001: (CRAWL_LEASE_LOST|CRAWL_LEASE_BUSY|PILOT_[A-Z_]+)\nCONTEXT: +PL\/pgSQL function inline_code_block line [1-9][0-9]* at RAISE\n?$/):null;
   if(raised&&(raised[1]==='CRAWL_LEASE_LOST'||exactDbStarted))return {status:'FAILED',outcome:'ROLLED_BACK',code:'P0001'};
   const timeout=error?.name==='HttpException'&&typeof error.message==='string'&&exactDbStarted?error.message.match(/^Failed to run sql query: ERROR: +(55P03|57014): [\s\S]+$/):null;
   if(timeout)return {status:'FAILED',outcome:'ROLLED_BACK',code:timeout[1]};
  }catch{}
 }
 return {status:'FAILED',outcome:'UNKNOWN',code:'UNKNOWN'};
}
function publicationReviewRejected(raw,r){
 // This exact platform error wrapper is only a reason to defer the response.
 // It is NOT proof of no write, retry authorization, or database rollback.
 return r.kind==='PUBLISH'&&raw?.isError===true&&Object.keys(raw).sort().join(',')==='content,isError'&&
  Array.isArray(raw.content)&&raw.content.length===1&&raw.content[0]?.type==='text'&&
  Object.keys(raw.content[0]).sort().join(',')==='text,type'&&typeof raw.content[0].text==='string'&&
  /^This action was rejected due to unacceptable risk\.\nReason: \S[\s\S]*$/.test(raw.content[0].text);
}
async function sqlDispatch(r,dir,sql){
 if(typeof sql!=="string"||sql!==r.payload?.sql||cfg.project!==r.payload?.projectId)throw Error("HOST_SQL_BINDING");
 let proof;
 if(r.kind==='PUBLISH'){proof=machineJson(await cmd("/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node --import "+q(cfg.repo+"/node_modules/tsx/dist/loader.mjs")+" "+q(cfg.root+"/runtime/review-packet-envelope.mts")+" "+q(dir+"/"+r.requestId+".request.json")+" summary",2000,Date.parse(r.payload.dispatchBefore??r.expiresAt)));}
 await mark(r,dir);let result,raw,diagnostic;
 try{raw=await tools.mcp__codex_apps__supabase_execute_sql({project_id:cfg.project,query:sql});store("proxyNode22:astellas:cloudLastSqlToolResult",raw);result={status:"SUCCEEDED",rows:rows(raw)};}
 catch(error){
  diagnostic={recordedAt:new Date().toISOString(),responseExpired:Date.now()>=Date.parse(r.expiresAt),toolResult:raw??null,error:{message:String(error),name:error?.name,stack:error?.stack}};
  store("proxyNode22:astellas:cloudHostLastDispatchError",diagnostic);result=publicationFailure(raw,r,sql,proof);
  if(publicationReviewRejected(raw,r)){
   // Separate from *.host-result.json and *.response.json. Keep the dispatch
   // marker, original request/hash/project, and both absolute deadlines intact.
   const reviewHoldPath=dir+'/'+r.requestId+'.review-hold.json';
   const hold={schemaVersion:1,classification:'PLATFORM_RISK_REVIEW_HOLD',requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind,projectId:r.payload.projectId,dispatchBefore:r.payload.dispatchBefore,expiresAt:r.expiresAt,outcome:'UNKNOWN',noWriteEstablished:false,retryAuthorized:false,recordedAt:diagnostic.recordedAt};
   await save(reviewHoldPath,hold);
   return {status:'AWAITING_OWNER_RECONCILIATION',outcome:'UNKNOWN',responseDeferred:true,requestId:r.requestId,requestSha256:r.requestSha256,reviewHoldPath};
  }
 }
 await respond(r,dir,result,diagnostic);return result;
}
async function next(dir){
 const metadata=async()=>machineJson(await cmd("/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node "+q(cfg.root+"/relay-files.mjs")+" next-meta "+q(dir),2000));
 let a=await metadata();if(!Array.isArray(a))throw Error("HOST_PENDING_METADATA");
 let settled=false;
 for(const meta of a)if(meta.expired){
  const result=machineJson(await cmd("/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node "+q(cfg.root+"/relay-files.mjs")+" expire-undispatched "+q(dir)+" "+q(meta.requestId)+" "+q(meta.requestSha256),2000));
  if(result.settled===true)settled=true;else if(result.settled!==false||result.reason!=="DISPATCH_UNCERTAIN")throw Error("HOST_EXPIRY_RESULT");
 }
 if(settled)a=await metadata();
 if(!Array.isArray(a)||a.length>1)throw Error("HOST_MULTIPLE_PENDING_REQUESTS");if(!a.length)return undefined;
 const meta=a[0],r=JSON.parse((await readFile(dir+"/"+meta.requestId+".request.json")).text);
 if(r.requestId!==meta.requestId||r.requestSha256!==meta.requestSha256||r.kind!==meta.kind)throw Error("HOST_NEXT_REQUEST_CHANGED");
 return {...r,expired:meta.expired,dispatchRecorded:meta.dispatchRecorded};
}
return {cfg,q,cmd,save,readFile,rows,mark,respond,sqlDispatch,next,machineJson};
