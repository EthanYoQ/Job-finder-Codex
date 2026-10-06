// Reconstructed from the recovered R3 binding contract/tests, not recovered original loader bytes.
// functions.exec AsyncFunction parameters: root, sourceId, candidateId, commit.
// Read and validate every binding before replacing any session state.
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const expectedRoot="/workspace/scratch/5e9614251709/jb-workspace-recovery-20261006T1136Z/hosts-next/organon/host",expectedRepo="/workspace/scratch/5e9614251709/jb-workspace-recovery-20261006T1136Z/workspaces/producer-fb0-exact",expectedBuild={"schemaVersion": 2, "commitSha": "47b74924f850a4d329460b71717b36df9a5159b8", "sourceTreeSha256": "2b69db23fda340bea9a9a6931aa58426e80599c82251909424f61cae5f3f7894", "runtimeTreeSha256": "b59a746109d74eea22cab9c4c3154de5954bae3b900ed0e7032a20d4ea510bd1", "contentSha256": "f4cf9ca5bc22fdea40d67a92018c8574bf3e8eee0e32deea6c28d48129ee9e5f"};
const expectedSourceId="source-organon-china-social",expectedHash="d56e212c03224c44b0be11afc07709ae9b2fbfd2a69c24ce773c0f192fa603d2";
if(root!==expectedRoot||sourceId!==expectedSourceId||typeof candidateId!=="string"||!/^[-A-Za-z0-9._]{1,100}$/.test(candidateId)||candidateId==="dot-cloud-restored-fb0b8e3-20261005T2028Z"||commit!==expectedBuild.commitSha)throw Error("HOST_LOAD_ARGUMENT");
const command="python3 - "+q(root)+" <<'PY'\nfrom pathlib import Path\nimport json,sys\np=Path(sys.argv[1]);assert p.resolve()==p and p.is_dir()\nprint(json.dumps({k:(p/k).read_text() for k in ['host-config.json','control-base.json','activation.json','host-helper-functions.js','host-stage-functions.js']}))\nPY";
const result=await tools.exec_command({cmd:command,max_output_tokens:18000});
if(result.exit_code!==0||result.session_id)throw Error("HOST_LOAD_READ_FAILED");
const files=JSON.parse(result.output),cfg=JSON.parse(files['host-config.json']),control=JSON.parse(files['control-base.json']),binding=JSON.parse(files['activation.json']);
if(binding.status!=="REGISTERED_VERIFIED"||!binding.candidate||!Number.isSafeInteger(binding.candidate.version)||binding.candidate.version<1)throw Error("CANDIDATE_NOT_REGISTERED");
const exact=(a,b)=>a&&b&&Object.keys(a).sort().join(',')===Object.keys(b).sort().join(',')&&Object.keys(b).every(k=>a[k]===b[k]);
if(!exact(control.build,expectedBuild)||!exact(binding.build,expectedBuild))throw Error("HOST_LOCAL_BUILD_BINDING_MISMATCH");
if(cfg.root!==expectedRoot||cfg.repo!==expectedRepo||cfg.project!=="yiopvxysxrtrnvqxwgbx"||cfg.sourceId!==expectedSourceId||cfg.sourceConfigSha256!==expectedHash||control.projectId!==cfg.project||!exact(control.candidate,binding.candidate)||binding.candidate.id!==candidateId||binding.candidate.goalId!=="jobfinder-portable-required-40"||control.build.commitSha!==commit)throw Error("HOST_LOAD_BINDING_MISMATCH");
if(!files['host-helper-functions.js'].includes('JOBFINDER_CLOUD_SOURCE_ID='+sourceId+' ')||!files['host-stage-functions.js'].includes('r.payload.sourceId!=="'+sourceId+'"')||!files['host-stage-functions.js'].includes('r.payload.sourceConfigSha256!=="'+cfg.sourceConfigSha256+'"'))throw Error("HOST_LOAD_HELPER_SCOPE_MISMATCH");
store('deadlineCandidate47b:organon:cloudPilotHostConfig',cfg);
store('deadlineCandidate47b:organon:cloudPilotHostHelpers',files['host-helper-functions.js']);
store('deadlineCandidate47b:organon:cloudPilotHostStages',files['host-stage-functions.js']);
store('deadlineCandidate47b:organon:registeredCandidateBinding',binding);
return {sourceId,candidateId,commit,root};
