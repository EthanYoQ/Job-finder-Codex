// Reconstructed from the recovered R3 binding contract/tests, not recovered original loader bytes.
// functions.exec AsyncFunction parameters: root, sourceId, candidateId, commit.
// Read and validate every binding before replacing any session state.
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const expectedRoot="/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/novartis-producer-runtime-0750Z/hosts/novartis-next/host",expectedRepo="/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/novartis-producer-runtime-0750Z/producer",expectedBuild={"schemaVersion":2,"commitSha":"0edb12df2ea9b466b25eb388eff1f230636bbd7e","sourceTreeSha256":"9bc3565d15b90c6c02c214e18123f0ced6e9b936ffb673734cb5b0045d21371d","runtimeTreeSha256":"8c3279add218c7234b15075c5eebdfcf7e0d77dc81e17e4990e90b3d9c3ddb24","contentSha256":"84cc8906e37dc41165e88e0de8118342f414c88b7712cd80d2644ce3bc257a98"};
const expectedDatabaseIdentity=null; // OWNER_DATABASE_BINDING
const expectedCandidate=null; // OWNER_CANDIDATE_BINDING
const expectedSourceId="source-novartis-social",expectedHash="1dcb83b63182c3b496a1137678baae55201276b4e041b60b6cbe1fab30990a91";
if(root!==expectedRoot||sourceId!==expectedSourceId||typeof candidateId!=="string"||!/^[-A-Za-z0-9._]{1,100}$/.test(candidateId)||candidateId==="dot-cloud-restored-fb0b8e3-20261005T2028Z"||commit!==expectedBuild.commitSha)throw Error("HOST_LOAD_ARGUMENT");
if(expectedCandidate===null||expectedDatabaseIdentity===null)throw Error('HOST_OWNER_BINDING_REQUIRED');
if(candidateId!==expectedCandidate.id)throw Error('HOST_CANDIDATE_ID_MISMATCH');
const command="python3 - "+q(root)+" <<'PY'\nfrom pathlib import Path\nimport json,sys\np=Path(sys.argv[1]);assert p.resolve()==p and p.is_dir()\nimport hashlib\nprint(json.dumps({**{k:(p/k).read_text() for k in ['host-config.json','control-base.json','activation.json','machine-json.js','host-helper-functions.js','host-stage-functions.js','context-read.sql']},'__contextReadSha256':hashlib.sha256((p/'context-read.sql').read_bytes()).hexdigest()}))\nPY";
const result=await tools.exec_command({cmd:command,max_output_tokens:18000});
if(result.exit_code!==0||result.session_id)throw Error("HOST_LOAD_READ_FAILED");
const files=JSON.parse(result.output),cfg=JSON.parse(files['host-config.json']),control=JSON.parse(files['control-base.json']),binding=JSON.parse(files['activation.json']);
if(binding.status!=="REGISTERED_VERIFIED"||!binding.candidate||!Number.isSafeInteger(binding.candidate.version)||binding.candidate.version<=52)throw Error("CANDIDATE_NOT_REGISTERED");
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
store('proxyNode22:novartisNext:cloudPilotMachineJson',files['machine-json.js']);
store('proxyNode22:novartisNext:cloudPilotHostConfig',cfg);
store('proxyNode22:novartisNext:cloudPilotHostHelpers',files['host-helper-functions.js']);
store('proxyNode22:novartisNext:cloudPilotHostStages',files['host-stage-functions.js']);
store('proxyNode22:novartisNext:registeredCandidateBinding',binding);
return {sourceId,candidateId,commit,root};
