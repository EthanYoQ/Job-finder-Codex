// functions.exec fragment: safe local load only; this does not start the producer.
const A=Object.getPrototypeOf(async function(){}).constructor;
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const runtime="/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/bayer42/runtime";
const result=await tools.exec_command({cmd:"python3 - "+q(runtime)+" <<'PY'\nfrom pathlib import Path\nimport json,sys\np=Path(sys.argv[1]);print(json.dumps({n:(p/n).read_text() for n in ['load-host-state.js','start-monitor-bayer42.js','continuous-relay-v3-durable-monitor.js']}))\nPY",max_output_tokens:18000});
if(result.exit_code!==0||result.session_id)throw Error('RESTORED_HOST_READ_FAILED');
const files=JSON.parse(result.output);
const loaded=await new A('root','sourceId','candidateId','commit',files['load-host-state.js'])("/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/bayer42",'source-bayer-healthcare-social',"dot-cloud-restored-fb0b8e3-20261004","fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d");
store('bayer42:continuousPortableRelayCodeWithPoll',files['continuous-relay-v3-durable-monitor.js']);
store('bayer42:restoredBSourceStartCode',files['start-monitor-bayer42.js']);
store('bayer42:currentIndependentValidationInput',null);store('bayer42:currentCaptureInput',null);store('bayer42:nextBatchId',null);
text({...loaded,status:'LOCAL_HOST_LOADED_NO_LAUNCH',publicationMode:'DB_STARTED_OWNER_V1'});
