// functions.exec AsyncFunction parameters: root, sourceId, candidateId, commit.
// Read and check all host bindings before replacing any session helper state.
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
if(!root.startsWith('/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/')||!/^[a-z0-9-]+$/.test(sourceId)||!/^[a-z0-9-]+$/.test(candidateId)||!/^[a-f0-9]{40}$/.test(commit))throw Error('HOST_LOAD_ARGUMENT');
const command="python3 - "+q(root)+" <<'PY'\nfrom pathlib import Path\nimport json,sys\np=Path(sys.argv[1]);assert p.resolve()==p and p.is_dir()\nprint(json.dumps({k:(p/k).read_text() for k in ['host-config.json','control-base.json','host-helper-functions.js','host-stage-functions.js']}))\nPY";
const result=await tools.exec_command({cmd:command,max_output_tokens:18000});
if(result.exit_code!==0||result.session_id)throw Error('HOST_LOAD_READ_FAILED');
const files=JSON.parse(result.output),cfg=JSON.parse(files['host-config.json']),control=JSON.parse(files['control-base.json']);
if(cfg.root!==root||cfg.sourceId!==sourceId||cfg.project!=='yiopvxysxrtrnvqxwgbx'||control.projectId!==cfg.project||control.candidate.id!==candidateId||control.build.commitSha!==commit)throw Error('HOST_LOAD_BINDING_MISMATCH');
if(!files['host-helper-functions.js'].includes('JOBFINDER_CLOUD_SOURCE_ID='+sourceId+' ')||!files['host-stage-functions.js'].includes('r.payload.sourceId!=="'+sourceId+'"')||!files['host-stage-functions.js'].includes('r.payload.sourceConfigSha256!=="'+cfg.sourceConfigSha256+'"'))throw Error('HOST_LOAD_HELPER_SCOPE_MISMATCH');
store('bayer42:cloudPilotHostConfig',cfg);
store('bayer42:cloudPilotHostHelpers',files['host-helper-functions.js']);
store('bayer42:cloudPilotHostStages',files['host-stage-functions.js']);
return {sourceId,candidateId,commit,root};
