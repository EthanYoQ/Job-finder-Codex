import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {viatrisSourceProvenance,VIATRIS_BASE_COMMIT} from '../scripts/viatris-source-provenance.mjs';
import {ucbSourceProvenance,UCB_BASE_COMMIT} from '../scripts/ucb-source-provenance.mjs';
import {hengruiSourceProvenance,HENGRUI_BASE_HASHES} from '../scripts/hengrui-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'vendor/C60_SOURCE_MANIFEST.json')));
const exported=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/package-manifest.mjs')],{encoding:'utf8',maxBuffer:4*1024*1024}));
const gitBytes=(commit,relative)=>execFileSync('git',['show',commit+':tools/dot-auto-controller/vendor/'+relative],{cwd:root,maxBuffer:8*1024*1024});
const frozenManifests=new Map([VIATRIS_BASE_COMMIT,UCB_BASE_COMMIT].map(commit=>[commit,JSON.parse(gitBytes(commit,'C60_SOURCE_MANIFEST.json'))]));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
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
// Peel each validated Viatris and UCB layer, comparing its entire retained
// record and input bytes with the original Git parent before testing Hengrui.
function assertHengruiDerivative(relative,source,entry){
 assert(source,relative);assert(entry,relative);
 assert.equal(sha(fs.readFileSync(path.join(root,'vendor/c60-source',relative))),source.sha256);
 for(const [classification,validator,parentCommit,nextValidator] of [
  ['VIATRIS_OWNED_BRIDGE_SOURCE_DERIVATIVE',viatrisSourceProvenance,VIATRIS_BASE_COMMIT,ucbSourceProvenance],
  ['UCB_OWNED_BRIDGE_SOURCE_DERIVATIVE',ucbSourceProvenance,UCB_BASE_COMMIT,hengruiSourceProvenance],
 ]){
  assert.equal(source.classification,classification);
  assert.doesNotThrow(()=>validator(source));
  assert.deepEqual(entry.provenance,validator(source));
  assert.equal(entry.sha256,source.sha256);assert.equal(entry.bytes,source.bytes);
  assert.equal(source.derivativeBaseCommit,parentCommit);
  const original=frozenManifests.get(parentCommit).files.find(file=>file.path===relative),bytes=gitBytes(parentCommit,'c60-source/'+relative);
  assert.deepEqual(source.priorProvenance,original);
  assert.equal(source.derivativeBaseSha256,sha(bytes));assert.equal(original.sha256,sha(bytes));assert.equal(original.bytes,bytes.length);
  source=source.priorProvenance;
  entry={...entry,sha256:source.sha256,bytes:source.bytes,provenance:nextValidator(source)};
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
 if(relative==='src/db/ingestionRepository.ts')return assertDirectLocalDerivative(relative,source,entry);
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
  }else if(/\/connector-gate\/(?:ucb[-.]|UCB_OWNED_BRIDGE\.md$)/.test(entry.path))assert.deepEqual(entry.provenance,{kind:'new-ucb-owned-bridge-source',originCommit:null,sourceStatus:'LOCAL_UNREGISTERED',productionQualified:false,newBuildQualificationRequired:true});
  else if(/\/connector-gate\/(?:viatris[-.]|VIATRIS_OWNED_BRIDGE\.md$)/.test(entry.path))assert.deepEqual(entry.provenance,{kind:'new-viatris-owned-bridge-source',originCommit:null,sourceStatus:'LOCAL_UNREGISTERED',productionQualified:false,newBuildQualificationRequired:true});
  else assert.deepEqual(entry.provenance,{kind:'new-connector-publication-review-source'});
 }
});
test('local compiler derivative retains exact d02f base without inheriting source qualification',()=>{
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
