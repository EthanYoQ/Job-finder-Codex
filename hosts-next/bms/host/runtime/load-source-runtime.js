if(sourceKey!=="bms")throw Error("RESTORED46_SOURCE_SELECTION");
// functions.exec fragment: safe local load only; this does not start the producer.
const A=Object.getPrototypeOf(async function(){}).constructor;
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const runtime="/workspace/scratch/5e9614251709/jb-workspace-recovery-20261006T1136Z/hosts-next/bms/host/runtime";
const result=await tools.exec_command({cmd:"python3 - "+q(runtime)+" <<'PY'\nfrom pathlib import Path\nimport json,sys\np=Path(sys.argv[1]);print(json.dumps({n:(p/n).read_text() for n in ['load-host-state.js','../../supervision/start-monitor-bms47b-combined.js','continuous-relay-v3-durable-monitor.js','complete-reviewed-source-readback.js','../activation.json']}))\nPY",max_output_tokens:18000});
if(result.exit_code!==0||result.session_id)throw Error('RESTORED_HOST_READ_FAILED');
const files=JSON.parse(result.output);
const binding=JSON.parse(files["../activation.json"]);
if(binding.status!=="REGISTERED_VERIFIED"||!binding.candidate)throw Error("CANDIDATE_NOT_REGISTERED");
const loaded=await new A('root','sourceId','candidateId','commit',files['load-host-state.js'])("/workspace/scratch/5e9614251709/jb-workspace-recovery-20261006T1136Z/hosts-next/bms/host",'source-bms-china-social',binding.candidate.id,binding.build.commitSha);
store('deadlineCandidate47b:bms:continuousPortableRelayCodeWithPoll',files['continuous-relay-v3-durable-monitor.js']);
store('deadlineCandidate47b:bms:completeReviewedSourceCode',files['complete-reviewed-source-readback.js']);
store('deadlineCandidate47b:bms:restoredPortableSourceStartCode',files['../../supervision/start-monitor-bms47b-combined.js']);
store('deadlineCandidate47b:bms:currentIndependentValidationInput',null);store('deadlineCandidate47b:bms:currentCaptureInput',null);store('deadlineCandidate47b:bms:nextBatchId',null);
store('deadlineCandidate47b:bms:currentRetainedCaptureInput',null);
text({...loaded,status:'LOCAL_HOST_LOADED_NO_LAUNCH',publicationMode:'DB_STARTED_OWNER_V1'});
