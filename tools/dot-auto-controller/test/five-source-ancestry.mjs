/** Every actual current native byte is verified before restoring the whole sealed integration view. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {FIVE_BASE_COMMIT,FIVE_DERIVATIVE_CLASS,FIVE_SOURCE_PATHS,fiveSourceProvenance} from '../scripts/five-source-provenance.mjs';
import {fourSourceProvenance} from '../scripts/four-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..'),prefix='tools/dot-auto-controller/vendor/';
export const fiveHash=b=>createHash('sha256').update(b).digest('hex');
export const fiveGit=relative=>execFileSync('git',['show',FIVE_BASE_COMMIT+':'+prefix+relative],{cwd:root,maxBuffer:8*1024*1024});
const frozen=JSON.parse(fiveGit('C60_SOURCE_MANIFEST.json'));
export const actualFiveSourceManifest=JSON.parse(fs.readFileSync(root+'/vendor/C60_SOURCE_MANIFEST.json'));
const actual=relative=>fs.readFileSync(root+'/vendor/c60-source/'+relative);
export function validateFiveSourceView(current,readSource=actual){
 assert.equal(current.files.length,frozen.files.length);assert.equal(new Set(current.files.map(f=>f.path)).size,frozen.files.length);
 assert.deepEqual(current.files.filter(f=>f.classification===FIVE_DERIVATIVE_CLASS).map(f=>f.path).sort(),[...FIVE_SOURCE_PATHS].sort());
 for(const f of current.files){const bytes=readSource(f.path);assert.equal(fiveHash(bytes),f.sha256,f.path);assert.equal(bytes.length,f.bytes,f.path);if(FIVE_SOURCE_PATHS.includes(f.path)){assert(fiveSourceProvenance(f));assert.deepEqual(f.priorProvenance,frozen.files.find(p=>p.path===f.path));const before=fiveGit('c60-source/'+f.path);assert.equal(fiveHash(before),f.derivativeBaseSha256);assert.equal(before.length,f.priorProvenance.bytes);}}
 const prior={...current,files:current.files.map(f=>FIVE_SOURCE_PATHS.includes(f.path)?structuredClone(f.priorProvenance):structuredClone(f))};
 assert.deepEqual(prior,frozen,'The entire five-source prior view must equal the real sealed e478 manifest');return prior;
}
export const retainedFiveSourceManifest=validateFiveSourceView(actualFiveSourceManifest);
export const readBeforeFiveSource=relative=>FIVE_SOURCE_PATHS.includes(relative)?fiveGit('c60-source/'+relative):actual(relative);
export function fiveSourceAncestorEntry(entry){
 const rel=entry.path?.startsWith(prefix+'c60-source/')?entry.path.slice((prefix+'c60-source/').length):null;if(!FIVE_SOURCE_PATHS.includes(rel))return entry;
 const record=actualFiveSourceManifest.files.find(f=>f.path===rel),prior=record.priorProvenance;
 if(entry.sha256===prior.sha256&&entry.bytes===prior.bytes){assert.deepEqual(entry.provenance,fourSourceProvenance(prior));return entry;}
 assert.equal(entry.sha256,record.sha256);assert.equal(entry.bytes,record.bytes);assert.deepEqual(entry.provenance,fiveSourceProvenance(record));return {...entry,sha256:prior.sha256,bytes:prior.bytes,provenance:fourSourceProvenance(prior)};
}
export const fiveSourceAncestorExport=out=>({...out,entries:out.entries.map(fiveSourceAncestorEntry)});
