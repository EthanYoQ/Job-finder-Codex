import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/portable42-following';
const A=Object.getPrototypeOf(async function(){}).constructor;
const code=await readFile(join(root,'runtime/load-portable42-runtime.js'),'utf8');
const isolated=new Map(),checks=[],commands=[];
globalThis.store=(k,v)=>isolated.set(k,v);
globalThis.load=k=>isolated.get(k);
globalThis.text=()=>{};
globalThis.notify=()=>{throw Error('LOADER_UNEXPECTED_NOTIFY');};
globalThis.fetch=async()=>{throw Error('LOADER_NETWORK_FORBIDDEN');};
globalThis.tools={exec_command:async args=>{
 if(!args.cmd.startsWith("python3 - '")||!args.cmd.includes(root))throw Error('LOADER_ONLY_LOCAL_READ_COMMANDS');
 commands.push(args.cmd);
 return {exit_code:0,output:execFileSync('/bin/bash',['-c',args.cmd],{encoding:'utf8',timeout:15000,maxBuffer:1000000})};
}};
for(const sourceKey of ['ucb','qilu','novo']){
 isolated.clear();
 await new A('sourceKey',code)(sourceKey);
 const cfg=isolated.get('cloudPilotHostConfig');
 if(cfg.root!==root+'/'+sourceKey||cfg.sourceId!==({ucb:'source-ucb-china-social',qilu:'source-qilu-social',novo:'source-novo-nordisk-china-social'})[sourceKey]||isolated.get('portable42SourceKey')!==sourceKey)throw Error('LOADER_SCOPE');
 for(const k of ['cloudPilotHostHelpers','cloudPilotHostStages','continuousPortableRelayCodeWithPoll','restoredPortableSourceStartCode'])if(typeof isolated.get(k)!=='string'||!isolated.get(k))throw Error('LOADER_MISSING_CODE_STORE');
 for(const k of ['currentIndependentValidationInput','currentCaptureInput','currentRetainedCaptureInput'])if(isolated.get(k)!==null)throw Error('LOADER_PORTABLE_BOOTSTRAP_SCOPE');
 const expected=['cloudPilotHostConfig','cloudPilotHostHelpers','cloudPilotHostStages','continuousPortableRelayCodeWithPoll','restoredPortableSourceStartCode','portable42SourceKey','currentIndependentValidationInput','currentCaptureInput','currentRetainedCaptureInput'].sort();
 if(JSON.stringify([...isolated.keys()].sort())!==JSON.stringify(expected))throw Error('LOADER_UNEXPECTED_STORE');
 checks.push({check:'isolated actual loader local read and full source/candidate/helper binding',sourceKey,sourceId:cfg.sourceId,passed:true});
}
for(const sourceKey of ['astellas','biogen','bayer','__proto__','unknown']){
 const count=commands.length,before=[...isolated.keys()];
 try{await new A('sourceKey',code)(sourceKey);throw Error('LOADER_EXPECTED_SELECTION_REJECTION');}
 catch(error){if(error.message!=='PORTABLE42_SOURCE_SELECTION')throw error;}
 if(commands.length!==count||JSON.stringify([...isolated.keys()])!==JSON.stringify(before))throw Error('LOADER_INVALID_SELECTION_SIDE_EFFECT');
 checks.push({check:'unprepared or prototype source rejected before local reads or stores',sourceKey,passed:true});
}
const report={schemaVersion:1,checkedAt:new Date().toISOString(),passed:true,scope:'LOCAL_ISOLATED_FUNCTIONS_EXEC_LOADER_CHECK',networkAccessed:false,databaseAccessed:false,producerLaunched:false,parentSessionStoresAccessed:false,loaderSha256:createHash('sha256').update(code).digest('hex'),commandCount:commands.length,checks};
await writeFile(join(root,'LOADER_CHECK_RESULTS.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({passed:true,count:checks.length,commandCount:commands.length,reportPath:join(root,'LOADER_CHECK_RESULTS.json')}));
