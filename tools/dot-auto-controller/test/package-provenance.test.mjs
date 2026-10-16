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
  if(source.classification==='NEW_CONNECTOR_HOST_SOURCE')assert.deepEqual(entry.provenance,{kind:'new-connector-host-source',path:relative,newBuildQualificationRequired:true},relative);
  else if(source.classification==='SCHEMA50_SOURCE_DERIVATIVE'){assert.equal(entry.provenance.kind,'schema50-source-derivative');assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.derivativeBaseCommit,'ea12881e9f8c7d1133b068bbbc0e483b9f020714');} else {assert.equal(source.classification,'LOCAL_AUTOMATION_SOURCE_DERIVATIVE',relative);assert.equal(entry.provenance.kind,'local-automation-source-derivative');assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.sourceStatus,'LOCAL_UNREGISTERED');assert.equal(entry.provenance.derivativeBaseCommit,'d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f');assert.match(entry.provenance.derivativeBaseSha256,/^[a-f0-9]{64}$/);assert.equal(entry.provenance.ancestorOriginCommit,undefined);}
 }
});
test('local automation source exports explicit null origin and only exact-history ancestors',()=>{
 const local=manifest.files.filter(f=>f.classification==='LOCAL_AUTOMATION_SOURCE_DERIVATIVE');assert.equal(local.length,5);
 for(const source of local){const entry=entryFor(source);assert.equal(source.originCommit,null);assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.sourceStatus,'LOCAL_UNREGISTERED');assert.equal(entry.provenance.newBuildQualificationRequired,true);
  if(source.path==='src/crawler/fixedJobProjectionSidecar.ts'){assert.equal(entry.provenance.ancestorOriginCommit,undefined);assert.equal(entry.provenance.derivativeBaseCommit,undefined);}
  else if(!source.path.startsWith('ops/cloud-pilot-host/')){assert.equal(entry.provenance.ancestorOriginCommit,manifest.originCommit);assert.equal(entry.provenance.derivativeBaseCommit,'d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f');assert.match(entry.provenance.derivativeBaseSha256,/^[a-f0-9]{64}$/);}
 }
});
test('historical C60 provenance retains original exact hashes and origin metadata',()=>{
 const historical=manifest.files.filter(f=>!['NEW_CONNECTOR_HOST_SOURCE','LOCAL_AUTOMATION_SOURCE_DERIVATIVE','SCHEMA50_SOURCE_DERIVATIVE'].includes(f.classification));assert(historical.length>0);
 for(const source of historical){const entry=entryFor(source);assert.equal(entry.provenance.originCommit,manifest.originCommit,source.path);assert.equal(entry.provenance.originCommitIsProvenanceOnly,true,source.path);assert.equal(entry.provenance.originSha256,source.originSha256,source.path);assert.equal(entry.provenance.newBuildQualificationRequired,true,source.path);}
});
test('generated build identity is excluded from source export',()=>{assert(!exported.entries.some(f=>f.path===prefix+'build-identity.json'));});
