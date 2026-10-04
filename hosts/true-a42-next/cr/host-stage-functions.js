
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;const h=await new AsyncFunction(load("trueA42:cr:cloudPilotHostHelpers"))(); const {cfg}=h;
async function handle(r,dir){
 if(r.expired||r.dispatchRecorded)throw Error("HOST_STALE_OR_UNCERTAIN_REQUEST:"+r.kind);
 if(["LEASE_ACQUIRE","LEASE_RENEW","LEASE_RELEASE","READ_OUTCOME","READ_PUBLICATION_CONTEXT"].includes(r.kind))return h.sqlDispatch(r,dir,r.payload.sql);
 if(r.kind==="CREATE_PENDING"){
  const made=JSON.parse(await h.cmd("node --import /workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/producer-source/node_modules/tsx/dist/loader.mjs "+h.q(cfg.root+"/host-files.mts")+" pending "+h.q(dir+"/"+r.requestId+".request.json"),10000,Date.parse(r.payload.dispatchBefore??r.expiresAt)));
  if(made.requestSha256!==r.requestSha256||made.requestId!==r.requestId||made.projectId!==cfg.project||r.payload.projectId!==cfg.project)throw Error("HOST_CONTROL_REQUEST_BINDING");
  const sql=await h.readFile(made.output,Date.parse(r.payload.dispatchBefore??r.expiresAt));if(sql.hash!==made.sha256)throw Error("HOST_CONTROL_HASH");
  await h.mark(r,dir);const raw=await tools.mcp__codex_apps__supabase_execute_sql({project_id:cfg.project,query:sql.text});store("trueA42:cr:cloudPendingToolResult",raw);
  const out=h.rows(raw);if(out.length!==1||!out[0].result)throw Error("HOST_PENDING_RESPONSE");
  await h.respond(r,dir,out[0].result);store("trueA42:cr:cloudPilotPendingRequest",r);return {status:"CREATED_PENDING"};
 }
 if(r.kind==="READ_CONTEXT"){
  if(r.payload.projectId!==cfg.project||r.payload.sourceId!=="source-cr-pharma-social"||r.payload.sourceConfigSha256!=="0c5e8c2089b14b18b5db88b63d0c809f9e216bace615fdf1c34f34e9fe83da89")throw Error("HOST_CONTEXT_SOURCE_BINDING");
  const query=(await h.readFile(cfg.root+"/context-read.sql")).text;
  await h.mark(r,dir);const raw=await tools.mcp__codex_apps__supabase_execute_sql({project_id:cfg.project,query});store("trueA42:cr:cloudLiveContextToolResult",raw);
  const out=h.rows(raw);if(out.length!==1||!out[0].context)throw Error("HOST_CONTEXT_RESPONSE");
  const context=out[0].context;if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+]00:00)$/.test(context.checkedAt))throw Error("HOST_CONTEXT_UTC");
  await h.respond(r,dir,{...context,checkedAt:new Date(context.checkedAt).toISOString()});return {status:"READ_CONTEXT"};
 }
 if(r.kind==="ARCHIVE_STORE"){
  const pending=load("trueA42:cr:cloudPilotPendingRequest");
  if(!pending||pending.payload.projectId!==cfg.project||pending.payload.planned.sources.length!==1||pending.payload.planned.sources[0].sourceId!=="source-cr-pharma-social")throw Error("HOST_ARCHIVE_PENDING_BINDING");
  const planned=pending.payload.planned,expectedPath=dir+"/"+r.requestId+".archive-expected.json";
  await h.save(expectedPath,{releaseCandidateId:planned.batch.releaseCandidateId,batchId:planned.batch.id,sourceId:planned.sources[0].sourceId,sourceResultId:planned.sources[0].id,sourceConfigSha256:planned.sources[0].sourceConfigHash,evidenceSubdirectory:"cloud-pilot/runtime-evidence"});
  const audit=JSON.parse(await h.cmd("node "+h.q(cfg.root+"/host-files.mts")+" prepare-archive-upload "+h.q(r.payload.bundlePath)+" "+h.q(expectedPath)));
  if(audit.sha256!==r.payload.bundleSha256||audit.bytes!==r.payload.byteCount)throw Error("HOST_ARCHIVE_BINDING");
  await h.mark(r,dir);
  const libraryData=result=>{let body=result;for(let i=0;i<4&&body?.structuredContent;i++)body=body.structuredContent;if(body===result&&!result.structuredContent)body=JSON.parse(result.content.find(c=>c.type==="text").text);return body.result??body;};
  const upload=await tools.mcp__codex_apps__library_create_library_file({file:audit.output,library_artifact_type:"other"});store("trueA42:cr:cloudLiveArchiveCreate",upload);
  const item=libraryData(upload);
  if(upload.isError||item?.status!=="succeeded"||!item.library_file_id)throw Error("HOST_ARCHIVE_UPLOAD_UNCERTAIN");
  const attrs=JSON.stringify(item.xattrs??[]);
  await h.cmd("python3 /workspace/shared/job-finder-recovery/library-helper-current-1841/library_file_transfer.py apply-xattrs "+h.q(audit.output)+" "+h.q(item.library_file_id)+" <<'LIBRARY_XATTR_INPUT'\n"+attrs+"\nLIBRARY_XATTR_INPUT");
  if(typeof item.file_id!=="string"||!/^file_[a-f0-9]+$/.test(item.file_id)||!/^libfile_[a-f0-9]+$/.test(item.library_file_id)||!Number.isSafeInteger(item.current_version_number)||item.current_version_number<0||item.file_size_bytes!==audit.packedBytes)throw Error("HOST_ARCHIVE_UPLOAD_RECEIPT");
  const receipt={bundleSha256:r.payload.bundleSha256,bundleByteCount:r.payload.byteCount,libraryFileId:item.library_file_id,libraryVersion:String(item.current_version_number),libraryFileIdBacking:item.file_id,packedSha256:audit.packedSha256,packedByteCount:audit.packedBytes,stored:true,recoveryVerification:"PENDING"};
  await h.save(dir+"/"+r.requestId+".stored-archive.json",{...receipt,packedPath:audit.output,sourceBundlePath:r.payload.bundlePath});
  await h.respond(r,dir,receipt);
  store("trueA42:cr:cloudLiveArchiveIdentity",{...item,...receipt});return {status:"ARCHIVE_STORED_RECOVERY_PENDING",libraryFileId:item.library_file_id};
 }
 if(r.kind==="PUBLISH"){
  const packet=JSON.parse(await h.cmd("node --import /workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/producer-source/node_modules/tsx/dist/loader.mjs "+h.q(cfg.root+"/host-files.mts")+" publish "+h.q(dir+"/"+r.requestId+".request.json"),10000,Date.parse(r.payload.dispatchBefore??r.expiresAt)));
  const sqlPath=packet.output;
  store("trueA42:cr:cloudPilotPublishRequest",r);store("trueA42:cr:cloudPilotPublishDirectory",dir);
  return {...packet,status:"AWAITING_PARENT_REVIEW",requestId:r.requestId,requestSha256:r.requestSha256,sqlPath,dispatchBefore:r.payload.dispatchBefore,expiresAt:r.expiresAt,characters:r.payload.sql.length};
 }
 throw Error("HOST_UNKNOWN_REQUEST");
}
return {h,handle};
