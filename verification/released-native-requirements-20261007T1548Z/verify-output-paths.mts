import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,symlinkSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const P=import.meta.dirname,R=resolve(P,'../..'),H=join(R,'hosts/pfizer/host'),cfg=JSON.parse(readFileSync(join(H,'host-config.json'),'utf8')),dir=mkdtempSync(join(P,'synthetic-output-paths-'));
mkdirSync(join(dir,'real'));symlinkSync(join(dir,'real'),join(dir,'link'));
const results=[];
for(const [name,path,expected] of [['inside-host',join(H,'forbidden-output'),'PREPARATION_OUTPUT_SCOPE'],['inside-producer',join(cfg.repo,'forbidden-output'),'PREPARATION_OUTPUT_SCOPE'],['symlink-output',join(dir,'link'),'PREPARATION_OUTPUT_SYMLINK'],['symlink-ancestor',join(dir,'link/new-output'),'PREPARATION_OUTPUT_SYMLINK'],['existing-output',join(dir,'real'),'PREPARATION_OUTPUT_SCOPE'],['valid',join(dir,'prepared'),'']] as const){
 const run=spawnSync(cfg.node,['--require',join(P,'offline.cjs'),'--import',join(cfg.repo,'node_modules/tsx/dist/loader.mjs'),join(H,'runtime/prepare-registered-control.mts'),join(P,'synthetic-pfizer/valid-owner.json'),join(P,'synthetic-pfizer/valid-readback.json'),path],{cwd:cfg.repo,encoding:'utf8',env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:cfg.sourceId,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1'}});
 assert.equal(run.status===0,!expected,run.stderr);if(expected)assert(run.stderr.includes(expected),run.stderr);results.push({name,passed:true});
}
for(const name of ['activation.json','control-base.json','context-read.sql'])assert.equal(existsSync(join(H,name)),false);
const pf=readFileSync(join(H,'runtime/preflight/preflight-launch.mjs'),'utf8');assert(!pf.includes('--max-old-space-size=256'));assert(pf.includes('launchPermitted: false, supervisedStarterRequired: true'));results.push({name:'auxiliary-preflight-384-is-explicitly-nonlaunching',passed:true});
writeFileSync(join(P,'OUTPUT_PATH_RESULTS.json'),JSON.stringify({classification:'SYNTHETIC_ONLY',results,passed:results.length,hostUnbound:true,network:false,sql:false},null,2));console.log(JSON.stringify({passed:results.length}));
