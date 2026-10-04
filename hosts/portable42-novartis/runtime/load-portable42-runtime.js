// functions.exec AsyncFunction parameter: sourceKey. Local load only, no launch.
const A=Object.getPrototypeOf(async function(){}).constructor;
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const base="/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/portable42-novartis";
const selections={novartis:'source-novartis-social'};
if(!Object.hasOwn(selections,sourceKey))throw Error('PORTABLE42_SOURCE_SELECTION');
const result=await tools.exec_command({cmd:"python3 - "+q(base+"/runtime")+" <<'PY'\nfrom pathlib import Path\nimport json,sys\np=Path(sys.argv[1]);print(json.dumps({n:(p/n).read_text() for n in ['load-host-state.js','start-monitor-portable42.js','continuous-relay-v3-durable-monitor.js']}))\nPY",max_output_tokens:18000});
if(result.exit_code!==0||result.session_id)throw Error('PORTABLE42_RUNTIME_READ_FAILED');
const files=JSON.parse(result.output);
const loaded=await new A('root','sourceId','candidateId','commit',files['load-host-state.js'])(base+'/'+sourceKey,selections[sourceKey],"dot-cloud-restored-fb0b8e3-20261004","fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d");
store('continuousPortableRelayCodeWithPoll',files['continuous-relay-v3-durable-monitor.js']);
store('restoredPortableSourceStartCode',files['start-monitor-portable42.js']);
store('portable42SourceKey',sourceKey);
// Portable bootstrap has a strict four-field schema and uses no worker-capture descriptors.
store('currentIndependentValidationInput',null);
store('currentCaptureInput',null);
store('currentRetainedCaptureInput',null);
text({...loaded,status:'LOCAL_HOST_LOADED_NO_LAUNCH',publicationMode:'DB_STARTED_OWNER_V1',sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1'});
