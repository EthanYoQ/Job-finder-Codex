// These assertions inspect the fully validated retained 36a03b8 view.
import {integrationSharedManifest,readIntegrationShared,integrationSharedExport,integrationAncestorEntry} from '../test/viatris-shared-integration-layers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {hengruiSourceProvenance,HENGRUI_BASE_HASHES} from '../scripts/hengrui-source-provenance.mjs';
import {ucbSourceProvenance,UCB_DERIVATIVE_CLASS} from '../scripts/ucb-source-provenance.mjs';
import {bTriggerCompletenessGuardSourceProvenance,B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS} from '../scripts/b-trigger-completeness-guard-source-provenance.mjs';
import {legacyCompletenessGuardSourceProvenance,LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS} from '../scripts/legacy-completeness-guard-source-provenance.mjs';
import {sharedCompletenessGuardSourceProvenance,SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS} from '../scripts/shared-completeness-guard-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..');
const manifest=integrationSharedManifest;
const exported=integrationSharedExport(JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/package-manifest.mjs')],{encoding:'utf8',maxBuffer:4*1024*1024})));
const baseCommit='d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f';
const ancestorOriginCommit='3a2400768e8b087b8600dd05e1a32ac006bd7102';
// These hashes name the exact d02f inputs, not the current local derivatives.
const localBaseHashes={
 'src/db/ingestionRepository.ts':'56a16ca89ae417c1613cb37f7beb53db82dbc55f181219c6db7f48b7e487223b',
 'src/crawler/cloudSourcePilotRelay.ts':'06a0a626947365e241ae9d7de02e11f21496da21f4d3d8d497a6b6739f7823e6',
 'scripts/p0-cloud-portable-source-pilot.ts':'a62a002c67716551ed23af7263b08a3d2d6486efcf31d9b4889b7042731fe98f',
};
const records=relative=>({
 source:manifest.files.find(f=>f.path===relative),
 entry:exported.entries.find(f=>f.path==='tools/dot-auto-controller/vendor/c60-source/'+relative),
});
function assertDirectLocalDerivative(relative,source,entry){
 assert(source,relative);assert(entry,relative);
 assert.equal(source.classification,'LOCAL_AUTOMATION_SOURCE_DERIVATIVE');
 assert.equal(source.originCommit,null);
 assert.equal(source.originSha256,undefined);
 assert.equal(source.productionQualified,false);
 assert.equal(source.derivativeBaseCommit,baseCommit);
 assert.equal(source.derivativeBaseSha256,localBaseHashes[relative]);
 assert.equal(source.ancestorOriginCommit,ancestorOriginCommit);
 assert.equal(manifest.originCommit,ancestorOriginCommit);
 assert.deepEqual(entry.provenance,{
  kind:'local-automation-source-derivative',originCommit:null,path:relative,
  sourceStatus:'LOCAL_UNREGISTERED',derivativeBaseCommit:baseCommit,
  derivativeBaseSha256:localBaseHashes[relative],ancestorOriginCommit,
  newBuildQualificationRequired:true,
 });
 assert.equal(entry.sha256,source.sha256);assert.equal(entry.bytes,source.bytes);
}
// The three worker files now have an exact c53 parent. Keep the historical
// d02f assertions on the preserved ancestor, not on today's derivative bytes.
function assertHengruiDerivative(relative,source,entry){
 assert(source,relative);assert(entry,relative);
 // Validate legacy, then UCB before applying the unchanged c53/d02f contract.
 if(source.classification===LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS){
  assert.doesNotThrow(()=>legacyCompletenessGuardSourceProvenance(source));assert.deepEqual(entry.provenance,legacyCompletenessGuardSourceProvenance(source));
  assert.equal(entry.sha256,source.sha256);assert.equal(entry.bytes,source.bytes);
  source=source.priorProvenance;entry={sha256:source.sha256,bytes:source.bytes,provenance:ucbSourceProvenance(source)};
 }
 if(source.classification===UCB_DERIVATIVE_CLASS){
  assert.doesNotThrow(()=>ucbSourceProvenance(source));assert.deepEqual(entry.provenance,ucbSourceProvenance(source));
  assert.equal(entry.sha256,source.sha256);assert.equal(entry.bytes,source.bytes);
  source=source.priorProvenance;entry={sha256:source.sha256,bytes:source.bytes,provenance:hengruiSourceProvenance(source)};
 }
 assert.equal(source.classification,'HENGRUI_OWNED_BRIDGE_SOURCE_DERIVATIVE');
 assert.equal(source.derivativeBaseCommit,'c53de6e43569febc515c445ca74292eac355f569');
 assert.equal(source.derivativeBaseSha256,HENGRUI_BASE_HASHES[relative]);
 assert.doesNotThrow(()=>hengruiSourceProvenance(source));
 assert.deepEqual(entry.provenance,hengruiSourceProvenance(source));
 assert.equal(entry.sha256,source.sha256);assert.equal(entry.bytes,source.bytes);
 const c53=source.priorProvenance;
 assert.equal(c53.classification,'BIOGEN_FIXED_HOST_SOURCE_DERIVATIVE');
 assert.equal(c53.derivativeBaseCommit,'0f7d297619d1f357a2da92682de9b62d7409733c');
 assert.equal(c53.derivativeBaseSha256,c53.priorProvenance.sha256);
 return c53.priorProvenance;
}
function assertLocalDerivative(relative,source,entry){
 if(relative==='src/db/ingestionRepository.ts'){
  assert.equal(source.classification,B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS);
  assert.doesNotThrow(()=>bTriggerCompletenessGuardSourceProvenance(source));
  assert.deepEqual(entry.provenance,bTriggerCompletenessGuardSourceProvenance(source));
  assert.equal(entry.sha256,source.sha256);assert.equal(entry.bytes,source.bytes);
  source=source.priorProvenance;entry={sha256:source.sha256,bytes:source.bytes,provenance:sharedCompletenessGuardSourceProvenance(source)};
  assert.equal(source.classification,SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS);
  assert.doesNotThrow(()=>sharedCompletenessGuardSourceProvenance(source));
  assert.deepEqual(entry.provenance,sharedCompletenessGuardSourceProvenance(source));
  assert.equal(entry.sha256,source.sha256);assert.equal(entry.bytes,source.bytes);
  const ancestor=source.priorProvenance;
  const oldEntry={sha256:ancestor.sha256,bytes:ancestor.bytes,provenance:{kind:'local-automation-source-derivative',originCommit:null,path:relative,sourceStatus:'LOCAL_UNREGISTERED',derivativeBaseCommit:baseCommit,derivativeBaseSha256:localBaseHashes[relative],ancestorOriginCommit,newBuildQualificationRequired:true}};
  return assertDirectLocalDerivative(relative,ancestor,oldEntry);
 }
 const ancestor=assertHengruiDerivative(relative,source,entry);
 const oldEntry={sha256:ancestor.sha256,bytes:ancestor.bytes,provenance:{kind:'local-automation-source-derivative',originCommit:null,path:relative,sourceStatus:'LOCAL_UNREGISTERED',derivativeBaseCommit:baseCommit,derivativeBaseSha256:localBaseHashes[relative],ancestorOriginCommit,newBuildQualificationRequired:true}};
 assertDirectLocalDerivative(relative,ancestor,oldEntry);
}
test('new connector gate files never inherit historical source origin',()=>{
 const entries=exported.entries.filter(f=>f.path.startsWith('tools/dot-auto-controller/connector-gate/'));
 assert(entries.length>0);
 for(const entry of entries){
  if(entry.path.includes('/connector-gate/hengrui')){
   const {sourceBasis,portInput,...base}=entry.provenance;
   assert.deepEqual(base,{kind:'new-hengrui-owned-bridge-source',originCommit:null,sourceStatus:'LOCAL_UNREGISTERED',productionQualified:false,newBuildQualificationRequired:true});
   if(entry.path.endsWith('/hengrui-synthetic-fixture.mts')){assert.equal(sourceBasis,'ORIGINAL_HENGRUI_CANDIDATE_DERIVATIVE');assert.deepEqual(portInput,{candidate:'hengrui-auto-adapter-candidate-20261016T0315Z',path:'connector-gate/hengrui-synthetic-fixture.mts',sha256:'70be97883ad332a1c8fae76cc1f4c46f906efd0fa8d6b504274e755558391037',bytes:9058});}
   else {assert.equal(sourceBasis,undefined);assert.equal(portInput,undefined);}
  }else if(/\/connector-gate\/(?:ucb[-.]|UCB_OWNED_BRIDGE\.md$)/.test(entry.path)){assert.deepEqual(entry.provenance,{kind:'new-ucb-owned-bridge-source',originCommit:null,sourceStatus:'LOCAL_UNREGISTERED',productionQualified:false,newBuildQualificationRequired:true});}
  else if(/\/connector-gate\/(?:viatris[-.]|VIATRIS_OWNED_BRIDGE\.md$)/.test(entry.path))assert.deepEqual(entry.provenance,{kind:'new-viatris-owned-bridge-source',originCommit:null,sourceStatus:'LOCAL_UNREGISTERED',productionQualified:false,newBuildQualificationRequired:true});
  else assert.deepEqual(entry.provenance,{kind:'new-connector-publication-review-source'});
 }
});
test('local compiler ancestor retains exact d02f base beneath the validated B/shared guard layers',()=>{
 const relative='src/db/ingestionRepository.ts',{source,entry}=records(relative);
 assertLocalDerivative(relative,source,entry);
});

test('integrated original worker derivatives preserve exact base hashes',()=>{
 for(const relative of ['src/crawler/cloudSourcePilotRelay.ts','scripts/p0-cloud-portable-source-pilot.ts']){
  const {source,entry}=records(relative);assertLocalDerivative(relative,source,entry);
 }
 const relative='src/crawler/cloudDbStartedPilot.ts',{source,entry}=records(relative);
 const ancestor=assertHengruiDerivative(relative,source,entry);
 assert.equal(ancestor.classification,'CONNECTOR_PUBLICATION_REVIEW_DERIVATIVE');
 assert.equal(ancestor.originSha256,'42d9f7df49559f1f969aba6296c7d6c9bab226d73fb9186ed6f86f87d54cb6b3');
 assert.equal(ancestor.derivativeBaseCommit,baseCommit);
 assert.equal(manifest.originCommit,ancestorOriginCommit);
});

test('local derivative contract rejects inherited origin or qualification',()=>{
 for(const relative of Object.keys(localBaseHashes)){
  for(const mutate of [
   ({source})=>{source.originCommit=ancestorOriginCommit;},
   ({entry})=>{entry.provenance.originCommit=ancestorOriginCommit;},
   ({source})=>{source.originSha256=localBaseHashes[relative];},
   ({source})=>{source.productionQualified=true;},
   ({entry})=>{entry.provenance.sourceStatus='REGISTERED';},
   ({entry})=>{entry.provenance.newBuildQualificationRequired=false;},
  ]){
   const pair=structuredClone(records(relative));mutate(pair);
   assert.throws(()=>assertLocalDerivative(relative,pair.source,pair.entry),{code:'ERR_ASSERTION'});
  }
 }
});

test('local derivative contract rejects wrong exact base hashes and ancestors',()=>{
 for(const relative of Object.keys(localBaseHashes)){
  for(const mutate of [
   ({source})=>{source.derivativeBaseSha256='0'.repeat(64);},
   ({entry})=>{entry.provenance.derivativeBaseSha256='0'.repeat(64);},
   ({source,entry})=>{source.derivativeBaseSha256=entry.provenance.derivativeBaseSha256='0'.repeat(64);},
   ({source,entry})=>{source.derivativeBaseCommit=entry.provenance.derivativeBaseCommit='0'.repeat(40);},
   ({source,entry})=>{source.ancestorOriginCommit=entry.provenance.ancestorOriginCommit='0'.repeat(40);},
  ]){
   const pair=structuredClone(records(relative));mutate(pair);
   assert.throws(()=>assertLocalDerivative(relative,pair.source,pair.entry),{code:'ERR_ASSERTION'});
  }
 }
});
