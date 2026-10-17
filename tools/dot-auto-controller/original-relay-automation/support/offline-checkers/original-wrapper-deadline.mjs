import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const pinned=new Map();
export function readBiogenOriginalDeadline(runArg){
 const run=path.resolve(runArg);assert(run.startsWith('/workspace/scratch/5e9614251709/takeda-original-recovery-20261017T0417Z/biogen/'));
 const rows=fs.readFileSync(path.join(run,'diagnostics/process.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const starts=rows.filter(r=>r.event==='WRAPPER_START'),children=rows.filter(r=>r.event==='CHILD_STARTED');assert.equal(starts.length,1);assert.equal(children.length,1);
 const s=starts[0],c=children[0];assert.equal(s.timeoutMs,1800000);assert.equal(c.wrapperPid,s.wrapperPid);assert(Number.isSafeInteger(c.childPid)&&c.childPid>0);assert(Number.isSafeInteger(s.outerDeadline));assert(Math.abs(s.outerDeadline-Date.parse(s.recordedAt)-s.timeoutMs)<10);
 const authority=JSON.stringify([s,c]);if(pinned.has(run))assert.equal(pinned.get(run),authority);else pinned.set(run,authority);return s.outerDeadline;
}
