// Reconstructed from the recovered R3 binding contract/tests, not recovered original loader bytes.
// functions.exec AsyncFunction parameters: root, sourceId, candidateId, commit.
// Read and validate every binding before replacing any session state.
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const expectedRoot="/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/hosts/roche/host",expectedRepo="/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/producer",expectedBuild={"schemaVersion":2,"commitSha":"28402a299bb04cbf5873da66c2fe8ca76827c0d1","sourceTreeSha256":"114011f4dedc6de630200fb12ab9a2177b91b575ff7843fbe3d7d36c9683ace6","runtimeTreeSha256":"26beba5064ba95e0e916ee4e7d38c9e9a30b23d64ff7d50d9840e430c7ce893a","contentSha256":"6651fbf50b53f2c5666135935300c3c479112d898beed9b354a057d4591a1d4d"};
const expectedDatabaseIdentity=null; // OWNER_DATABASE_BINDING
const expectedCandidate=null; // OWNER_CANDIDATE_BINDING
const expectedSourceId="source-roche-china-social",expectedHash="d0e8002bbc03e3da46bbb02c30b533b5b968f38ac5db2c357c009de2eb4066ed";
if(root!==expectedRoot||sourceId!==expectedSourceId||typeof candidateId!=="string"||!/^[-A-Za-z0-9._]{1,100}$/.test(candidateId)||candidateId==="dot-cloud-restored-fb0b8e3-20261005T2028Z"||commit!==expectedBuild.commitSha)throw Error("HOST_LOAD_ARGUMENT");
if(expectedCandidate===null||expectedDatabaseIdentity===null)throw Error('HOST_OWNER_BINDING_REQUIRED');
if(candidateId!==expectedCandidate.id)throw Error('HOST_CANDIDATE_ID_MISMATCH');
const command="python3 - "+q(root)+" <<'PY'\nfrom pathlib import Path\nimport json,sys\np=Path(sys.argv[1]);assert p.resolve()==p and p.is_dir()\nimport hashlib\nprint(json.dumps({**{k:(p/k).read_text() for k in ['host-config.json','control-base.json','activation.json','machine-json.js','host-helper-functions.js','host-stage-functions.js','context-read.sql']},'__contextReadSha256':hashlib.sha256((p/'context-read.sql').read_bytes()).hexdigest()}))\nPY";
const result=await tools.exec_command({cmd:command,max_output_tokens:18000});
if(result.exit_code!==0||result.session_id)throw Error("HOST_LOAD_READ_FAILED");
const files=JSON.parse(result.output),cfg=JSON.parse(files['host-config.json']),control=JSON.parse(files['control-base.json']),binding=JSON.parse(files['activation.json']);
if(binding.status!=="REGISTERED_VERIFIED"||!binding.candidate||!Number.isSafeInteger(binding.candidate.version)||binding.candidate.version!==51||binding.candidate.id!=="dot-cloud-delta-proxy-28402a29-20261007")throw Error("CANDIDATE_NOT_REGISTERED");
const exact=(a,b)=>a&&b&&Object.keys(a).sort().join(',')===Object.keys(b).sort().join(',')&&Object.keys(b).every(k=>a[k]===b[k]);
if(!exact(binding.candidate,expectedCandidate)||!exact(control.candidate,expectedCandidate))throw Error('HOST_CANDIDATE_IDENTITY_MISMATCH');
if(binding.contextReadSha256!==files.__contextReadSha256)throw Error('HOST_CONTEXT_COMPILER_BINDING_MISMATCH');
if(!exact(control.databaseIdentity,expectedDatabaseIdentity)||!exact(binding.databaseIdentity,expectedDatabaseIdentity))throw Error('HOST_DATABASE_IDENTITY_MISMATCH');
if(!exact(control.build,expectedBuild)||!exact(binding.build,expectedBuild))throw Error("HOST_LOCAL_BUILD_BINDING_MISMATCH");
if(cfg.root!==expectedRoot||cfg.repo!==expectedRepo||cfg.node!=="/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/runtime/node-v22.23.3-linux-x64/bin/node"||cfg.project!=="yiopvxysxrtrnvqxwgbx"||cfg.sourceId!==expectedSourceId||cfg.sourceConfigSha256!==expectedHash||control.projectId!==cfg.project||!exact(control.candidate,binding.candidate)||binding.candidate.id!==candidateId||binding.candidate.goalId!=="jobfinder-portable-required-40"||control.build.commitSha!==commit)throw Error("HOST_LOAD_BINDING_MISMATCH");
if(!files['host-helper-functions.js'].includes('JOBFINDER_CLOUD_SOURCE_ID='+sourceId+' ')||!files['host-stage-functions.js'].includes('r.payload.sourceId!=="'+sourceId+'"')||!files['host-stage-functions.js'].includes('r.payload.sourceConfigSha256!=="'+cfg.sourceConfigSha256+'"'))throw Error("HOST_LOAD_HELPER_SCOPE_MISMATCH");
const inspected=await tools.exec_command({cmd:'env JOBFINDER_CLOUD_SOURCE_ID='+q(cfg.sourceId)+' '+q(cfg.node)+' --import '+q(cfg.repo+'/node_modules/tsx/dist/loader.mjs')+' '+q(cfg.root+'/runtime/inspect-host-binding.mts'),workdir:cfg.repo,max_output_tokens:4000});
if(inspected.exit_code!==0||inspected.session_id)throw Error('HOST_EXECUTING_RUNTIME_BINDING');
const parseMachineJson=new Function('output','record',files['machine-json.js']);
const proof=parseMachineJson(inspected.output,diagnostic=>notify({phase:'HOST_RUNTIME_MACHINE_JSON_DIAGNOSTIC',...diagnostic}));
if(!exact(proof.build,expectedBuild)||!exact(proof.candidate,binding.candidate)||proof.contextReadSha256!==files.__contextReadSha256)throw Error('HOST_CONTEXT_COMPILER_BINDING_MISMATCH');
store('proxyNode22:roche:cloudPilotMachineJson',files['machine-json.js']);
store('proxyNode22:roche:cloudPilotHostConfig',cfg);
store('proxyNode22:roche:cloudPilotHostHelpers',files['host-helper-functions.js']);
store('proxyNode22:roche:cloudPilotHostStages',files['host-stage-functions.js']);
store('proxyNode22:roche:registeredCandidateBinding',binding);
return {sourceId,candidateId,commit,root};
