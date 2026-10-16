/** Validate every current byte and both complete frozen views before ancestral assertions. */
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {INTEGRATION_SHARED_PARENT as S,INTEGRATION_VIATRIS_PARENT as V,INTEGRATION_PILOT as P,INTEGRATION_CLASS,viatrisSharedIntegrationSourceProvenance as integration} from '../scripts/viatris-shared-integration-provenance.mjs';
import {viatrisSourceProvenance,VIATRIS_NEW_SOURCE_PATH,VIATRIS_SHARED_SOURCE_PATHS} from '../scripts/viatris-source-provenance.mjs';
import {legacyCompletenessGuardSourceProvenance} from '../scripts/legacy-completeness-guard-source-provenance.mjs';
import {sharedCompletenessGuardSourceProvenance,SHARED_COMPLETENESS_GUARD_SOURCE_PATHS} from '../scripts/shared-completeness-guard-source-provenance.mjs';
import {bTriggerCompletenessGuardSourceProvenance} from '../scripts/b-trigger-completeness-guard-source-provenance.mjs';
import {ucbSourceProvenance} from '../scripts/ucb-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..'),prefix='tools/dot-auto-controller/vendor/';
export const integrationHash=b=>createHash('sha256').update(b).digest('hex');
export const integrationGit=(head,relative)=>execFileSync('git',['show',head+':'+prefix+relative],{cwd:root,maxBuffer:8*1024*1024});
const sharedFrozen=JSON.parse(integrationGit(S,'C60_SOURCE_MANIFEST.json')),viatrisFrozen=JSON.parse(integrationGit(V,'C60_SOURCE_MANIFEST.json'));
export const actualIntegrationManifest=JSON.parse(fs.readFileSync(root+'/vendor/C60_SOURCE_MANIFEST.json'));
const actualBytes=relative=>fs.readFileSync(root+'/vendor/c60-source/'+relative);
export function validateIntegrationViews(current,readSource=actualBytes){
 assert.equal(current.files.length,878);assert.equal(new Set(current.files.map(f=>f.path)).size,878);
 const pilot=current.files.find(f=>f.path===P);assert(integration(pilot));
 assert.deepEqual(current.files.filter(f=>f.classification===INTEGRATION_CLASS).map(f=>f.path),[P]);
 assert.deepEqual(pilot.priorProvenance,sharedFrozen.files.find(f=>f.path===P));assert.deepEqual(pilot.incomingViatrisProvenance,viatrisFrozen.files.find(f=>f.path===P));
 for(const [head,hashKey,blobKey] of [[S,'derivativeBaseSha256','derivativeBaseGitBlobSha1'],[V,'incomingViatrisSha256','incomingViatrisGitBlobSha1']]){
  const bytes=integrationGit(head,'c60-source/'+P);assert.equal(integrationHash(bytes),pilot[hashKey]);assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex'),pilot[blobKey]);
 }
 for(const f of current.files){const bytes=readSource(f.path);assert.equal(integrationHash(bytes),f.sha256,f.path);assert.equal(bytes.length,f.bytes,f.path);}
 const shared={...current,files:current.files.filter(f=>f.path!==VIATRIS_NEW_SOURCE_PATH).map(f=>{
  if(f.path===P)return structuredClone(f.priorProvenance);
  if(VIATRIS_SHARED_SOURCE_PATHS.includes(f.path)){assert(viatrisSourceProvenance(f));return structuredClone(f.priorProvenance);}
  return structuredClone(f);
 })};
 const viatris={...current,files:current.files.map(f=>{
  if(f.path===P)return structuredClone(f.incomingViatrisProvenance);
  if(!SHARED_COMPLETENESS_GUARD_SOURCE_PATHS.includes(f.path))return structuredClone(f);
  if(f.path==='src/db/ingestionRepository.ts'){assert(bTriggerCompletenessGuardSourceProvenance(f));f=f.priorProvenance;}
  assert(sharedCompletenessGuardSourceProvenance(f));return structuredClone(f.priorProvenance);
 })};
 assert.deepEqual(shared,sharedFrozen,'The full retained shared view must equal real 36a03b8');
 assert.deepEqual(viatris,viatrisFrozen,'The full retained Viatris view must equal real bf192cd');
 return {shared,viatris};
}
const views=validateIntegrationViews(actualIntegrationManifest);
export const integrationSharedManifest=views.shared,integrationViatrisManifest=views.viatris;
const records=new Map(actualIntegrationManifest.files.map(f=>[f.path,f]));
export const readIntegrationShared=relative=>[...VIATRIS_SHARED_SOURCE_PATHS].includes(relative)?integrationGit(S,'c60-source/'+relative):actualBytes(relative);
export const readIntegrationViatris=relative=>relative===P||SHARED_COMPLETENESS_GUARD_SOURCE_PATHS.includes(relative)?integrationGit(V,'c60-source/'+relative):actualBytes(relative);
function provenance(file){
 for(const fn of [integration,viatrisSourceProvenance,bTriggerCompletenessGuardSourceProvenance,legacyCompletenessGuardSourceProvenance,sharedCompletenessGuardSourceProvenance,ucbSourceProvenance]){const value=fn(file);if(value)return value;}
 if(file.classification==='EXACT_HISTORICAL_FILE_BYTES')return {kind:'quarantined-historical-file-bytes',originCommit:actualIntegrationManifest.originCommit,originCommitIsProvenanceOnly:true,path:file.path,newBuildQualificationRequired:true};
 if(file.classification==='LOCAL_AUTOMATION_SOURCE_DERIVATIVE')return {kind:'local-automation-source-derivative',originCommit:null,path:file.path,sourceStatus:'LOCAL_UNREGISTERED',...(file.derivativeBaseCommit?{derivativeBaseCommit:file.derivativeBaseCommit}:{}),...(file.derivativeBaseSha256?{derivativeBaseSha256:file.derivativeBaseSha256}:{}),...(file.ancestorOriginCommit?{ancestorOriginCommit:file.ancestorOriginCommit}:{}),newBuildQualificationRequired:true};
 throw Error('UNEXPECTED_INTEGRATION_VIEW_CLASS:'+file.classification);
}
export function integrationAncestorEntry(entry,side='shared'){
 const relative=entry.path?.startsWith(prefix+'c60-source/')?entry.path.slice((prefix+'c60-source/').length):null;
 const original=records.get(relative),view=views[side].files.find(f=>f.path===relative);
 if(!original||!view||JSON.stringify(original)===JSON.stringify(view))return entry;
 if(entry.sha256===view.sha256&&entry.bytes===view.bytes){assert.deepEqual(entry.provenance,provenance(view));return entry;}
 assert.equal(entry.sha256,original.sha256);assert.equal(entry.bytes,original.bytes);assert.deepEqual(entry.provenance,provenance(original));
 return {...entry,sha256:view.sha256,bytes:view.bytes,provenance:provenance(view)};
}
export const integrationSharedExport=exported=>({...exported,entries:exported.entries.filter(e=>e.path!==prefix+'c60-source/'+VIATRIS_NEW_SOURCE_PATH).map(e=>integrationAncestorEntry(e,'shared'))});
export const integrationViatrisExport=exported=>({...exported,entries:exported.entries.map(e=>integrationAncestorEntry(e,'viatris'))});
