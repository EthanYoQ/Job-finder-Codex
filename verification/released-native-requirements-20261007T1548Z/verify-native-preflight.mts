import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {deriveCurrentStagedScheduleExpectation} from '../../producer/src/crawler/stagedScheduleAuthority.ts';
import {makePfizerFixture,sha} from './pfizer-b-proof.fixture.mts';
const P=import.meta.dirname,R=resolve(P,'../..'),H=join(R,'hosts/pfizer/host'),original=JSON.parse(readFileSync(join(H,'host-config.json'),'utf8')),dir=mkdtempSync(join(P,'synthetic-preflight-')),host=join(dir,'host');mkdirSync(host);
const control=JSON.parse(readFileSync(join(P,'synthetic-pfizer/valid-prepared/host/control-base.json'),'utf8')),cfg={...original,root:host},row=JSON.parse(readFileSync(join(P,'synthetic-pfizer/valid-readback.json'),'utf8')).candidateRow;
const fixture=await makePfizerFixture({now:new Date()}),independent=Buffer.from(JSON.stringify(fixture.validation)),input=join(dir,'independent.json');writeFileSync(input,independent);
const boot={schemaVersion:1,batchId:'synthetic-preflight-only',checkedAt:new Date().toISOString(),candidateRows:[row],independentValidation:{path:input,sha256:sha(independent)}};
const configPath=join(host,'host-config.json'),controlPath=join(host,'control-base.json'),bootstrapPath=join(dir,'bootstrap.json');
writeFileSync(configPath,JSON.stringify(cfg));writeFileSync(controlPath,JSON.stringify(control));writeFileSync(bootstrapPath,JSON.stringify(boot));const hash=sha(readFileSync(bootstrapPath));
const results=[];
for(const name of ['valid','wrong-bootstrap-hash','legacy-direct-launch','symlink-config']){
 const path=name==='symlink-config'?join(host,'linked-config.json'):configPath;if(name==='symlink-config')symlinkSync(configPath,path);
 const out=spawnSync(cfg.node,[join(H,'runtime/preflight/preflight-launch.mjs'),name==='legacy-direct-launch'?'launch':'check',path,controlPath,bootstrapPath,name==='wrong-bootstrap-hash'?'0'.repeat(64):hash,join(dir,'run-'+name)],{cwd:cfg.repo,encoding:'utf8',env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:cfg.sourceId,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1',NODE_OPTIONS:'--require='+join(P,'offline.cjs')}});
 if(name==='valid'){assert.equal(out.status,0,out.stderr);const parsed=JSON.parse(out.stdout),report=JSON.parse(readFileSync(parsed.reportPath,'utf8'));assert.equal(report.launchPermitted,false);assert.equal(report.supervisedStarterRequired,true);assert.equal(report.runtime.archiveSmoke.passed,true);assert(report.command.includes('--max-old-space-size=384'));}else{assert.notEqual(out.status,0);assert(out.stderr.includes(name==='wrong-bootstrap-hash'?'PREFLIGHT_BOOTSTRAP_HASH':name==='legacy-direct-launch'?'PREFLIGHT_LEGACY_LAUNCH_DISABLED_USE_SUPERVISED_STARTER':'PREFLIGHT_SYMLINK'),out.stderr);}
 results.push({name,passed:true});
}
writeFileSync(join(P,'PREFLIGHT_RESULTS.json'),JSON.stringify({qualification:false,network:false,sql:false,launch:false,passed:results.length,results},null,2));console.log(JSON.stringify({passed:results.length}));
