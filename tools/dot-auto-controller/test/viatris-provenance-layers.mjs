/** Test-only views of retained layers. Each unwrap is checked against exact Git ancestry. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {VIATRIS_BASE_COMMIT,VIATRIS_SHARED_SOURCE_PATHS,VIATRIS_NEW_SOURCE_PATH,VIATRIS_DERIVATIVE_CLASS,VIATRIS_NEW_SOURCE_CLASS,viatrisSourceProvenance} from '../scripts/viatris-source-provenance.mjs';
import {ucbSourceProvenance} from '../scripts/ucb-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..');
const prefix='tools/dot-auto-controller/vendor/';
export const viatrisParentBytes=relative=>execFileSync('git',['show',VIATRIS_BASE_COMMIT+':'+prefix+'c60-source/'+relative],{cwd:root,maxBuffer:8*1024*1024});
export function retainedViatrisParent(current){
 const parent=JSON.parse(execFileSync('git',['show',VIATRIS_BASE_COMMIT+':'+prefix+'C60_SOURCE_MANIFEST.json'],{cwd:root,maxBuffer:8*1024*1024}));
 assert.deepEqual(current.files.filter(file=>file.classification===VIATRIS_DERIVATIVE_CLASS).map(file=>file.path).sort(),[...VIATRIS_SHARED_SOURCE_PATHS].sort());
 assert.deepEqual(current.files.filter(file=>file.classification===VIATRIS_NEW_SOURCE_CLASS).map(file=>file.path),[VIATRIS_NEW_SOURCE_PATH]);
 for(const file of current.files.filter(file=>[VIATRIS_DERIVATIVE_CLASS,VIATRIS_NEW_SOURCE_CLASS].includes(file.classification)))assert.notEqual(viatrisSourceProvenance(file),null);
 const retained={...current,files:current.files.filter(file=>file.classification!==VIATRIS_NEW_SOURCE_CLASS).map(file=>file.classification===VIATRIS_DERIVATIVE_CLASS?file.priorProvenance:file)};
 assert.deepEqual(retained,parent,'Removing only the validated Viatris layer must recover the complete exact 962979 manifest');
 return retained;
}
export function retainedViatrisExport(entry,current){
 const file=current.files.find(file=>entry.path===prefix+'c60-source/'+file.path);
 if(file?.classification!==VIATRIS_DERIVATIVE_CLASS)return entry;
 assert.equal(entry.sha256,file.sha256);assert.equal(entry.bytes,file.bytes);
 assert.deepEqual(entry.provenance,viatrisSourceProvenance(file));
 const prior=file.priorProvenance;
 return {...entry,sha256:prior.sha256,bytes:prior.bytes,provenance:ucbSourceProvenance(prior)};
}
