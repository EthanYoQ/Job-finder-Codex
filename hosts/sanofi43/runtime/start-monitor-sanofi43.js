
const A=Object.getPrototypeOf(async function(){}).constructor;const h=await new A(load("sanofi43:cloudPilotHostHelpers"))();
if(h.cfg.sourceId!=="source-sanofi-china-social")throw Error("SOURCE_SCOPE");
if(!load('sanofi43:currentIndependentValidationInput'))throw Error('CURRENT_B_INDEPENDENT_INPUT_REQUIRED');
const query=`WITH latest_successful AS (
 SELECT s.id AS "sourceResultId",s."sourceId",s."batchId",s."releaseCandidateId",s."sourceConfigHash",s."startedAt",s."finishedAt"
 FROM public."CrawlBatchSourceResult" s JOIN public."CrawlBatch" b ON b.id=s."batchId" AND b."releaseCandidateId"=s."releaseCandidateId"
 WHERE s."sourceId"=${h.q(h.cfg.sourceId)} AND s."atomicCommitState"='COMMITTED' AND s."completenessState"='VERIFIED'
 AND b.status='SUCCESS' AND b.kind<>'MANUAL_SOURCE'
 ORDER BY s."finishedAt" DESC,s.id DESC LIMIT 1
)
SELECT clock_timestamp() AS "checkedAt",
 (SELECT jsonb_agg(to_jsonb(r)) FROM public."ReleaseCandidate" r WHERE id='dot-cloud-sanofi-cn-d402d36-20261004') AS "candidateRows",
 (SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS "holderId",
 (SELECT to_jsonb(s)||jsonb_build_object('observations',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',o.id,'sourceResultId',o."sourceResultId",'sourceId',o."sourceId",'batchId',o."batchId",'releaseCandidateId',o."releaseCandidateId",'sourceConfigSha256',o."sourceConfigSha256",
   'crawledAt',o."crawledAt",'observedFrom',o."observedFrom",'observedTo',o."observedTo",'successful',o.successful,
   'transportSucceeded',o."transportSucceeded",'adapterSucceeded',o."adapterSucceeded",'completenessVerified',o."completenessVerified",'atomicCommitSucceeded',o."atomicCommitSucceeded") ORDER BY o.id)
   FROM public."CrawlObservation" o WHERE o."sourceResultId"=s."sourceResultId" AND o."sourceId"=s."sourceId" AND o."batchId"=s."batchId" AND o."releaseCandidateId"=s."releaseCandidateId"),'[]'::jsonb)) FROM latest_successful s) AS "latestSuccessfulSource";`;
const raw=await tools.mcp__codex_apps__supabase_execute_sql({project_id:h.cfg.project,query});const row=h.rows(raw)[0];if(!row||row.holderId!==""||row.candidateRows?.length!==1||row.candidateRows[0].commitSha!=="d402d3639c0ea729fa72bd1a4427570b227c7481")throw Error("FRESH_CANDIDATE_PRECONDITION");
// BEGIN OBSERVATION_DUE_GATE
function requireObservationDue(row,cfg){
 const parseUtc=value=>{
  if(typeof value!=="string")throw Error("SOURCE_DUE_OBSERVATION_TIME");
  let s=value.replace(" ","T");
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/.test(s))throw Error("SOURCE_DUE_OBSERVATION_TIME");
  if(!/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(s))s+="Z";
  else if(/[+-]\d{2}$/.test(s))s+=":00";
  const ms=Date.parse(s);if(!Number.isFinite(ms))throw Error("SOURCE_DUE_OBSERVATION_TIME");return ms;
 };
 const source=row.latestSuccessfulSource;
 // Source-specific migration: only this reviewed historical A tuple may supply the previous successful clock.
 // It grants no capture, certificate, current-config, candidate or publication authority.
 const reviewedSanofiLegacy=cfg.sourceId==='source-sanofi-china-social'&&cfg.sourceConfigSha256==='2925884ffb70805a106c730a5b24a8992b0d13ce0348de28639e27d1bbfeacee'&&
 source?.sourceId==='source-sanofi-china-social'&&source.sourceResultId==='dot-sanofi-a-20261003T0445Z-b181c52--source-sanofi-china-social'&&
 source.batchId==='dot-sanofi-a-20261003T0445Z-b181c52'&&source.releaseCandidateId==='dot-cloud-db-started-b181c52-20261003'&&
 source.sourceConfigHash==='106fb80ad4e6c953d41a2dd67156f42e1bc4416766c98912a60ad59722df97c3';
 if(!source||source.sourceId!==cfg.sourceId||(source.sourceConfigHash!==cfg.sourceConfigSha256&&!reviewedSanofiLegacy)||!source.sourceResultId||!source.batchId||!source.releaseCandidateId||!Array.isArray(source.observations)||source.observations.length!==1)throw Error("SOURCE_DUE_OBSERVATION_REQUIRED");
 const o=source.observations[0];
 if(!o.id||o.sourceResultId!==source.sourceResultId||o.sourceId!==source.sourceId||o.batchId!==source.batchId||o.releaseCandidateId!==source.releaseCandidateId||o.sourceConfigSha256!==source.sourceConfigHash||![o.successful,o.transportSucceeded,o.adapterSucceeded,o.completenessVerified,o.atomicCommitSucceeded].every(v=>v===true))throw Error("SOURCE_DUE_OBSERVATION_TUPLE");
 const crawledAt=parseUtc(o.crawledAt),observedFrom=parseUtc(o.observedFrom),observedTo=parseUtc(o.observedTo),checkedAt=parseUtc(row.checkedAt);
 if(observedFrom!==parseUtc(source.startedAt)||observedTo!==parseUtc(source.finishedAt)||observedFrom>crawledAt||crawledAt>observedTo||checkedAt<crawledAt)throw Error("SOURCE_DUE_OBSERVATION_WINDOW");
 const nextEligibleAt=crawledAt+43200000;
 if(checkedAt<nextEligibleAt)throw Error("SOURCE_NOT_DUE:"+new Date(nextEligibleAt).toISOString());
 return {basis:"CrawlObservation.crawledAt",sourceId:source.sourceId,sourceResultId:source.sourceResultId,batchId:source.batchId,releaseCandidateId:source.releaseCandidateId,observationId:o.id,crawledAt:new Date(crawledAt).toISOString(),nextEligibleAt:new Date(nextEligibleAt).toISOString(),checkedAt:new Date(checkedAt).toISOString(),ageMs:checkedAt-crawledAt};
}
// END OBSERVATION_DUE_GATE
const due=requireObservationDue(row,h.cfg);
const batch=load("sanofi43:nextBatchId");if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error("BATCH_ID");
const run=h.cfg.root+"/"+batch;store("sanofi43:refreshCurrentRun",run);store("sanofi43:refreshCurrentBatch",batch);store("sanofi43:cloudPilotPublishRequest",null);store("sanofi43:cloudPilotPendingRequest",null);
await h.save(run+"/candidate-readback.json",raw);await h.save(run+"/source-due-readback.json",due);await h.save(run+"/bootstrap.json",{schemaVersion:1,checkedAt:new Date(row.checkedAt).toISOString(),candidateRows:row.candidateRows,batchId:batch,independentValidation:load('sanofi43:currentIndependentValidationInput'),...(load('sanofi43:currentCaptureInput')?{currentCapture:load('sanofi43:currentCaptureInput')}:{})});const boot=await h.readFile(run+"/bootstrap.json");

const preflight="env TSX_DISABLE_CACHE=1 node "+h.q("/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/sanofi43/runtime/preflight/preflight-launch.mjs")+" check "+h.q(h.cfg.root+"/host-config.json")+" "+h.q(h.cfg.root+"/control-base.json")+" "+h.q(run+"/bootstrap.json")+" "+h.q(boot.hash)+" "+h.q(run);
const checked=await h.cmd(preflight,2000);notify({phase:"B_STARTUP_PREFLIGHT",checked});
if(Date.now()-new Date(row.checkedAt).getTime()>60000)throw Error("FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH");
const command="env TSX_DISABLE_CACHE=1 JOBFINDER_CLOUD_SOURCE_ID="+h.q(h.cfg.sourceId)+" P0_SOURCE_HTTP_TIMEOUT_MS=45000 node scripts/run-with-http-diagnostics.mjs "+h.q(run+"/diagnostics")+" 1800000 -- node --max-old-space-size=256 --import /workspace/scratch/5e9614251709/sanofi-sql-recheck-20261004/candidate/node_modules/tsx/dist/loader.mjs scripts/p0-cloud-source-pilot.ts "+h.q(run+"/bootstrap.json")+" "+h.q(boot.hash)+" "+h.q(run+"/artifacts")+" "+h.q(run+"/relay")+" --db-started-control "+h.q(h.cfg.root+"/control-base.json");
await h.save(run+"/reviewed-command.txt",command);
const started=await tools.exec_command({cmd:command,workdir:h.cfg.repo,yield_time_ms:1000,max_output_tokens:1500});store("sanofi43:refreshSession",started.session_id);notify({phase:"FRESH_B_SOURCE_LAUNCH",batch,session:started.session_id,output:started.output});if(!started.session_id)throw Error("NO_RUNNING_LAUNCH_SESSION");
await new A(load("sanofi43:continuousPortableRelayCodeWithPoll"))();

