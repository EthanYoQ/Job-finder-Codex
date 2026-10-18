import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {readOriginalWrapperDeadline,readBiogenOriginalDeadline} from './after/original-wrapper-deadline.mjs';
import {isHengruiMainlandLocation} from '../five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/hengruiMainlandGeography.ts';
import {reviewHengruiRawPages} from '../five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/native/hengrui-raw-review.mts';
const root=path.resolve('takeda-original-recovery-20261017T0417Z');
for(const source of ['hengrui','biogen']){
 const dir=path.join(root,source,'synthetic-recovery-check-'+process.pid),diag=path.join(dir,'diagnostics');fs.mkdirSync(diag,{recursive:true});
 const recordedAt='2026-10-18T05:00:00.000Z',outerDeadline=Date.parse(recordedAt)+1800000;
 const start={event:'WRAPPER_START',recordedAt,timeoutMs:1800000,outerDeadline,wrapperPid:77};const child={event:'CHILD_STARTED',wrapperPid:77,childPid:78};const file=path.join(diag,'process.jsonl');const write=(a:any[])=>fs.writeFileSync(file,a.map(x=>JSON.stringify(x)).join('\n'));
 try{write([start,child]);assert.equal(readOriginalWrapperDeadline(dir,source),outerDeadline);if(source==='biogen')assert.equal(readBiogenOriginalDeadline(dir),outerDeadline);assert.throws(()=>readOriginalWrapperDeadline(dir,source==='biogen'?'hengrui':'biogen'));write([start,{...child,wrapperPid:99}]);assert.throws(()=>readOriginalWrapperDeadline(dir,source));write([start,{...child,childPid:79}]);assert.throws(()=>readOriginalWrapperDeadline(dir,source));}finally{fs.rmSync(dir,{recursive:true});}
}
const l={country:'中国',provinceName:'四川',provinceId:510000,cityName:'阆中市',cityId:511381};assert(isHengruiMainlandLocation(l));assert(!isHengruiMainlandLocation({...l,cityId:511382}));assert(!isHengruiMainlandLocation({...l,provinceId:440000}));assert.throws(()=>reviewHengruiRawPages({artifacts:[],pages:[]} as any,[],[]),/HENGRUI_PAGE_LIMIT/);
await import('./after/hengrui-packet-gate.mts');console.log('PASS: shared wrapper provenance for both callers; changed owner rejected; exact Langzhong tuple; incomplete raw rejected; full Hengrui gate module imports');
