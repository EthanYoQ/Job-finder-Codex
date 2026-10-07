const expectedCandidate=null; // OWNER_CANDIDATE_BINDING
if(expectedCandidate===null)throw Error("HOST_OWNER_BINDING_REQUIRED");

const A=Object.getPrototypeOf(async function(){}).constructor;const h=await new A(load("proxyNode22:hengrui:cloudPilotHostHelpers"))();
if(h.cfg.sourceId!=="source-hengrui-social")throw Error("SOURCE_SCOPE");
const binding=load("proxyNode22:hengrui:registeredCandidateBinding");
if(binding?.status!=="REGISTERED_VERIFIED"||binding.build?.commitSha!=="28402a299bb04cbf5873da66c2fe8ca76827c0d1"||!binding.candidate||typeof binding.candidate.id!=="string"||!Number.isSafeInteger(binding.candidate.version)||binding.candidate.version!==51||binding.candidate.id!=="dot-cloud-delta-proxy-28402a29-20261007")throw Error("CANDIDATE_NOT_REGISTERED");
if(binding.candidate.id!==expectedCandidate.id||binding.candidate.version!==expectedCandidate.version||binding.candidate.goalId!==expectedCandidate.goalId)throw Error("HOST_CANDIDATE_IDENTITY_MISMATCH");
const query=`WITH latest_successful AS (
 SELECT s.id AS "sourceResultId",s."sourceId",s."batchId",s."releaseCandidateId",s."sourceConfigHash",s."startedAt",s."finishedAt"
 FROM public."CrawlBatchSourceResult" s JOIN public."CrawlBatch" b ON b.id=s."batchId" AND b."releaseCandidateId"=s."releaseCandidateId"
 WHERE s."sourceId"=${h.q(h.cfg.sourceId)} AND s."atomicCommitState"='COMMITTED' AND s."completenessState"='VERIFIED'
 AND b.status='SUCCESS' AND b.kind<>'MANUAL_SOURCE'
 ORDER BY s."finishedAt" DESC,s.id DESC LIMIT 1
)
SELECT clock_timestamp() AS "checkedAt",
 (SELECT jsonb_agg(to_jsonb(r)) FROM public."ReleaseCandidate" r WHERE id=${h.q(binding.candidate.id)}) AS "candidateRows",
 (SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS "holderId",
 (SELECT to_jsonb(s)||jsonb_build_object('observations',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',o.id,'sourceResultId',o."sourceResultId",'sourceId',o."sourceId",'batchId',o."batchId",'releaseCandidateId',o."releaseCandidateId",'sourceConfigSha256',o."sourceConfigSha256",
   'crawledAt',o."crawledAt",'observedFrom',o."observedFrom",'observedTo',o."observedTo",'successful',o.successful,
   'transportSucceeded',o."transportSucceeded",'adapterSucceeded',o."adapterSucceeded",'completenessVerified',o."completenessVerified",'atomicCommitSucceeded',o."atomicCommitSucceeded") ORDER BY o.id)
   FROM public."CrawlObservation" o WHERE o."sourceResultId"=s."sourceResultId" AND o."sourceId"=s."sourceId" AND o."batchId"=s."batchId" AND o."releaseCandidateId"=s."releaseCandidateId"),'[]'::jsonb)) FROM latest_successful s) AS "latestSuccessfulSource";`;
const raw=await tools.mcp__codex_apps__supabase_execute_sql({project_id:h.cfg.project,query});const row=h.rows(raw)[0];if(!row||row.holderId!==""||row.candidateRows?.length!==1||row.candidateRows[0].commitSha!==binding.build.commitSha||row.candidateRows[0].id!==binding.candidate.id||row.candidateRows[0].version!==binding.candidate.version||row.candidateRows[0].goalId!==binding.candidate.goalId)throw Error("FRESH_CANDIDATE_PRECONDITION");
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
const batch=load("proxyNode22:hengrui:nextBatchId");if(typeof batch!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error("BATCH_ID");
const run=h.cfg.root+"/"+batch;store("proxyNode22:hengrui:refreshCurrentRun",run);store("proxyNode22:hengrui:refreshCurrentBatch",batch);store("proxyNode22:hengrui:cloudPilotPublishRequest",null);store("proxyNode22:hengrui:cloudPilotPendingRequest",null);
await h.save(run+"/candidate-readback.json",raw);await h.save(run+"/source-due-readback.json",due);await h.save(run+"/bootstrap.json",{schemaVersion:1,checkedAt:new Date(row.checkedAt).toISOString(),candidateRows:row.candidateRows,batchId:batch});const boot=await h.readFile(run+"/bootstrap.json");

const preflight="env TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 /workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node "+h.q("/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/hosts/hengrui/host/runtime/preflight/preflight-launch.mjs")+" check "+h.q(h.cfg.root+"/host-config.json")+" "+h.q(h.cfg.root+"/control-base.json")+" "+h.q(run+"/bootstrap.json")+" "+h.q(boot.hash)+" "+h.q(run);
const checked=await h.cmd(preflight,2000);notify({phase:"PORTABLE_DB_STARTED_PREFLIGHT",checked});
if(Date.now()-new Date(row.checkedAt).getTime()>60000)throw Error("FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH");
const command="env PATH=/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin:\"$PATH\" TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 JOBFINDER_CLOUD_SOURCE_ID="+h.q(h.cfg.sourceId)+" P0_SOURCE_HTTP_TIMEOUT_MS=45000 /workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node scripts/run-with-http-diagnostics.mjs "+h.q(run+"/diagnostics")+" 1800000 -- /workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node --max-old-space-size=384 --import /workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/node_modules/tsx/dist/loader.mjs scripts/p0-cloud-portable-source-pilot.ts "+h.q(run+"/bootstrap.json")+" "+h.q(boot.hash)+" "+h.q(run+"/artifacts")+" "+h.q(run+"/relay")+" --db-started-control "+h.q(h.cfg.root+"/control-base.json");
await h.save(run+"/reviewed-command.txt",command);
// BEGIN COMBINED_MEMORY_CANCEL_PROPOSAL
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
function buildCombinedCommand(command, metadata, quote) {
  const seam = ' '+metadata.nodePath+' scripts/run-with-http-diagnostics.mjs ';
  const parts = command.split(seam);
  if (parts.length !== 2 || !parts[0].startsWith('env ') || !parts[1]) throw Error('ORIGINAL_WRAPPER_SEAM_REQUIRED');
  if (!/^jb-[a-f0-9]{64}$/.test(metadata.controlRunId)) throw Error('FULL_BATCH_HASH_REQUIRED');
  const captureCommand = parts[0] + ' ' + quote(metadata.nodePath) + ' ' + quote(metadata.supervisorPath)
    + ' start ' + quote(metadata.controlDirectory) + ' ' + quote(metadata.controlRunId)
    + ' -- ' + quote(metadata.nodePath) + ' ' + quote(metadata.wrapperPath) + ' ' + parts[1];
  return { captureCommand, observedCommand: buildObservedCommand(captureCommand, {
    samplerPath: metadata.samplerPath, expectedArg: metadata.supervisorPath,
    outputDir: metadata.outputDir, label: metadata.label
  }, quote), originalEnvironmentPrefix: parts[0], originalWrapperArgumentSuffix: parts[1] };
}
const combinedPaths={"base":"/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/hosts/hengrui/supervision","r2":"/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z","sampler":"/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/hosts/hengrui/supervision/sample_process_tree.py","supervisor":"/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/hosts/hengrui/supervision/supervise-cancel.mjs","inspector":"/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/hosts/hengrui/supervision/inspect-launch-identity.mjs","wrapper":"/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/scripts/run-with-http-diagnostics.mjs","original":"/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/hosts/hengrui/supervision/start-monitor-hengrui51-combined.js"};
const combinedHashes=await tools.exec_command({cmd:"sha256sum -- "+[combinedPaths.sampler,combinedPaths.supervisor,combinedPaths.wrapper,combinedPaths.inspector].map(h.q).join(" "),yield_time_ms:1000,max_output_tokens:1500});
if(combinedHashes.exit_code!==0||combinedHashes.session_id||combinedHashes.output.trim()!=="3fa6daa1af1afee94d19801edfd8bcb538e1243476b5adb253e50de162a27bd6  /workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/hosts/hengrui/supervision/sample_process_tree.py\n083435a5344a47b86f84184bbe1d2711b0d35def4670afb2ab3c8391ed442e7e  /workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/hosts/hengrui/supervision/supervise-cancel.mjs\nf15522e6f209bfe99bfa258b5dffbce1f74d6af662c4c2ee682604e0798bbc88  /workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/scripts/run-with-http-diagnostics.mjs\n7bc818ae831081b7e91819ad772b950d08e7d06dc741730c0bd54698d6fe8b37  /workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/hosts/hengrui/supervision/inspect-launch-identity.mjs")throw Error("COMBINED_SOURCE_HASH_MISMATCH");
const combinedIdentityCheck=await tools.exec_command({cmd:"/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node --import /workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer/node_modules/tsx/dist/loader.mjs "+h.q(combinedPaths.inspector)+" "+h.q(batch),workdir:h.cfg.repo,yield_time_ms:1000,max_output_tokens:1500});
if(combinedIdentityCheck.exit_code!==0||combinedIdentityCheck.session_id)throw Error("COMBINED_NORMALIZATION_CHECK");
const combinedIdentity=h.machineJson(combinedIdentityCheck.output);
if(combinedIdentity.cwd!==h.cfg.repo||combinedIdentity.cwdRealPath!==h.cfg.repo||combinedIdentity.wrapperPath!==combinedPaths.wrapper||combinedIdentity.wrapperRealPath!==combinedPaths.wrapper||combinedIdentity.nodePath!==combinedIdentity.nodeRealPath||combinedIdentity.nodePath!=="/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node")throw Error("COMBINED_NORMALIZATION_MISMATCH");
const combinedMetadata={nodePath:combinedIdentity.nodePath,supervisorPath:combinedPaths.supervisor,wrapperPath:combinedPaths.wrapper,samplerPath:combinedPaths.sampler,controlDirectory:run+"/cancel-control",controlRunId:combinedIdentity.controlRunId,outputDir:run+"/memory-observation",label:h.cfg.sourceId+"/"+batch+"/includes-supervisor"};
const combined=buildCombinedCommand(command,combinedMetadata,h.q);
await h.save(run+"/reviewed-combined-command.txt",combined.observedCommand);
await h.save(run+"/reviewed-cancel-contract.json",{status:"PREPARED_REQUEST_NOT_SENT",originalBatch:batch,controlDirectory:combinedMetadata.controlDirectory,controlRunId:combinedMetadata.controlRunId,nodeNormalization:{original:"/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node",resolved:combinedIdentity.nodePath},wrapperNormalization:{original:"scripts/run-with-http-diagnostics.mjs",resolved:combinedPaths.wrapper},samplerExpectedArg:combinedPaths.supervisor,memoryScope:"Supervisor root, unchanged wrapper and observed descendants; sampler excluded",requestCommand:h.q(combinedIdentity.nodePath)+" "+h.q(combinedPaths.supervisor)+" request "+h.q(combinedMetadata.controlDirectory)+" "+h.q(combinedMetadata.controlRunId)});
{const combinedBootstrapAge=Date.now()-new Date(row.checkedAt).getTime();if(!Number.isFinite(combinedBootstrapAge)||combinedBootstrapAge<0||combinedBootstrapAge>60000)throw Error("FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH");}
// END COMBINED_MEMORY_CANCEL_PROPOSAL
store("proxyNode22:hengrui:refreshSession",null);
const started=await tools.exec_command({cmd:combined.observedCommand,workdir:h.cfg.repo,yield_time_ms:1000,max_output_tokens:1500});
// Retain the full original tool result before checking a possibly absent session.
// Early wrapper/supervisor exits must remain inspectable, including nonzero exits.
const startedSnapshot=JSON.parse(JSON.stringify(started));
store("proxyNode22:hengrui:refreshLaunchToolResult",startedSnapshot);
await h.save(run+"/original-launch-exec-tool-result.json",startedSnapshot);
notify({phase:"FRESH_PORTABLE_DB_STARTED_LAUNCH",batch,started:startedSnapshot});
if(!started.session_id)throw Error("NO_RUNNING_LAUNCH_SESSION");
store("proxyNode22:hengrui:refreshSession",started.session_id);
await new A(load("proxyNode22:hengrui:continuousPortableRelayCodeWithPoll"))();

