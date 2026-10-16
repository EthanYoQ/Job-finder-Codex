/** Validate the B-trigger derivative before older tests inspect its exact shared ancestor. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {B_TRIGGER_COMPLETENESS_GUARD_BASE_COMMIT,B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS,B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS,bTriggerCompletenessGuardSourceProvenance} from '../scripts/b-trigger-completeness-guard-source-provenance.mjs';
import {sharedCompletenessGuardSourceProvenance} from '../scripts/shared-completeness-guard-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..'),prefix='tools/dot-auto-controller/vendor/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=relative=>execFileSync('git',['show',B_TRIGGER_COMPLETENESS_GUARD_BASE_COMMIT+':'+prefix+relative],{cwd:root,maxBuffer:8*1024*1024});
const base=JSON.parse(git('C60_SOURCE_MANIFEST.json'));
const current=JSON.parse(fs.readFileSync(root+'/vendor/C60_SOURCE_MANIFEST.json'));
const derivatives=current.files.filter(file=>file.classification===B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS);
assert.deepEqual(B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS,['src/db/ingestionRepository.ts']);
assert.deepEqual(derivatives.map(file=>file.path),B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS);
for(const file of derivatives){
 assert(bTriggerCompletenessGuardSourceProvenance(file));
 const prior=base.files.find(entry=>entry.path===file.path),before=git('c60-source/'+file.path),now=fs.readFileSync(root+'/vendor/c60-source/'+file.path);
 assert.deepEqual(file.priorProvenance,prior);assert(sharedCompletenessGuardSourceProvenance(prior));
 assert.equal(file.derivativeBaseSha256,sha(before));assert.equal(prior.bytes,before.length);
 assert.equal(file.sha256,sha(now));assert.equal(file.bytes,now.length);
}
export const retainedBTriggerGuardManifest={...current,files:current.files.map(file=>file.classification===B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS?structuredClone(file.priorProvenance):file)};
export const readBeforeBTriggerGuard=relative=>B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS.includes(relative)?git('c60-source/'+relative):fs.readFileSync(root+'/vendor/c60-source/'+relative);
export function bTriggerGuardAncestorEntry(entry){
 const file=derivatives.find(file=>entry.path===prefix+'c60-source/'+file.path);
 if(!file)return entry;
 assert.equal(entry.sha256,file.sha256);assert.equal(entry.bytes,file.bytes);
 assert.deepEqual(entry.provenance,bTriggerCompletenessGuardSourceProvenance(file));
 const prior=file.priorProvenance;
 return {...entry,sha256:prior.sha256,bytes:prior.bytes,provenance:sharedCompletenessGuardSourceProvenance(prior)};
}
