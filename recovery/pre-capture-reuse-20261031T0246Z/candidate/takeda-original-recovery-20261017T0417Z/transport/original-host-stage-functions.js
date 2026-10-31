
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;const h=await new AsyncFunction(load("cloudPilotHostHelpers"))(); const {cfg}=h;
async function handle(r,dir,readPreCaptureContext){
 const b=await h.binding();if(dir!==b.relayDirectory)throw Error("RELAY_DIRECTORY_OUTSIDE_TASK");
 if(r.expired||r.dispatchRecorded)throw Error("HOST_STALE_OR_UNCERTAIN_REQUEST:"+r.kind);
 if(["ARCHIVE_STORE","CREATE_PENDING","LEASE_ACQUIRE","LEASE_RENEW","LEASE_RELEASE"].includes(r.kind))throw Error("HOST_DB_STARTED_KIND");
 if(r.kind==="READ_CONTEXT"||r.kind==="READ_PUBLICATION_CONTEXT"){
  const packet=JSON.parse(await h.cmd("node "+h.q(cfg.root+"/host-files.mts")+" connector-context "+h.q(dir+"/"+r.requestId+".request.json")));
  if(packet.requestId!==r.requestId||packet.requestSha256!==r.requestSha256||packet.candidateId!==b.candidateId||packet.buildContentSha256!==b.buildContentSha256)throw Error("HOST_CONTEXT_PACKET_BINDING");
  if(r.kind==="READ_PUBLICATION_CONTEXT")return h.sqlDispatch(r,dir,packet.sql);
  if(r.payload.projectId!==cfg.project||r.payload.sourceId!==b.sourceId||r.payload.sourceConfigSha256!==b.sourceConfigSha256)throw Error("HOST_CONTEXT_SOURCE_BINDING");
  await h.mark(r,dir);let context,observed;
  try {
   if(readPreCaptureContext)context=await readPreCaptureContext(r);
   else {
    const raw=await tools.mcp__codex_apps__supabase_execute_sql({project_id:cfg.project,query:packet.sql});store("cloudLiveContextToolResult",raw);
    observed={projectId:cfg.project,query:packet.sql,recordedAt:new Date().toISOString(),toolResult:raw};
    const out=h.rows(raw);if(out.length!==1||!out[0].context)throw Error("HOST_CONTEXT_RESPONSE");context=out[0].context;
   }
   if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+]00:00)$/.test(context.checkedAt))throw Error("HOST_CONTEXT_UTC");
  }catch(error){
   observed=observed??error?.officialSqlRead;
   if(!observed||observed.projectId!==cfg.project||typeof observed.query!=='string'||!h.toolReviewRejected(observed.toolResult))throw error;
   // A rejected read is not a publication outcome; retain the original marker.
   await h.respond(r,dir,{status:'FAILED',code:'TOOL_REVIEW_REJECTED'},{...observed,responseExpired:Date.now()>=Date.parse(r.expiresAt)});
   return {status:'READ_CONTEXT_REVIEW_REJECTED',requestId:r.requestId,requestSha256:r.requestSha256};
  }
  await h.respond(r,dir,{...context,checkedAt:new Date(context.checkedAt).toISOString()});return {status:"READ_CONTEXT"};
 }
 if(r.kind==="READ_OUTCOME")return h.sqlDispatch(r,dir,r.payload.sql);
 if(r.kind==="PUBLISH"){
  const packet=JSON.parse(await h.cmd("node "+h.q(cfg.root+"/host-files.mts")+" connector-publish "+h.q(dir+"/"+r.requestId+".request.json")));
  if(packet.requestId!==r.requestId||packet.requestSha256!==r.requestSha256||packet.projectId!==cfg.project||packet.candidateId!==b.candidateId||packet.buildContentSha256!==b.buildContentSha256)throw Error("HOST_PUBLISH_PACKET_BINDING");
  store("cloudPilotPublishRequest",r);store("cloudPilotPublishDirectory",dir);
  return {...packet,status:"AWAITING_PARENT_REVIEW",requestId:r.requestId,requestSha256:r.requestSha256,sqlPath:packet.output,characters:r.payload.sql.length};
 }
 throw Error("HOST_UNKNOWN_REQUEST");
}
return {h,handle};
