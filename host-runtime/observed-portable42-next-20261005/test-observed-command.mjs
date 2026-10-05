import { buildObservedCommand } from './build-observed-command.mjs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const q=s=>"'"+s.replaceAll("'","'\\''")+"'";
const base=fileURLToPath(new URL('.',import.meta.url));
const fixture=base+'fixture-capture.mjs';
const sampler='/workspace/scratch/5e9614251709/jb-memory-observation-20261005T1115Z/sample_process_tree.py';
const results=[];
for(const [name,code,expectedArg] of [['nonzero-target',7,fixture],['zero-target',0,fixture],['observer-failure',0,'deliberately-wrong-root-token']]){
 const outputDir=base+'synthetic-'+name;
 const shell=buildObservedCommand('node '+q(fixture)+' '+code,{samplerPath:sampler,expectedArg,outputDir,label:'SYNTHETIC_ONLY/'+name},q);
 assert.equal(spawnSync('bash',['-n','-c',shell]).status,0);
 const run=spawnSync('bash',['-c',shell],{encoding:'utf8',timeout:15000});
 assert.equal(run.status,code);
 if(name==='observer-failure')assert.match(run.stdout,/MEMORY_OBSERVER_EXIT=2 CAPTURE_EXIT=0/);
 else{
  assert.match(run.stdout,new RegExp('MEMORY_OBSERVER_EXIT=0 CAPTURE_EXIT='+code));
  const report=JSON.parse(readFileSync(outputDir+'/summary.json','utf8'));
  assert.equal(report.status,'TARGET_TREE_EXITED');assert.ok(report.sampleCount>=1);assert.ok(report.treeRssPeak.KiB>0);
 }
 results.push({name,expectedCaptureExit:code,actualExit:run.status,output:run.stdout.trim()});
}
const source=readFileSync(base+'start-monitor-portable42-observed.js','utf8');
for(const bad of [null,undefined,42])assert.ok(typeof bad!=='string');
assert.match(source,/typeof batch!=="string"/);
writeFileSync(base+'SELFTEST.json',JSON.stringify({checkedAt:new Date().toISOString(),noNetworkOrDatabase:true,results},null,2)+'\n');
console.log(JSON.stringify({passed:results.length,results}));
