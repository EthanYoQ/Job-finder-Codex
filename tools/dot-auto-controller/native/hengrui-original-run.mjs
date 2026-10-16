/** Read-only provenance: deadlines belong to the fixed supervisor authority. */
import fs from 'node:fs';import path from 'node:path';
import {loadDeployment,assertDeploymentBinding,deploymentBindingSha256} from '../src/hengrui-deployment.mjs';
import {loadCatalog} from '../src/hengrui-catalog.mjs';
import {requireAuthority} from '../src/hengrui-authority.mjs';
import {canonical,sha} from '../src/journal.mjs';
export function readHengruiOriginalDeadline(runArg){
 assertDeploymentBinding();const deployment=loadDeployment(),route=loadCatalog().sources.hengrui;
 const authority=requireAuthority(deployment,route),runDir=path.resolve(runArg),batchId=path.basename(runDir);
 if(runDir!==path.join(authority.directory,'hengrui',batchId)||fs.realpathSync(runDir)!==runDir)throw Error('HENGRUI_ORIGINAL_RUN_PATH');
 const read=(p)=>{if(fs.lstatSync(p).isSymbolicLink())throw Error('HENGRUI_ORIGINAL_RUN_SYMLINK');return fs.readFileSync(p,'utf8');};
 const record=(key)=>{const p=path.join(authority.directory,'controller','runs',batchId,key+'.json');if(fs.realpathSync(p)!==p)throw Error('HENGRUI_ORIGINAL_RUN_SYMLINK');const e=JSON.parse(read(p));if(e.schemaVersion!==1||e.runId!==batchId||e.key!==key||e.valueSha256!==sha(canonical(e.value)))throw Error('HENGRUI_ORIGINAL_RUN_ENVELOPE');return e.value;};
 const run=record('00-run'),launch=record('20-original-launch'),claim=record('01-source-claim'),binding=deploymentBindingSha256();
 if(run.schemaVersion!==1||run.batchId!==batchId||run.sourceId!==route.sourceId||run.routeIdentitySha256!==sha(canonical(route))||run.deploymentBindingSha256!==binding||claim.sourceId!==route.sourceId||launch.batchId!==batchId||launch.sourceId!==route.sourceId||launch.deploymentBindingSha256!==binding||launch.originalDeadline!==run.outerDeadline)throw Error('HENGRUI_ORIGINAL_RUN_BINDING');
 if(!Number.isSafeInteger(run.startedAt)||!Number.isSafeInteger(run.outerDeadline)||run.outerDeadline!==run.startedAt+1800000)throw Error('HENGRUI_ORIGINAL_RUN_DEADLINE');
 const markers=read(path.join(runDir,'diagnostics/process.jsonl')).trim().split('\n').map(line=>JSON.parse(line)).filter(x=>x.event==='WRAPPER_START');
 if(markers.length!==1||!Number.isSafeInteger(markers[0].outerDeadline))throw Error('HENGRUI_ORIGINAL_WRAPPER_DEADLINE');
 return Math.min(run.outerDeadline,markers[0].outerDeadline);
}
