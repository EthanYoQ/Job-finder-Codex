// functions.exec fragment: safe local load only; this does not start the producer.
const A=Object.getPrototypeOf(async function(){}).constructor;
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const runtime="/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/sanofi43/runtime";
const result=await tools.exec_command({cmd:"python3 - "+q(runtime)+" <<'PY'\nfrom pathlib import Path\nimport json,sys\np=Path(sys.argv[1]);print(json.dumps({n:(p/n).read_text() for n in ['load-host-state.js','start-monitor-sanofi43.js','continuous-relay-v3-durable-monitor.js']}))\nPY",max_output_tokens:18000});
if(result.exit_code!==0||result.session_id)throw Error('RESTORED_HOST_READ_FAILED');
const files=JSON.parse(result.output);
const loaded=await new A('root','sourceId','candidateId','commit',files['load-host-state.js'])("/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/sanofi43",'source-sanofi-china-social',"dot-cloud-sanofi-cn-d402d36-20261004","d402d3639c0ea729fa72bd1a4427570b227c7481");
store('sanofi43:continuousPortableRelayCodeWithPoll',files['continuous-relay-v3-durable-monitor.js']);
store('sanofi43:restoredBSourceStartCode',files['start-monitor-sanofi43.js']);
store('sanofi43:currentIndependentValidationInput',null);store('sanofi43:currentCaptureInput',null);store('sanofi43:nextBatchId',null);
text({...loaded,status:'LOCAL_HOST_LOADED_NO_LAUNCH',publicationMode:'DB_STARTED_OWNER_V1'});
