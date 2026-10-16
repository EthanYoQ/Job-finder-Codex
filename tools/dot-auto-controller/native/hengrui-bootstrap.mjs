/** Builtin-only trust bootstrap before any native TypeScript code or loader. */
import {createMutationFence} from '../src/mutation-fence.mjs';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {loadCatalog,PACKAGE_ROOT} from '../src/hengrui-catalog.mjs';
import {loadDeployment,assertDeploymentBinding} from '../src/hengrui-deployment.mjs';
import {requireAuthority} from '../src/hengrui-authority.mjs';
import {combinedReaderPins} from '../src/reader-pin-binding.mjs';
import {createControlPlane} from '../src/control-plane.mjs';
import {createPgConnectionFactory} from '../transport/pg-connection.mjs';
import {pathToFileURL} from 'node:url';
import {createExistingCompiler} from '../transport/hengrui-existing-compiler.mjs';
const mutationFence=createMutationFence({batchId:process.env.JOBFINDER_AUTO_BATCH_ID,sourceId:process.env.JOBFINDER_CLOUD_SOURCE_ID,nonce:process.env.JOBFINDER_AUTO_PROOF_NONCE});
for(const signal of ['SIGTERM','SIGINT','SIGHUP']){const stop=()=>{mutationFence.revoke();process.kill(process.pid,signal);};process.once(signal,stop);}
async function main(){
const deployment=loadDeployment();
const route=loadCatalog().sources.hengrui;
requireAuthority(deployment,route,{reconcile:['--reconcile','--verify-completion'].includes(process.argv[2])});
if(route.configured!==true||route.enabled!==true)throw Error('NEW_RUNTIME_QUALIFICATION_REQUIRED');
if(process.env.JOBFINDER_CLOUD_SOURCE_ID!==route.sourceId)throw Error('FIXED_SOURCE_PROCESS_REQUIRED');
// Original build/authority modules bind process.cwd() during their first import.
// Use the fixed catalog root before the verifier registers any TypeScript loader.
process.chdir(route.producer);
const expectedLockSha256=createHash('sha256').update(fs.readFileSync(route.producer+'/package-lock.json')).digest('hex');
// expectedBuild is supplied only by reviewed immutable deployment config.
// This builtin verifier checks /proc/exe and all native runtime content before
// registering that verified checkout's default TypeScript loader.
await createExistingCompiler({runtimeRoot:route.producer,expectedBuild:route.build,expectedLockSha256,expectedSourceId:route.sourceId,expectedSourceConfigSha256:route.sourceConfigSha256,expectedReaderCandidateId:route.candidate.id});
assertDeploymentBinding();
const pg=await import(pathToFileURL(route.producer+'/node_modules/pg/lib/index.js').href);
assertDeploymentBinding();
const openConnection=createPgConnectionFactory({Client:pg.default.Client,config:deployment.pg,passwordProvider:async()=>{const s=process.env.JOBFINDER_PG_PASSWORD;if(!s)throw Error('SECURE_SECRET_NOT_PROVISIONED');return s;}});
const controlPlane=createControlPlane({openConnection,assertScope:assertDeploymentBinding,onMutationAttempt:()=>{assertDeploymentBinding();mutationFence.markMutationAttempt();},readerFilePins:combinedReaderPins(JSON.parse(fs.readFileSync(PACKAGE_ROOT+'/config/reader-pins.json','utf8')),JSON.parse(fs.readFileSync(PACKAGE_ROOT+'/config/reader-api-pins.json','utf8')))});
assertDeploymentBinding();
const startupToken=await controlPlane.verifyStartup(route.sourceId,deployment.deployedReaderIdentity,{reconcile:['--reconcile','--verify-completion'].includes(process.argv[2])});
assertDeploymentBinding();
if(['--reconcile','--verify-completion'].includes(process.argv[2])){
 const {reconcileHengrui}=await import('./hengrui-reconcile.mts');const result=await reconcileHengrui(process.argv[3],{controlPlane,startupToken,allowEarlyRead:process.argv[2]==='--verify-completion'});console.log(JSON.stringify(result));if(!(process.argv[2]==='--verify-completion'&&result.status==='DB_AND_CURRENT_PUBLIC_RECONCILED'))process.exitCode=75;
}else if(process.argv.length===2){
 const {runNativeHengruiCycle}=await import('./hengrui-worker.mts');await runNativeHengruiCycle({controlPlane,startupToken});
}else throw Error('BOOTSTRAP_ARGUMENTS');

}
let terminalError=null;
try{await main();}catch(error){terminalError=typeof error?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'NATIVE_WORKER_FAILED';process.exitCode=1;console.error(JSON.stringify({status:'HELD',code:terminalError,retryAuthorized:false}));}
try{await mutationFence.sealTerminal({exitCode:process.exitCode===undefined?0:process.exitCode,errorCode:terminalError});}catch{process.exitCode=1;}
