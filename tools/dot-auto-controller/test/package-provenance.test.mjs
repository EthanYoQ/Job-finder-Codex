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
test('PR5-added connector host files never inherit a historical C60 origin',()=>{
 for(const relative of newHostPaths){
  const source=manifest.files.find(f=>f.path===relative),entry=exported.entries.find(f=>f.path===prefix+relative);
  assert(source&&entry,relative);
  assert.equal(source.classification,'NEW_CONNECTOR_HOST_SOURCE',relative);
  assert.equal(entry.sha256,source.sha256,relative);assert.equal(entry.bytes,source.bytes,relative);
  assert.deepEqual(entry.provenance,{kind:'new-connector-host-source',path:relative,newBuildQualificationRequired:true},relative);
 }
});
test('historical C60 provenance still exports its existing exact origin metadata',()=>{
 const historical=manifest.files.filter(f=>f.classification!=='NEW_CONNECTOR_HOST_SOURCE');
 assert(historical.length>0);
 for(const source of historical){
  const entry=exported.entries.find(f=>f.path===prefix+source.path);assert(entry,source.path);
  assert.equal(entry.provenance.originCommit,manifest.originCommit,source.path);
  assert.equal(entry.provenance.originCommitIsProvenanceOnly,true,source.path);
  assert.equal(entry.provenance.originSha256,source.originSha256,source.path);
  assert.equal(entry.provenance.newBuildQualificationRequired,true,source.path);
 }
});
