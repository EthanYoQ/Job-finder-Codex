
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;const h=await new AsyncFunction(load("restored46:bayer:cloudPilotHostHelpers"))(); const {cfg}=h;
async function handle(r,dir){
 if(r.expired||r.dispatchRecorded)throw Error("HOST_STALE_OR_UNCERTAIN_REQUEST:"+r.kind);
 if(["LEASE_ACQUIRE","LEASE_RENEW","LEASE_RELEASE","READ_OUTCOME","READ_PUBLICATION_CONTEXT"].includes(r.kind))return h.sqlDispatch(r,dir,r.payload.sql);
 if(r.kind==="CREATE_PENDING"){
  const made=JSON.parse(await h.cmd("node --import /workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/producer42/node_modules/tsx/dist/loader.mjs "+h.q(cfg.root+"/host-files.mts")+" pending "+h.q(dir+"/"+r.requestId+".request.json"),10000,Date.parse(r.payload.dispatchBefore??r.expiresAt)));
  if(made.requestSha256!==r.requestSha256||made.requestId!==r.requestId||made.projectId!==cfg.project||r.payload.projectId!==cfg.project)throw Error("HOST_CONTROL_REQUEST_BINDING");
  const sql=await h.readFile(made.output,Date.parse(r.payload.dispatchBefore??r.expiresAt));if(sql.hash!==made.sha256)throw Error("HOST_CONTROL_HASH");
  await h.mark(r,dir);const raw=await tools.mcp__codex_apps__supabase_execute_sql({project_id:cfg.project,query:sql.text});store("restored46:bayer:cloudPendingToolResult",raw);
  const out=h.rows(raw);if(out.length!==1||!out[0].result)throw Error("HOST_PENDING_RESPONSE");
  await h.respond(r,dir,out[0].result);store("restored46:bayer:cloudPilotPendingRequest",r);return {status:"CREATED_PENDING"};
 }
 if(r.kind==="READ_CONTEXT"){
  if(r.payload.projectId!==cfg.project||r.payload.sourceId!=="source-bayer-healthcare-social"||r.payload.sourceConfigSha256!=="df4b8294c45f3bcad0675d64b4211522f3265bae68a38c0825c3d99773f139e9")throw Error("HOST_CONTEXT_SOURCE_BINDING");
  const query=(await h.readFile(cfg.root+"/context-read.sql")).text;
  await h.mark(r,dir);const raw=await tools.mcp__codex_apps__supabase_execute_sql({project_id:cfg.project,query});store("restored46:bayer:cloudLiveContextToolResult",raw);
  const out=h.rows(raw);if(out.length!==1||!out[0].context)throw Error("HOST_CONTEXT_RESPONSE");
  const context=out[0].context;if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+]00:00)$/.test(context.checkedAt))throw Error("HOST_CONTEXT_UTC");
  await h.respond(r,dir,{...context,checkedAt:new Date(context.checkedAt).toISOString()});return {status:"READ_CONTEXT"};
 }
 if(r.kind==="ARCHIVE_STORE")throw Error("BAYER_LEGACY_ARCHIVE_STORE_UNSUPPORTED_PARENT_RETENTION_REQUIRED");
 if(r.kind==="PUBLISH"){
  await h.cmd("node "+h.q(cfg.root+"/runtime/publisher-state-guard.mjs")+" publish "+h.q(dir.split("/").at(-2)),2000,Date.parse(r.payload.dispatchBefore??r.expiresAt));
  const packet=JSON.parse(await h.cmd("node --import /workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/producer42/node_modules/tsx/dist/loader.mjs "+h.q(cfg.root+"/host-files.mts")+" publish "+h.q(dir+"/"+r.requestId+".request.json"),10000,Date.parse(r.payload.dispatchBefore??r.expiresAt)));
  const sqlPath=packet.output;
  store("restored46:bayer:cloudPilotPublishRequest",r);store("restored46:bayer:cloudPilotPublishDirectory",dir);
  return {...packet,status:"AWAITING_PARENT_REVIEW",requestId:r.requestId,requestSha256:r.requestSha256,sqlPath,dispatchBefore:r.payload.dispatchBefore,expiresAt:r.expiresAt,characters:r.payload.sql.length};
 }
 throw Error("HOST_UNKNOWN_REQUEST");
}
return {h,handle};
