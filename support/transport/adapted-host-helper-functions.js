
const loaded=load("cloudPilotHostConfig");
if(!["TAKEDA_PORTABLE_CONNECTOR_V1","NATIVE_PORTABLE_CONNECTOR_V1","NATIVE_AB_CONNECTOR_V1"].includes(loaded?.mode))throw Error("HOST_CONFIG_REQUIRED");
const cfg=Object.freeze({...loaded});
const sourceId=cfg?.sourceId??(cfg.mode==="TAKEDA_PORTABLE_CONNECTOR_V1"?"source-takeda-china-social":undefined);
if(!/^source-[a-z0-9-]+$/.test(sourceId??""))throw Error("HOST_SOURCE_ENV");
if(!/^[a-f0-9]{64}$/.test(cfg.bindingSha256??""))throw Error("HOST_CONFIG_REQUIRED");
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
async function cmd(command,max=10000){
 const script=["host-files.mts","relay-files.mjs"].find(name=>command.startsWith("node "+q(cfg.root+"/"+name)+" "));
 if(!script)throw Error("HOST_COMMAND_SCOPE");
 command="/usr/bin/python3 -I "+q(cfg.root+"/connector-host-launch.py")+" "+q(script)+command.slice(("node "+q(cfg.root+"/"+script)).length);
 let r=await tools.exec_command({cmd:"JOBFINDER_CONNECTOR_HOST_SHA256="+q(cfg.bindingSha256)+" JOBFINDER_CLOUD_SOURCE_ID="+q(sourceId)+" "+command,workdir:cfg.repo,max_output_tokens:max,yield_time_ms:10000}),output=r.output;while(r.session_id){r=await tools.write_stdin({session_id:r.session_id,chars:"",yield_time_ms:1000,max_output_tokens:max});output+=r.output;}if(r.exit_code!==0)throw Error("HOST_COMMAND:"+output);return output;}
async function readFile(path){let offset=0,parts=[],hash,total;while(true){const r=JSON.parse(await cmd("node "+q(cfg.root+"/host-files.mts")+" connector-read "+q(path)+" "+offset,100000));if(hash&&hash!==r.sha256)throw Error("HOST_READ_CHANGED");hash=r.sha256;total=r.charCount;parts.push(r.text);if(r.next===null)break;offset=r.next;}const text=parts.join("");if(text.length!==total)throw Error("HOST_READ_INCOMPLETE");return {text,hash};}
function rows(result){if(result.isError)throw Error("HOST_SQL_TOOL_ERROR:"+JSON.stringify(result));const t=result.structuredContent?.result??JSON.parse(result.content.find(x=>x.type==="text").text).result; if(typeof t!=="string")throw Error("HOST_SQL_RESULT_SHAPE");const m=t.match(/\n<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-/);if(!m)throw Error("HOST_SQL_ROWS_MISSING");const r=JSON.parse(m[1]);if(!Array.isArray(r))throw Error("HOST_SQL_ROWS_INVALID");return r;}
async function mark(r,dir){const current=JSON.parse((await readFile(dir+"/"+r.requestId+".request.json")).text);const {expired,dispatchRecorded,...expected}=r;if(JSON.stringify(current)!==JSON.stringify(expected))throw Error("HOST_REQUEST_CHANGED");await cmd("node "+q(cfg.root+"/relay-files.mjs")+" mark-dispatch "+q(dir)+" "+q(r.requestId)+" "+q(r.requestSha256));}
// Pure SHA-256 of the actual response bytes, available in the tool JS isolate.
// No file-supplied digest or executable crypto provider is accepted.
function responseDigest(text){
 const bytes=unescape(encodeURIComponent(text)),length=bytes.length;
 const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],words=[];
 for(let i=0;i<length;i++)words[i>>>2]=(words[i>>>2]??0)|(bytes.charCodeAt(i)<<((3-(i&3))*8));
 words[length>>>2]=(words[length>>>2]??0)|(0x80<<((3-(length&3))*8));
 const blocks=Math.ceil((length+9)/64);words[blocks*16-2]=Math.floor(length/0x20000000);words[blocks*16-1]=(length*8)>>>0;
 const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let block=0;block<blocks;block++){
  const w=Array.from({length:64},(_,i)=>words[block*16+i]??0);
  for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=((rotr(a,7)^rotr(a,18)^(a>>>3))+w[i-16]+(rotr(b,17)^rotr(b,19)^(b>>>10))+w[i-7])|0;}
  let [a,b,c,d,e,f,g,h]=H;
  for(let i=0;i<64;i++){const t1=(h+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[i]+w[i])|0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))|0;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}
  [a,b,c,d,e,f,g,h].forEach((x,i)=>H[i]=(H[i]+x)|0);
 }
 return {sha256:H.map(x=>(x>>>0).toString(16).padStart(8,"0")).join(""),byteCount:length,charCount:text.length};
}
async function respond(r,dir,result,diagnostic){
 const p=dir+"/"+r.requestId+".host-result.json",packet={requestId:r.requestId,requestSha256:r.requestSha256,result,...diagnostic?{diagnostic}:{}};
 const text=JSON.stringify(packet),digest=responseDigest(text),count=Math.ceil(text.length/16000);
 if(digest.byteCount>16*1024*1024||count>2048)throw Error("HOST_RESPONSE_TOO_LARGE");
 const meta={requestSha256:r.requestSha256,...digest,count};
 const transfer="/workspace/scratch/5e9614251709/takeda-original-recovery-20261017T0417Z/transport/"+r.requestId+".json";
 const patch=await tools.apply_patch("*** Begin Patch\n*** Add File: "+transfer+"\n+"+JSON.stringify({packet,meta})+"\n*** End Patch");if(patch?.isError)throw Error("TRANSFER_SAVE");
 const bulk=await tools.exec_command({cmd:"/usr/bin/python3 -I /workspace/scratch/5e9614251709/takeda-original-recovery-20261017T0417Z/transport/write-original-parts.py "+q(transfer)+" "+q(p),max_output_tokens:1000});if(bulk.exit_code!==0||bulk.session_id)throw Error("TRANSFER_PARTS:"+bulk.output);
 const sealed=JSON.parse(await cmd("node "+q(cfg.root+"/host-files.mts")+" connector-save-assemble "+q(p)+" "+q(JSON.stringify(meta))));
 if(sealed.sha256!==digest.sha256||sealed.byteCount!==digest.byteCount)throw Error("HOST_RESPONSE_HASH");
 const finalized=JSON.parse(await cmd("node "+q(cfg.root+"/host-files.mts")+" connector-save-finalize "+q(p)+" "+q(JSON.stringify(meta))));
 if(finalized.sha256!==digest.sha256||finalized.byteCount!==digest.byteCount)throw Error("HOST_RESPONSE_HASH");
 await cmd("node "+q(cfg.root+"/relay-files.mjs")+" respond "+q(dir)+" "+q(p));
}

function publicationFailure(raw,r,sql){
 // An explicit tool-review rejection did not invoke SQL. Keep its diagnostic; never retry here.
 if(r.kind==='PUBLISH'&&raw?.isError===true&&raw.content?.length===1&&raw.content[0]?.type==='text'&&raw.content[0].text.startsWith('This action was rejected due to unacceptable risk.\nReason: ')&&raw.content[0].text.includes('\nDo not bypass this rejection through a workaround or indirect execution.'))return {status:'FAILED',outcome:'NOT_DISPATCHED',code:'TOOL_REVIEW_REJECTED'};
 // Only the observed database error envelope for one compiler-produced atomic
 // DO establishes rollback. Transport exceptions and arbitrary error-like text
 // remain UNKNOWN, including statement-completion ambiguity (40003).
 const packet=sql.match(/^SET LOCAL statement_timeout = '120000ms';\nDO (\$atomic_[a-f0-9]{32}\$)\n(DECLARE affected bigint; job_data jsonb;(?: current_context jsonb; current_count bigint; current_hash text; aggregate_hash text;)?\nBEGIN\n[\s\S]*\nEND;)\n\1;$/);
 if(r.kind==='PUBLISH'&&packet&&!packet[2].includes(packet[1])&&raw?.isError===true&&raw.structuredContent?.error_code==='INVALID_ARGUMENT'&&raw.content?.length===1&&raw.content[0]?.type==='text'){
  try{
   const error=JSON.parse(raw.content[0].text)?.error;
   const raised=error?.name==='HttpException'&&typeof error.message==='string'?error.message.match(/^Failed to run sql query: ERROR: +P0001: (CRAWL_LEASE_LOST|CRAWL_LEASE_BUSY|PILOT_[A-Z_]+)\nCONTEXT: +PL\/pgSQL function inline_code_block line [1-9][0-9]* at RAISE\n?$/):null;
   if(raised&&(raised[1]==='CRAWL_LEASE_LOST'||packet[2].startsWith('DECLARE affected bigint; job_data jsonb; current_context jsonb;')))return {status:'FAILED',outcome:'ROLLED_BACK',code:'P0001'};
   const timeout=error?.name==='HttpException'&&typeof error.message==='string'&&packet[2].startsWith('DECLARE affected bigint; job_data jsonb; current_context jsonb;')?error.message.match(/^Failed to run sql query: ERROR: +(55P03|57014): [\s\S]+$/):null;
   if(timeout)return {status:'FAILED',outcome:'ROLLED_BACK',code:timeout[1]};
  }catch{}
 }
 return {status:'FAILED',outcome:'UNKNOWN',code:'UNKNOWN'};
}
async function sqlDispatch(r,dir,sql){
 if(!["READ_PUBLICATION_CONTEXT","READ_OUTCOME","PUBLISH"].includes(r.kind))throw Error("HOST_DB_STARTED_KIND");
 if(typeof sql!=="string"||sql!==r.payload?.sql||cfg.project!==r.payload?.projectId)throw Error("HOST_SQL_BINDING");
 await mark(r,dir);let result,raw,diagnostic;
 try{raw=await tools.mcp__codex_apps__supabase_execute_sql({project_id:cfg.project,query:sql});store("cloudLastSqlToolResult",raw);result={status:"SUCCEEDED",rows:rows(raw)};}
 catch(error){
  diagnostic={recordedAt:new Date().toISOString(),responseExpired:Date.now()>=Date.parse(r.expiresAt),toolResult:raw??null,error:{message:String(error),name:error?.name,stack:error?.stack}};
  store("cloudHostLastDispatchError",diagnostic);result=publicationFailure(raw,r,sql);
 }
 await respond(r,dir,result,diagnostic);return result;
}
async function next(dir){
 const metadata=async()=>JSON.parse(await cmd("node "+q(cfg.root+"/relay-files.mjs")+" next-meta "+q(dir),2000));
 let a=await metadata();if(!Array.isArray(a))throw Error("HOST_PENDING_METADATA");
 let settled=false;
 for(const meta of a)if(meta.expired){
  const result=JSON.parse(await cmd("node "+q(cfg.root+"/relay-files.mjs")+" expire-undispatched "+q(dir)+" "+q(meta.requestId)+" "+q(meta.requestSha256),2000));
  if(result.settled===true)settled=true;else if(result.settled!==false||result.reason!=="DISPATCH_UNCERTAIN")throw Error("HOST_EXPIRY_RESULT");
 }
 if(settled)a=await metadata();
 if(!Array.isArray(a)||a.length>1)throw Error("HOST_MULTIPLE_PENDING_REQUESTS");if(!a.length)return undefined;
 const meta=a[0],r=JSON.parse((await readFile(dir+"/"+meta.requestId+".request.json")).text);
 if(r.requestId!==meta.requestId||r.requestSha256!==meta.requestSha256||r.kind!==meta.kind)throw Error("HOST_NEXT_REQUEST_CHANGED");
 return {...r,expired:meta.expired,dispatchRecorded:meta.dispatchRecorded};
}
async function binding(){
 const b=JSON.parse(await cmd("node "+q(cfg.root+"/host-files.mts")+" connector-validate"));
 if(b.root!==cfg.root||b.repo!==cfg.repo||b.project!==cfg.project||b.mode!==cfg.mode||b.sourceId!==sourceId)throw Error("HOST_CONFIG_BINDING");return b;
}
return {cfg,q,cmd,readFile,rows,mark,respond,sqlDispatch,next,binding,responseDigest};

