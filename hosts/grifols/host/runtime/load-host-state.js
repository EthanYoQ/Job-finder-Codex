// Reconstructed from the recovered R3 binding contract/tests, not recovered original loader bytes.
// functions.exec AsyncFunction parameters: root, sourceId, candidateId, commit.
// Read and validate every binding before replacing any session state.
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const expectedRoot="/workspace/scratch/5e9614251709/jb-incremental-producer-runtime-20261007T0036Z/hosts/grifols/host",expectedRepo="/workspace/scratch/5e9614251709/jb-incremental-producer-runtime-20261007T0036Z/producer",expectedBuild={"schemaVersion": 2, "commitSha": "dfd22f642469888eb781f5e7b93964a60e082ca0", "sourceTreeSha256": "ca192f62e3d45cf0d649a5e0616b414ddb79435ed4fdfa899283483f972dc57e", "runtimeTreeSha256": "5a8a5d923a0a30d6c72e19185efd1516e0bebc4d766ca10e16849b6e079793f7", "contentSha256": "3aa0f07035184721e7dc03c80253e1c60e3fb05572861f4280c63765ad0d82f7"};
const expectedSourceId="source-grifols-china-social",expectedHash="614ac95db03986792bf1a42a856a403e747165f1b3a94d8588d49f2016c522c7";
if(root!==expectedRoot||sourceId!==expectedSourceId||typeof candidateId!=="string"||!/^[-A-Za-z0-9._]{1,100}$/.test(candidateId)||candidateId==="dot-cloud-restored-fb0b8e3-20261005T2028Z"||commit!==expectedBuild.commitSha)throw Error("HOST_LOAD_ARGUMENT");
const command="python3 - "+q(root)+" <<'PY'\nfrom pathlib import Path\nimport json,sys\np=Path(sys.argv[1]);assert p.resolve()==p and p.is_dir()\nimport hashlib\nprint(json.dumps({**{k:(p/k).read_text() for k in ['host-config.json','control-base.json','activation.json','host-helper-functions.js','host-stage-functions.js','context-read.sql']},'__contextReadSha256':hashlib.sha256((p/'context-read.sql').read_bytes()).hexdigest()}))\nPY";
const result=await tools.exec_command({cmd:command,max_output_tokens:18000});
if(result.exit_code!==0||result.session_id)throw Error("HOST_LOAD_READ_FAILED");
const files=JSON.parse(result.output),cfg=JSON.parse(files['host-config.json']),control=JSON.parse(files['control-base.json']),binding=JSON.parse(files['activation.json']);
if(binding.status!=="REGISTERED_VERIFIED"||!binding.candidate||!Number.isSafeInteger(binding.candidate.version)||binding.candidate.version<=49)throw Error("CANDIDATE_NOT_REGISTERED");
const exact=(a,b)=>a&&b&&Object.keys(a).sort().join(',')===Object.keys(b).sort().join(',')&&Object.keys(b).every(k=>a[k]===b[k]);
const expectedDatabaseIdentity={"migrationVersion": "20261006172300_job_projection_delta_contract", "schemaHash": "91ac87fa179ae06c7441141601fd106c5cb636ab739351d5722bed5de151dc3a", "dbSnapshotHash": "49d46d31c07713bbe8f7041ef669312a699737088fd31e52b97a13eea84060f0"};
if(files.__contextReadSha256!=="281280d4d59e04858538cd400b4546c45bc6c5288351bcb5d413b4ac81d51e71"||binding.contextReadSha256!==files.__contextReadSha256)throw Error('HOST_CONTEXT_COMPILER_BINDING_MISMATCH');
if(!exact(control.databaseIdentity,expectedDatabaseIdentity)||!exact(binding.databaseIdentity,expectedDatabaseIdentity))throw Error('HOST_DATABASE_IDENTITY_MISMATCH');
if(!exact(control.build,expectedBuild)||!exact(binding.build,expectedBuild))throw Error("HOST_LOCAL_BUILD_BINDING_MISMATCH");
if(cfg.root!==expectedRoot||cfg.repo!==expectedRepo||cfg.project!=="yiopvxysxrtrnvqxwgbx"||cfg.sourceId!==expectedSourceId||cfg.sourceConfigSha256!==expectedHash||control.projectId!==cfg.project||!exact(control.candidate,binding.candidate)||binding.candidate.id!==candidateId||binding.candidate.goalId!=="jobfinder-portable-required-40"||control.build.commitSha!==commit)throw Error("HOST_LOAD_BINDING_MISMATCH");
if(!files['host-helper-functions.js'].includes('JOBFINDER_CLOUD_SOURCE_ID='+sourceId+' ')||!files['host-stage-functions.js'].includes('r.payload.sourceId!=="'+sourceId+'"')||!files['host-stage-functions.js'].includes('r.payload.sourceConfigSha256!=="'+cfg.sourceConfigSha256+'"'))throw Error("HOST_LOAD_HELPER_SCOPE_MISMATCH");
store('incrementalDfd22f64:grifols:cloudPilotHostConfig',cfg);
store('incrementalDfd22f64:grifols:cloudPilotHostHelpers',files['host-helper-functions.js']);
store('incrementalDfd22f64:grifols:cloudPilotHostStages',files['host-stage-functions.js']);
store('incrementalDfd22f64:grifols:registeredCandidateBinding',binding);
return {sourceId,candidateId,commit,root};
