import {integrationAncestorEntry} from './viatris-shared-integration-layers.mjs';
import {retainedBTriggerGuardManifest,readBeforeBTriggerGuard} from './b-trigger-completeness-guard-ancestry.mjs';
/** Validate the single legacy derivative before any older provenance test strips it. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {LEGACY_COMPLETENESS_GUARD_BASE_COMMIT,LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS,LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS,legacyCompletenessGuardSourceProvenance} from '../scripts/legacy-completeness-guard-source-provenance.mjs';
import {ucbSourceProvenance} from '../scripts/ucb-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..'),prefix='tools/dot-auto-controller/vendor/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=relative=>execFileSync('git',['show',LEGACY_COMPLETENESS_GUARD_BASE_COMMIT+':'+prefix+relative],{cwd:root,maxBuffer:8*1024*1024});
const base=JSON.parse(git('C60_SOURCE_MANIFEST.json'));
// B is validated and stripped before the unchanged legacy layer.
const current=retainedBTriggerGuardManifest;
const derivatives=current.files.filter(file=>file.classification===LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS);
assert.deepEqual(LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS,['scripts/p0-cloud-portable-source-pilot.ts']);
assert.deepEqual(derivatives.map(file=>file.path),LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS);
for(const file of derivatives){
 assert(legacyCompletenessGuardSourceProvenance(file));
 const prior=base.files.find(entry=>entry.path===file.path),before=git('c60-source/'+file.path),now=readBeforeBTriggerGuard(file.path);
 assert.deepEqual(file.priorProvenance,prior);assert(ucbSourceProvenance(prior));
 assert.equal(file.derivativeBaseSha256,sha(before));assert.equal(prior.bytes,before.length);
 assert.equal(file.sha256,sha(now));assert.equal(file.bytes,now.length);
}
export const retainedLegacyGuardManifest={...current,files:current.files.map(file=>file.classification===LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS?structuredClone(file.priorProvenance):file)};
export const readBeforeLegacyGuard=relative=>LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS.includes(relative)?git('c60-source/'+relative):readBeforeBTriggerGuard(relative);
export function legacyGuardAncestorEntry(entry){
 entry=integrationAncestorEntry(entry);
 const file=derivatives.find(file=>entry.path===prefix+'c60-source/'+file.path);
 if(!file)return entry;
 assert.equal(entry.sha256,file.sha256);assert.equal(entry.bytes,file.bytes);
 assert.deepEqual(entry.provenance,legacyCompletenessGuardSourceProvenance(file));
 const prior=file.priorProvenance;
 return {...entry,sha256:prior.sha256,bytes:prior.bytes,provenance:ucbSourceProvenance(prior)};
}
