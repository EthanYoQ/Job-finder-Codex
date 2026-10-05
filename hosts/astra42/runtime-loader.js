// functions.exec AsyncFunction parameter: sourceKey. Local load only, no producer or DB call.
const A=Object.getPrototypeOf(async function(){}).constructor;
if(sourceKey!=='astra')throw Error('ASTRA42_SOURCE_SELECTION');
const root='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/astra42';
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const r=await tools.exec_command({cmd:'cat '+q(root+'/runtime/load-source-runtime.js'),max_output_tokens:5000});
if(r.exit_code!==0||r.session_id)throw Error('ASTRA42_LOADER_READ_FAILED');
await new A(r.output)();
