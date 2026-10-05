// Existing per-source host loader; local load only, never launches.
const A=Object.getPrototypeOf(async function(){}).constructor;
if(!['hengrui','hansoh','viatris','gsk'].includes(sourceKey))throw Error('RESTORED46_SOURCE_SELECTION');
const root='/workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/hosts46/'+sourceKey;
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const r=await tools.exec_command({cmd:'cat '+q(root+'/runtime/load-source-runtime.js'),max_output_tokens:5000});
if(r.exit_code!==0||r.session_id)throw Error('RESTORED46_LOADER_READ_FAILED');
await new A(r.output)();
