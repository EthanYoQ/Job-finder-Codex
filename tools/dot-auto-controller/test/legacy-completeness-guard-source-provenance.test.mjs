// These assertions inspect the fully validated retained 36a03b8 view.
import {integrationSharedManifest,readIntegrationShared,integrationSharedExport,integrationAncestorEntry} from './viatris-shared-integration-layers.mjs';
import {retainedBTriggerGuardManifest,readBeforeBTriggerGuard} from './b-trigger-completeness-guard-ancestry.mjs';
import {ucbSourceProvenance} from '../scripts/ucb-source-provenance.mjs';
import {SHARED_COMPLETENESS_GUARD_BASE_COMMIT,SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS,SHARED_COMPLETENESS_GUARD_SOURCE_PATHS,refreshSharedCompletenessGuardSourceManifest} from '../scripts/shared-completeness-guard-source-provenance.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {LEGACY_COMPLETENESS_GUARD_BASE_COMMIT,LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS,LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS,LEGACY_COMPLETENESS_GUARD_BASE_HASHES,LEGACY_COMPLETENESS_GUARD_PRIOR_PROVENANCE_HASHES,legacyCompletenessGuardSourceProvenance,refreshLegacyCompletenessGuardSourceManifest} from '../scripts/legacy-completeness-guard-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..'),prefix='tools/dot-auto-controller/vendor/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=relative=>execFileSync('git',['show',LEGACY_COMPLETENESS_GUARD_BASE_COMMIT+':'+prefix+relative],{cwd:root,maxBuffer:8*1024*1024});
const base=JSON.parse(git('C60_SOURCE_MANIFEST.json')),current=retainedBTriggerGuardManifest;
const readSource=readBeforeBTriggerGuard;
const exported=integrationSharedExport(JSON.parse(execFileSync(process.execPath,[root+'/scripts/package-manifest.mjs'],{encoding:'utf8',maxBuffer:8*1024*1024})));
const records=current.files.filter(file=>file.classification===LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS);

test('exactly one local legacy guard derivative binds real a889c0 bytes and complete prior records',()=>{
 assert.equal(LEGACY_COMPLETENESS_GUARD_BASE_COMMIT,'a889c044d70edce569bf12e6971bcc7b64b0bcd3');
 assert.deepEqual(LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS,['scripts/p0-cloud-portable-source-pilot.ts']);
 assert.deepEqual(records.map(file=>file.path).sort(),[...LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS].sort());
 assert.equal(records.length,1);
 for(const file of records){
  const prior=base.files.find(entry=>entry.path===file.path),before=git('c60-source/'+file.path),now=readSource(file.path);
  assert.deepEqual(file.priorProvenance,prior);
  assert.equal(file.derivativeBaseCommit,LEGACY_COMPLETENESS_GUARD_BASE_COMMIT);
  assert.equal(file.derivativeBaseSha256,sha(before));assert.equal(file.derivativeBaseSha256,LEGACY_COMPLETENESS_GUARD_BASE_HASHES[file.path]);
  assert.equal(prior.sha256,sha(before));assert.equal(prior.bytes,before.length);
  assert.equal(file.priorProvenanceSha256,sha(JSON.stringify(prior)));assert.equal(file.priorProvenanceSha256,LEGACY_COMPLETENESS_GUARD_PRIOR_PROVENANCE_HASHES[file.path]);
  assert.equal(file.originCommit,null);assert.equal(file.originSha256,undefined);assert.equal(file.ancestorOriginCommit,undefined);assert.equal(file.productionQualified,false);
  assert.equal(file.sha256,sha(now));assert.equal(file.bytes,now.length);assert.notEqual(file.sha256,prior.sha256);
  const entry=exported.entries.find(item=>item.path===prefix+'c60-source/'+file.path);
  assert.equal(entry.sha256,file.sha256);assert.equal(entry.bytes,file.bytes);
  assert.deepEqual(entry.provenance,legacyCompletenessGuardSourceProvenance(file));
  assert.deepEqual(entry.provenance.priorProvenance,prior);assert.equal(entry.provenance.priorProvenanceSha256,file.priorProvenanceSha256);
  assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.productionQualified,false);assert.equal(entry.provenance.newBuildQualificationRequired,true);
 }
});

test('all other 876 retained pre-B vendor records, bytes, order and metadata remain exact a889c0',()=>{
 const metadata=manifest=>Object.fromEntries(Object.entries(manifest).filter(([key])=>key!=='files'));
 assert.deepEqual(metadata(current),metadata(base));assert.equal(base.files.length,877);assert.equal(current.files.length,877);
 assert.deepEqual(current.files.map(file=>file.path),base.files.map(file=>file.path));
 const others=base.files.filter(file=>!LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS.includes(file.path));assert.equal(others.length,876);
 for(const file of others){assert.deepEqual(current.files.find(entry=>entry.path===file.path),file);const bytes=readSource(file.path);assert.equal(sha(bytes),file.sha256,file.path);assert.equal(bytes.length,file.bytes,file.path);}
});

test('refresh from the exact base or current layer produces the same single-record manifest',()=>{
 assert.deepEqual(refreshLegacyCompletenessGuardSourceManifest({baseManifest:base,currentManifest:base,readSource}),current);
 assert.deepEqual(refreshLegacyCompletenessGuardSourceManifest({baseManifest:base,currentManifest:current,readSource}),current);
});

test('legacy retains the full UCB, Hengrui, Biogen and d02f ancestry without inheriting qualification',()=>{
 const file=records[0],chain=[];for(let ancestor=file.priorProvenance;ancestor;ancestor=ancestor.priorProvenance)chain.push(ancestor);
 assert.deepEqual(chain.map(ancestor=>ancestor.classification),['UCB_OWNED_BRIDGE_SOURCE_DERIVATIVE','HENGRUI_OWNED_BRIDGE_SOURCE_DERIVATIVE','BIOGEN_FIXED_HOST_SOURCE_DERIVATIVE','LOCAL_AUTOMATION_SOURCE_DERIVATIVE']);
 assert.deepEqual(chain.map(ancestor=>ancestor.derivativeBaseCommit),['48e56500bfe6a77ed712abfd54a98154cf963032','c53de6e43569febc515c445ca74292eac355f569','0f7d297619d1f357a2da92682de9b62d7409733c','d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f']);
 assert(ucbSourceProvenance(file.priorProvenance));
 assert.equal(chain[3].derivativeBaseSha256,'a62a002c67716551ed23af7263b08a3d2d6486efcf31d9b4889b7042731fe98f');
 assert.equal(chain[3].ancestorOriginCommit,'3a2400768e8b087b8600dd05e1a32ac006bd7102');assert.equal(file.ancestorOriginCommit,undefined);
 for(const ancestor of chain){assert.equal(ancestor.originCommit,null);assert.equal(ancestor.productionQualified,false);}
});

test('the original three shared records, bytes and 962979 provenance implementation stay unchanged',()=>{
 assert.deepEqual(SHARED_COMPLETENESS_GUARD_SOURCE_PATHS,['src/crawler/completenessAnomalyPolicy.ts','src/crawler/runCrawlBatch.ts','src/db/ingestionRepository.ts']);
 const shared=current.files.filter(file=>file.classification===SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS);assert.equal(shared.length,3);
 for(const file of shared){assert.deepEqual(file,base.files.find(prior=>prior.path===file.path));assert.equal(sha(readSource(file.path)),file.sha256);}
 for(const script of ['shared-completeness-guard-source-provenance.mjs','refresh-shared-completeness-guard-source-provenance.mjs']){
  const prior=execFileSync('git',['show',LEGACY_COMPLETENESS_GUARD_BASE_COMMIT+':tools/dot-auto-controller/scripts/'+script],{cwd:root});assert(fs.readFileSync(root+'/scripts/'+script).equals(prior));
 }
});

test('legacy refresh cannot absorb a fourth-file scope into the original three-file refresher',()=>{
 const prior=JSON.parse(execFileSync('git',['show',SHARED_COMPLETENESS_GUARD_BASE_COMMIT+':'+prefix+'C60_SOURCE_MANIFEST.json'],{cwd:root,maxBuffer:8*1024*1024}));
 assert.throws(()=>refreshSharedCompletenessGuardSourceManifest({baseManifest:prior,currentManifest:current,readSource}),/SHARED_COMPLETENESS_GUARD_UNRELATED_PROVENANCE_CHANGED/);
 for(const target of SHARED_COMPLETENESS_GUARD_SOURCE_PATHS)assert.throws(()=>refreshLegacyCompletenessGuardSourceManifest({baseManifest:base,currentManifest:current,readSource:relative=>relative===target?Buffer.from('unreviewed shared change'):readSource(relative)}),/LEGACY_COMPLETENESS_GUARD_UNRELATED_SOURCE_CHANGED/);
});

for(const [name,mutate]of [
 ['historical-origin',file=>file.originCommit=base.originCommit],
 ['inherited-origin-hash',file=>file.originSha256=file.derivativeBaseSha256],
 ['inherited-ancestor-origin',file=>file.ancestorOriginCommit=base.originCommit],
 ['qualified',file=>file.productionQualified=true],
 ['wrong-parent',file=>file.derivativeBaseCommit='0'.repeat(40)],
 ['wrong-parent-bytes',file=>file.derivativeBaseSha256='0'.repeat(64)],
 ['missing-prior',file=>delete file.priorProvenance],
 ['rewritten-prior',file=>file.priorProvenance.bytes++],
 ['truncated-prior',file=>delete file.priorProvenance.classification],
 ['truncated-ucb-hengrui-chain',file=>delete file.priorProvenance.priorProvenance],
 ['rewritten-biogen-ancestor',file=>file.priorProvenance.priorProvenance.priorProvenance.derivativeBaseCommit='0'.repeat(40)],
 ['missing-prior-hash',file=>delete file.priorProvenanceSha256],
 ['wrong-prior-hash',file=>file.priorProvenanceSha256='0'.repeat(64)],
 ['forged-prior-with-rehashed-proof',file=>{file.priorProvenance.bytes++;file.priorProvenanceSha256=sha(JSON.stringify(file.priorProvenance));}],
 ['foreign-source',file=>file.path='src/unknown.ts'],
 ['swapped-prior',file=>file.priorProvenance=structuredClone(base.files.find(entry=>entry.path==='src/db/ingestionRepository.ts'))],
 ['unchanged-bytes',file=>file.sha256=file.derivativeBaseSha256],
 ['invalid-current-hash',file=>file.sha256='not-a-hash'],
 ['invalid-byte-count',file=>file.bytes=-1],
])test('legacy guard validator rejects '+name,()=>{
 for(const original of records){const file=structuredClone(original);mutate(file);assert.throws(()=>legacyCompletenessGuardSourceProvenance(file),/LEGACY_COMPLETENESS_GUARD_/);}
});

test('refresh rejects an altered base, even when both supplied manifests agree',()=>{
 const forged=structuredClone(base);forged.files.find(file=>!LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS.includes(file.path)).classification='FORGED';
 assert.throws(()=>refreshLegacyCompletenessGuardSourceManifest({baseManifest:forged,currentManifest:forged,readSource}),/EXACT_BASE_MANIFEST_REQUIRED/);
});

for(const [name,mutate,pattern]of [
 ['unrelated-metadata',manifest=>manifest.productionQualified=true,/UNRELATED_MANIFEST_METADATA_CHANGED/],
 ['unrelated-record',manifest=>manifest.files.find(file=>!LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS.includes(file.path)).sha256='0'.repeat(64),/UNRELATED_PROVENANCE_CHANGED/],
 ['new-record',manifest=>manifest.files.push({path:'src/unrelated.ts'}),/UNRELATED_NEW_SOURCE_ENTRY/],
 ['missing-record',manifest=>manifest.files.pop(),/EXISTING_SOURCE_ENTRY_REMOVED/],
 ['duplicate-record',manifest=>manifest.files.push(structuredClone(manifest.files[0])),/DUPLICATE_SOURCE_ENTRY/],
 ['rewritten-prior',manifest=>manifest.files.find(file=>file.classification===LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS).priorProvenance.bytes++,/EXACT_A889C0_ANCESTRY/],
 ['relabelled-derivative',manifest=>manifest.files.find(file=>file.classification===LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS).classification='EXACT_HISTORICAL_FILE_BYTES',/UNREVIEWED_SOURCE_PROVENANCE/],
])test('refresh rejects '+name,()=>{
 const manifest=structuredClone(current);mutate(manifest);
 assert.throws(()=>refreshLegacyCompletenessGuardSourceManifest({baseManifest:base,currentManifest:manifest,readSource}),pattern);
});

test('refresh refuses unrelated byte changes and unchanged target bytes',()=>{
 const other=base.files.find(file=>!LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS.includes(file.path)).path;
 assert.throws(()=>refreshLegacyCompletenessGuardSourceManifest({baseManifest:base,currentManifest:current,readSource:relative=>relative===other?Buffer.from('unreviewed bytes'):readSource(relative)}),/UNRELATED_SOURCE_CHANGED/);
 for(const target of LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS)assert.throws(()=>refreshLegacyCompletenessGuardSourceManifest({baseManifest:base,currentManifest:current,readSource:relative=>relative===target?git('c60-source/'+relative):readSource(relative)}),/DERIVATIVE_MUST_CHANGE_BYTES/);
});

test('refresh can update target bytes without rewriting any ancestor or other current record',()=>{
 const target=LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS[0],bytes=Buffer.concat([readSource(target),Buffer.from('\n// provenance test fixture\n')]);
 const refreshed=refreshLegacyCompletenessGuardSourceManifest({baseManifest:base,currentManifest:current,readSource:relative=>relative===target?bytes:readSource(relative)});
 for(const file of refreshed.files){const before=current.files.find(entry=>entry.path===file.path);if(file.path!==target)assert.deepEqual(file,before);else{assert.deepEqual({...file,sha256:before.sha256,bytes:before.bytes},before);assert.equal(file.sha256,sha(bytes));assert.equal(file.bytes,bytes.length);}}
});

/** Run the real exporter in an isolated minimal source-only fixture, never edit the candidate. */
function withExporterFixture(run){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-guard-provenance-'));
 const write=(relative,bytes)=>{const full=path.join(temporary,relative);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,bytes);};
 const file=structuredClone(records[0]);
 try{
  for(const script of ['package-manifest.mjs','b-trigger-completeness-guard-source-provenance.mjs','legacy-completeness-guard-source-provenance.mjs','shared-completeness-guard-source-provenance.mjs','four-source-provenance.mjs','ucb-source-provenance.mjs','hengrui-source-provenance.mjs'])write('scripts/'+script,execFileSync('git',['show','36a03b847f66e8d68d68e2cff1f00fd6b4b83b51:tools/dot-auto-controller/scripts/'+script],{cwd:root}));
  for(const name of ['READER_MAIN_SOURCE_MANIFEST.json','READER_FALLBACK_SOURCE_MANIFEST.json'])write('vendor/'+name,JSON.stringify({files:[]}));
  write('config/hengrui-port-provenance.json',JSON.stringify({originCommit:null,productionQualified:false,files:[]}));
  const setRecord=record=>write('vendor/C60_SOURCE_MANIFEST.json',JSON.stringify({originCommit:base.originCommit,files:[record]}));
  const setBytes=bytes=>write('vendor/c60-source/'+file.path,bytes);
  const exportFixture=()=>execFileSync(process.execPath,[temporary+'/scripts/package-manifest.mjs'],{encoding:'utf8',maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});
  setRecord(file);setBytes(readSource(file.path));run({file,setRecord,setBytes,exportFixture});
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}

test('retained 36a03b8 legacy exporter rejects relabelling, stale bytes and forged ancestry',()=>withExporterFixture(({file,setRecord,setBytes,exportFixture})=>{
 assert.doesNotThrow(exportFixture);
 const relabelled={...file,classification:'EXACT_HISTORICAL_FILE_BYTES'};setRecord(relabelled);assert.throws(exportFixture,/LEGACY_COMPLETENESS_GUARD_CLASS_REQUIRED/);
 setRecord(file);setBytes(Buffer.from('tampered current bytes'));assert.throws(exportFixture,/LEGACY_COMPLETENESS_GUARD_CURRENT_BYTES_MISMATCH/);
 setBytes(readSource(file.path));const forged=structuredClone(file);forged.priorProvenance.bytes++;forged.priorProvenanceSha256=sha(JSON.stringify(forged.priorProvenance));setRecord(forged);assert.throws(exportFixture,/LEGACY_COMPLETENESS_GUARD_EXACT_A889C0_ANCESTRY/);
}));
