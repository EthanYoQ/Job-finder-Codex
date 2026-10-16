import {retainedSharedGuardManifest} from './shared-completeness-guard-ancestry.mjs';
import {SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS,sharedCompletenessGuardSourceProvenance} from '../scripts/shared-completeness-guard-source-provenance.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'vendor/C60_SOURCE_MANIFEST.json'),'utf8'));
const exported=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/package-manifest.mjs')],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}));
const prefix='tools/dot-auto-controller/vendor/c60-source/';
const newHostPaths=['ops/cloud-pilot-host/CONNECTOR_BINDING.md','ops/cloud-pilot-host/connector-host-binding.mjs','ops/cloud-pilot-host/connector-host-launch.py','ops/cloud-pilot-host/connector-host.test.mjs'];
const entryFor=source=>{const entry=exported.entries.find(f=>f.path===prefix+source.path);assert(entry,source.path);assert.equal(entry.sha256,source.sha256,source.path);assert.equal(entry.bytes,source.bytes,source.path);return entry;};
test('PR5-added and subsequently modified connector host files never inherit a historical C60 origin',()=>{
 for(const relative of newHostPaths){
  const source=manifest.files.find(f=>f.path===relative);assert(source,relative);const entry=entryFor(source);
  if(source.classification==='FOUR_SOURCE_SEQUENCE_SOURCE_DERIVATIVE'){assert.equal(entry.provenance.kind,'four-source-sequence-source-derivative');assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.derivativeBaseCommit,'36bd3c5a6052159cac47609bbc58750012b74eb0');assert.equal(source.priorProvenance.classification,'SEQUENCE_FIXED_HOST_SOURCE_DERIVATIVE');} else if(source.classification==='SEQUENCE_FIXED_HOST_SOURCE_DERIVATIVE'){assert.equal(entry.provenance.kind,'sequence-fixed-host-source-derivative');assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.derivativeBaseCommit,'c53de6e43569febc515c445ca74292eac355f569');} else if(source.classification==='NEW_CONNECTOR_HOST_SOURCE')assert.deepEqual(entry.provenance,{kind:'new-connector-host-source',path:relative,newBuildQualificationRequired:true},relative);
  else if(source.classification==='SCHEMA50_SOURCE_DERIVATIVE'){assert.equal(entry.provenance.kind,'schema50-source-derivative');assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.derivativeBaseCommit,'ea12881e9f8c7d1133b068bbbc0e483b9f020714');} else {assert.equal(source.classification,'LOCAL_AUTOMATION_SOURCE_DERIVATIVE',relative);assert.equal(entry.provenance.kind,'local-automation-source-derivative');assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.sourceStatus,'LOCAL_UNREGISTERED');assert.equal(entry.provenance.derivativeBaseCommit,'d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f');assert.match(entry.provenance.derivativeBaseSha256,/^[a-f0-9]{64}$/);assert.equal(entry.provenance.ancestorOriginCommit,undefined);}
 }
});
test('both original local automation ancestors survive the validated shared guard layer',()=>{
 const local=retainedSharedGuardManifest.files.filter(f=>f.classification==='LOCAL_AUTOMATION_SOURCE_DERIVATIVE');assert.equal(local.length,2);
 for(const source of local){
  const current=manifest.files.find(f=>f.path===source.path),entry=entryFor(current);
  assert.equal(source.originCommit,null);assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.sourceStatus,'LOCAL_UNREGISTERED');assert.equal(entry.provenance.newBuildQualificationRequired,true);
  if(current.classification===SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS){assert.deepEqual(entry.provenance,sharedCompletenessGuardSourceProvenance(current));assert.deepEqual(entry.provenance.priorProvenance,source);}
  else {assert.deepEqual(current,source);assert.equal(entry.provenance.kind,'local-automation-source-derivative');}
  if(source.path==='src/crawler/fixedJobProjectionSidecar.ts'){assert.equal(source.ancestorOriginCommit,undefined);assert.equal(source.derivativeBaseCommit,undefined);assert.equal(entry.provenance.ancestorOriginCommit,undefined);assert.equal(entry.provenance.derivativeBaseCommit,undefined);}
  else if(!source.path.startsWith('ops/cloud-pilot-host/')){assert.equal(source.ancestorOriginCommit,manifest.originCommit);assert.equal(source.derivativeBaseCommit,'d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f');assert.match(source.derivativeBaseSha256,/^[a-f0-9]{64}$/);}
 }
});
test('historical C60 provenance retains original exact hashes and origin metadata',()=>{
 const historical=manifest.files.filter(f=>![SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS,'FOUR_SOURCE_SEQUENCE_SOURCE_DERIVATIVE','UCB_OWNED_BRIDGE_SOURCE_DERIVATIVE','UCB_OWNED_BRIDGE_NEW_SOURCE','HENGRUI_OWNED_BRIDGE_SOURCE_DERIVATIVE','HENGRUI_OWNED_BRIDGE_NEW_SOURCE','SEQUENCE_FIXED_HOST_SOURCE_DERIVATIVE','REQUEST_READY_SOURCE_DERIVATIVE','BIOGEN_FIXED_HOST_SOURCE_DERIVATIVE','NEW_CONNECTOR_HOST_SOURCE','LOCAL_AUTOMATION_SOURCE_DERIVATIVE','SCHEMA50_SOURCE_DERIVATIVE'].includes(f.classification));assert(historical.length>0);
 for(const source of historical){const entry=entryFor(source);assert.equal(entry.provenance.originCommit,manifest.originCommit,source.path);assert.equal(entry.provenance.originCommitIsProvenanceOnly,true,source.path);assert.equal(entry.provenance.originSha256,source.originSha256,source.path);assert.equal(entry.provenance.newBuildQualificationRequired,true,source.path);}
});
test('generated build identity is excluded from source export',()=>{assert(!exported.entries.some(f=>f.path===prefix+'build-identity.json'));});

test('Biogen and Hengrui ancestry survives the complete exact UCB layer',()=>{
 const chain=source=>{const rows=[];for(let row=source;row;row=row.priorProvenance)rows.push(row);return rows;};
 const files=manifest.files.filter(f=>chain(f).some(x=>x.classification==='BIOGEN_FIXED_HOST_SOURCE_DERIVATIVE'));assert.equal(files.length,3);
 for(const source of files){const entry=entryFor(source),ancestry=chain(source),biogen=ancestry.find(x=>x.classification==='BIOGEN_FIXED_HOST_SOURCE_DERIVATIVE');
  assert.equal(biogen.originCommit,null);assert.equal(biogen.derivativeBaseCommit,'0f7d297619d1f357a2da92682de9b62d7409733c');assert.equal(biogen.derivativeBaseSha256,biogen.priorProvenance.sha256);
  assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.newBuildQualificationRequired,true);assert.deepEqual(entry.provenance.priorProvenance,source.priorProvenance);
  if(source.classification==='UCB_OWNED_BRIDGE_SOURCE_DERIVATIVE'){assert.equal(source.derivativeBaseCommit,'48e56500bfe6a77ed712abfd54a98154cf963032');assert.equal(source.priorProvenance.classification,'HENGRUI_OWNED_BRIDGE_SOURCE_DERIVATIVE');}
 }
});

test('request ready derivatives never claim historical source origin',()=>{const files=manifest.files.filter(f=>f.classification==='REQUEST_READY_SOURCE_DERIVATIVE');assert.equal(files.length,5);for(const source of files){const entry=entryFor(source);assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.kind,'request-ready-source-derivative');assert.equal(entry.provenance.derivativeBaseCommit,'9d0a53374ba2a0e73d8edf67e3be0e768f019bb6');assert.equal(source.derivativeBaseSha256,source.priorProvenance.sha256);assert.equal(entry.provenance.newBuildQualificationRequired,true);}});

test('sequence derivatives retain exact c53 provenance and never relabel the baseline',()=>{const rows=manifest.files.filter(f=>f.classification==='FOUR_SOURCE_SEQUENCE_SOURCE_DERIVATIVE');assert.equal(rows.length,2);for(const current of rows){const entry=entryFor(current),row=current.priorProvenance;assert.equal(row.derivativeBaseCommit,'c53de6e43569febc515c445ca74292eac355f569');assert.equal(row.derivativeBaseSha256,row.priorProvenance.sha256);assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.newBuildQualificationRequired,true);}});
