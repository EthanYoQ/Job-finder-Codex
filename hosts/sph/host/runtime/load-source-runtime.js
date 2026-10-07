if(sourceKey!=="sph")throw Error("RESTORED46_SOURCE_SELECTION");
// functions.exec fragment: safe local load only; this does not start the producer.
const A=Object.getPrototypeOf(async function(){}).constructor;
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const runtime="/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/hosts/sph/host/runtime";
const result=await tools.exec_command({cmd:"python3 - "+q(runtime)+" <<'PY'\nfrom pathlib import Path\nimport json,sys,hashlib\np=Path(sys.argv[1]);print(json.dumps({'__loaderSha256':hashlib.sha256((p/'load-host-state.js').read_bytes()).hexdigest(),'__starterSha256':hashlib.sha256((p/'../../supervision/start-monitor-sph51-combined.js').read_bytes()).hexdigest(),**{n:(p/n).read_text() for n in ['load-host-state.js','../../supervision/start-monitor-sph51-combined.js','continuous-relay-v3-durable-monitor.js','complete-reviewed-source-readback.js','../activation.json']}}))\nPY",max_output_tokens:18000});
if(result.exit_code!==0||result.session_id)throw Error('RESTORED_HOST_READ_FAILED');
const files=JSON.parse(result.output);
const binding=JSON.parse(files["../activation.json"]);
if(binding.status!=="REGISTERED_VERIFIED"||!binding.candidate)throw Error("CANDIDATE_NOT_REGISTERED");
if(binding.loaderSha256!==files.__loaderSha256)throw Error("HOST_LOADER_PIN_MISMATCH");
if(binding.starterSha256!==files.__starterSha256)throw Error("HOST_STARTER_PIN_MISMATCH");
const loaded=await new A('root','sourceId','candidateId','commit',files['load-host-state.js'])("/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/hosts/sph/host",'source-shanghai-pharma-social',binding.candidate.id,binding.build.commitSha);
store('proxyNode22:sph:continuousPortableRelayCodeWithPoll',files['continuous-relay-v3-durable-monitor.js']);
store('proxyNode22:sph:completeReviewedSourceCode',files['complete-reviewed-source-readback.js']);
store('proxyNode22:sph:restoredPortableSourceStartCode',files['../../supervision/start-monitor-sph51-combined.js']);
store('proxyNode22:sph:currentIndependentValidationInput',null);store('proxyNode22:sph:currentCaptureInput',null);store('proxyNode22:sph:nextBatchId',null);
store('proxyNode22:sph:currentRetainedCaptureInput',null);
text({...loaded,status:'LOCAL_HOST_LOADED_NO_LAUNCH',publicationMode:'DB_STARTED_JOB_PROJECTION_DELTA_V1'});
