import {retainedLegacyGuardManifest,readBeforeLegacyGuard} from './legacy-completeness-guard-ancestry.mjs';
/** Old provenance tests inspect an explicitly validated ancestor, never skip changed rows. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {SHARED_COMPLETENESS_GUARD_BASE_COMMIT,SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS,SHARED_COMPLETENESS_GUARD_SOURCE_PATHS,sharedCompletenessGuardSourceProvenance} from '../scripts/shared-completeness-guard-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..'),prefix='tools/dot-auto-controller/vendor/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=relative=>execFileSync('git',['show',SHARED_COMPLETENESS_GUARD_BASE_COMMIT+':'+prefix+relative],{cwd:root,maxBuffer:8*1024*1024});
const base=JSON.parse(git('C60_SOURCE_MANIFEST.json'));
// The validated legacy layer is stripped first; the original three-path scope is unchanged.
const current=retainedLegacyGuardManifest;
const derivatives=current.files.filter(file=>file.classification===SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS);
assert.deepEqual(derivatives.map(file=>file.path).sort(),[...SHARED_COMPLETENESS_GUARD_SOURCE_PATHS].sort());
for(const file of derivatives){
 assert(sharedCompletenessGuardSourceProvenance(file));
 const prior=base.files.find(entry=>entry.path===file.path),before=git('c60-source/'+file.path),now=readBeforeLegacyGuard(file.path);
 assert.deepEqual(file.priorProvenance,prior);
 assert.equal(file.derivativeBaseSha256,sha(before));assert.equal(prior.bytes,before.length);
 assert.equal(file.sha256,sha(now));assert.equal(file.bytes,now.length);
}
export const retainedSharedGuardManifest={...current,files:current.files.map(file=>file.classification===SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS?structuredClone(file.priorProvenance):file)};
export const readBeforeSharedGuard=relative=>SHARED_COMPLETENESS_GUARD_SOURCE_PATHS.includes(relative)?git('c60-source/'+relative):readBeforeLegacyGuard(relative);
