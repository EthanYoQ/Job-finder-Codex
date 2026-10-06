
const A=Object.getPrototypeOf(async function(){}).constructor;const h=await new A(load("restored46:kelun:cloudPilotHostHelpers"))();
if(h.cfg.sourceId!=="source-kelun-social")throw Error("SOURCE_SCOPE");
const query=`WITH latest_successful AS (
 SELECT s.id AS "sourceResultId",s."sourceId",s."batchId",s."releaseCandidateId",s."sourceConfigHash",s."startedAt",s."finishedAt"
 FROM public."CrawlBatchSourceResult" s JOIN public."CrawlBatch" b ON b.id=s."batchId" AND b."releaseCandidateId"=s."releaseCandidateId"
 WHERE s."sourceId"=${h.q(h.cfg.sourceId)} AND s."atomicCommitState"='COMMITTED' AND s."completenessState"='VERIFIED'
 AND b.status='SUCCESS' AND b.kind<>'MANUAL_SOURCE'
 ORDER BY s."finishedAt" DESC,s.id DESC LIMIT 1
)
SELECT clock_timestamp() AS "checkedAt",
 (SELECT jsonb_agg(to_jsonb(r)) FROM public."ReleaseCandidate" r WHERE id='dot-cloud-restored-fb0b8e3-20261005T2028Z') AS "candidateRows",
 (SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS "holderId",
 (SELECT to_jsonb(s)||jsonb_build_object('observations',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',o.id,'sourceResultId',o."sourceResultId",'sourceId',o."sourceId",'batchId',o."batchId",'releaseCandidateId',o."releaseCandidateId",'sourceConfigSha256',o."sourceConfigSha256",
   'crawledAt',o."crawledAt",'observedFrom',o."observedFrom",'observedTo',o."observedTo",'successful',o.successful,
   'transportSucceeded',o."transportSucceeded",'adapterSucceeded',o."adapterSucceeded",'completenessVerified',o."completenessVerified",'atomicCommitSucceeded',o."atomicCommitSucceeded") ORDER BY o.id)
   FROM public."CrawlObservation" o WHERE o."sourceResultId"=s."sourceResultId" AND o."sourceId"=s."sourceId" AND o."batchId"=s."batchId" AND o."releaseCandidateId"=s."releaseCandidateId"),'[]'::jsonb)) FROM latest_successful s) AS "latestSuccessfulSource";`;
const raw=await tools.mcp__codex_apps__supabase_execute_sql({project_id:h.cfg.project,query});const row=h.rows(raw)[0];if(!row||row.holderId!==""||row.candidateRows?.length!==1||row.candidateRows[0].commitSha!=="fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d")throw Error("FRESH_CANDIDATE_PRECONDITION");
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
 if(!source||source.sourceId!==cfg.sourceId||source.sourceConfigHash!==cfg.sourceConfigSha256||!source.sourceResultId||!source.batchId||!source.releaseCandidateId||!Array.isArray(source.observations)||source.observations.length!==1)throw Error("SOURCE_DUE_OBSERVATION_REQUIRED");
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
const batch=load("restored46:kelun:nextBatchId");if(typeof batch!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error("BATCH_ID");
const run=h.cfg.root+"/"+batch;store("restored46:kelun:refreshCurrentRun",run);store("restored46:kelun:refreshCurrentBatch",batch);store("restored46:kelun:cloudPilotPublishRequest",null);store("restored46:kelun:cloudPilotPendingRequest",null);
await h.save(run+"/candidate-readback.json",raw);await h.save(run+"/source-due-readback.json",due);await h.save(run+"/bootstrap.json",{schemaVersion:1,checkedAt:new Date(row.checkedAt).toISOString(),candidateRows:row.candidateRows,batchId:batch});const boot=await h.readFile(run+"/bootstrap.json");

const preflight="env TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 node "+h.q("/workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/hosts46/kelun/runtime/preflight/preflight-launch.mjs")+" check "+h.q(h.cfg.root+"/host-config.json")+" "+h.q(h.cfg.root+"/control-base.json")+" "+h.q(run+"/bootstrap.json")+" "+h.q(boot.hash)+" "+h.q(run);
const checked=await h.cmd(preflight,2000);notify({phase:"PORTABLE_DB_STARTED_PREFLIGHT",checked});
if(Date.now()-new Date(row.checkedAt).getTime()>60000)throw Error("FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH");
const command="env TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 JOBFINDER_CLOUD_SOURCE_ID="+h.q(h.cfg.sourceId)+" P0_SOURCE_HTTP_TIMEOUT_MS=45000 node scripts/run-with-http-diagnostics.mjs "+h.q(run+"/diagnostics")+" 1800000 -- node --max-old-space-size=256 --import /workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/producer42/node_modules/tsx/dist/loader.mjs scripts/p0-cloud-portable-source-pilot.ts "+h.q(run+"/bootstrap.json")+" "+h.q(boot.hash)+" "+h.q(run+"/artifacts")+" "+h.q(run+"/relay")+" --db-started-control "+h.q(h.cfg.root+"/control-base.json");
await h.save(run+"/reviewed-command.txt",command);
// BEGIN EXTERNAL_MEMORY_OBSERVATION
function buildObservedCommand(command, metadata, quote) {
 return [
  '(exec '+command+') &',
  'capture_root_pid=$!',
  'if python3 '+quote(metadata.samplerPath)+' --root-pid "$capture_root_pid" --expected-arg '+quote(metadata.expectedArg)+' --output-dir '+quote(metadata.outputDir)+' --label '+quote(metadata.label)+' --interval 1 --pss-interval 5; then memory_observer_exit=0; else memory_observer_exit=$?; fi',
  'if wait "$capture_root_pid"; then capture_exit=0; else capture_exit=$?; fi',
  "printf 'MEMORY_OBSERVER_EXIT=%s CAPTURE_EXIT=%s\\n' \"$memory_observer_exit\" \"$capture_exit\"",
  'exit "$capture_exit"'
 ].join('\n');
}
const samplerPath="/workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/memory-observation-recovery-20261006T0536Z/sample_process_tree.py";
const samplerHashCheck=await tools.exec_command({cmd:"sha256sum -- "+h.q(samplerPath),yield_time_ms:1000,max_output_tokens:500});
if(samplerHashCheck.exit_code!==0||samplerHashCheck.session_id||samplerHashCheck.output.trim()!=="18bc3c99319b3af0941b6499bf71b5bfcd7d5808003a6b2c8e8a1a20eae88a85  /workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/memory-observation-recovery-20261006T0536Z/sample_process_tree.py")throw Error("MEMORY_SAMPLER_HASH_MISMATCH");
const observedCommand=buildObservedCommand(command,{samplerPath,expectedArg:"scripts/run-with-http-diagnostics.mjs",outputDir:run+"/memory-observation",label:h.cfg.sourceId+"/"+batch},h.q);
await h.save(run+"/reviewed-observer-command.txt",observedCommand);
{const observedBootstrapAge=Date.now()-new Date(row.checkedAt).getTime();if(!Number.isFinite(observedBootstrapAge)||observedBootstrapAge<0||observedBootstrapAge>60000)throw Error("FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH");}
// END EXTERNAL_MEMORY_OBSERVATION
const started=await tools.exec_command({cmd:observedCommand,workdir:h.cfg.repo,yield_time_ms:1000,max_output_tokens:1500});store("restored46:kelun:refreshSession",started.session_id);notify({phase:"FRESH_PORTABLE_DB_STARTED_LAUNCH",batch,session:started.session_id,output:started.output});if(!started.session_id)throw Error("NO_RUNNING_LAUNCH_SESSION");
await new A(load("restored46:kelun:continuousPortableRelayCodeWithPoll"))();

