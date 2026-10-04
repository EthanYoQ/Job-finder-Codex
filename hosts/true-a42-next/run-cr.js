// functions.exec fragment. Parent is the sole publisher. Starts capture only when explicitly run.
const A=Object.getPrototypeOf(async function(){}).constructor;
const r=await tools.exec_command({cmd:"cat '/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/true-a42-next/runtime/load-true-a42-extra-runtime.js'",max_output_tokens:5000});
if(r.exit_code!==0||r.session_id)throw Error('TRUE_A42_LOAD_READ');
await new A('sourceKey',r.output)('cr');
const batch='dot-cr-a-'+new Date().toISOString().replace(/\D/g,'').slice(0,17)+'-fb0b8e3';
store('trueA42:cr:nextBatchId',batch);
await new A(load('trueA42:cr:restoredASourceStartCode'))();
