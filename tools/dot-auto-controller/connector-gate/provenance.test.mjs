import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'vendor/C60_SOURCE_MANIFEST.json')));
const exported=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/package-manifest.mjs')],{encoding:'utf8',maxBuffer:4*1024*1024}));
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
function assertLocalDerivative(relative,source,entry){
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
test('new connector gate files never inherit historical source origin',()=>{
 const entries=exported.entries.filter(f=>f.path.startsWith('tools/dot-auto-controller/connector-gate/'));
 assert(entries.length>0);
 for(const entry of entries)assert.deepEqual(entry.provenance,{kind:'new-connector-publication-review-source'});
});
test('local compiler derivative retains exact d02f base without inheriting source qualification',()=>{
 const relative='src/db/ingestionRepository.ts',{source,entry}=records(relative);
 assertLocalDerivative(relative,source,entry);
});

test('integrated original worker derivatives preserve exact base hashes',()=>{
 for(const relative of ['src/crawler/cloudSourcePilotRelay.ts','scripts/p0-cloud-portable-source-pilot.ts']){
  const {source,entry}=records(relative);assertLocalDerivative(relative,source,entry);
 }
 // This worker was not reclassified by the local automation changes.
 const relative='src/crawler/cloudDbStartedPilot.ts',{source,entry}=records(relative);
 const hash='42d9f7df49559f1f969aba6296c7d6c9bab226d73fb9186ed6f86f87d54cb6b3';
 assert(source,relative);assert(entry,relative);
 assert.equal(source.classification,'CONNECTOR_PUBLICATION_REVIEW_DERIVATIVE');
 assert.equal(source.originSha256,hash);assert.equal(source.derivativeBaseCommit,baseCommit);
 assert.deepEqual(entry.provenance,{
  kind:'connector-publication-review-derivative',originCommit:ancestorOriginCommit,
  originCommitIsProvenanceOnly:true,path:relative,originSha256:hash,
  derivativeBaseCommit:baseCommit,newBuildQualificationRequired:true,
 });
 assert.equal(entry.sha256,source.sha256);assert.equal(entry.bytes,source.bytes);
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
