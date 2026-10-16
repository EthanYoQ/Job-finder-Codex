// These assertions inspect the fully validated retained 36a03b8 view.
import {integrationSharedManifest,readIntegrationShared,integrationSharedExport,integrationAncestorEntry} from './viatris-shared-integration-layers.mjs';
import {sharedCompletenessGuardSourceProvenance} from '../scripts/shared-completeness-guard-source-provenance.mjs';
import {LEGACY_COMPLETENESS_GUARD_BASE_COMMIT,LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS,LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS,legacyCompletenessGuardSourceProvenance,refreshLegacyCompletenessGuardSourceManifest} from '../scripts/legacy-completeness-guard-source-provenance.mjs';
import {SHARED_COMPLETENESS_GUARD_BASE_COMMIT,SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS,SHARED_COMPLETENESS_GUARD_SOURCE_PATHS,refreshSharedCompletenessGuardSourceManifest} from '../scripts/shared-completeness-guard-source-provenance.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {B_TRIGGER_COMPLETENESS_GUARD_BASE_COMMIT,B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS,B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS,B_TRIGGER_COMPLETENESS_GUARD_BASE_HASHES,B_TRIGGER_COMPLETENESS_GUARD_PRIOR_PROVENANCE_HASHES,bTriggerCompletenessGuardSourceProvenance,refreshBTriggerCompletenessGuardSourceManifest} from '../scripts/b-trigger-completeness-guard-source-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..'),prefix='tools/dot-auto-controller/vendor/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=relative=>execFileSync('git',['show',B_TRIGGER_COMPLETENESS_GUARD_BASE_COMMIT+':'+prefix+relative],{cwd:root,maxBuffer:8*1024*1024});
const base=JSON.parse(git('C60_SOURCE_MANIFEST.json')),current=integrationSharedManifest;
const readSource=relative=>readIntegrationShared(relative);
const exported=integrationSharedExport(JSON.parse(execFileSync(process.execPath,[root+'/scripts/package-manifest.mjs'],{encoding:'utf8',maxBuffer:8*1024*1024})));
const records=current.files.filter(file=>file.classification===B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS);

test('exactly one local B-trigger guard derivative binds real f7c011 bytes and complete prior records',()=>{
 assert.equal(B_TRIGGER_COMPLETENESS_GUARD_BASE_COMMIT,'f7c0118b5c7acb165c267430216af33a1ea9809b');
 assert.deepEqual(B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS,['src/db/ingestionRepository.ts']);
 assert.deepEqual(records.map(file=>file.path).sort(),[...B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS].sort());
 assert.equal(records.length,1);
 for(const file of records){
  const prior=base.files.find(entry=>entry.path===file.path),before=git('c60-source/'+file.path),now=readSource(file.path);
  assert.deepEqual(file.priorProvenance,prior);
  assert.equal(file.derivativeBaseCommit,B_TRIGGER_COMPLETENESS_GUARD_BASE_COMMIT);
  assert.equal(file.derivativeBaseSha256,sha(before));assert.equal(file.derivativeBaseSha256,B_TRIGGER_COMPLETENESS_GUARD_BASE_HASHES[file.path]);
  assert.equal(prior.sha256,sha(before));assert.equal(prior.bytes,before.length);
  assert.equal(file.priorProvenanceSha256,sha(JSON.stringify(prior)));assert.equal(file.priorProvenanceSha256,B_TRIGGER_COMPLETENESS_GUARD_PRIOR_PROVENANCE_HASHES[file.path]);
  assert.equal(file.originCommit,null);assert.equal(file.originSha256,undefined);assert.equal(file.ancestorOriginCommit,undefined);assert.equal(file.productionQualified,false);
  assert.equal(file.sha256,sha(now));assert.equal(file.bytes,now.length);assert.notEqual(file.sha256,prior.sha256);
  const entry=exported.entries.find(item=>item.path===prefix+'c60-source/'+file.path);
  assert.equal(entry.sha256,file.sha256);assert.equal(entry.bytes,file.bytes);
  assert.deepEqual(entry.provenance,bTriggerCompletenessGuardSourceProvenance(file));
  assert.deepEqual(entry.provenance.priorProvenance,prior);assert.equal(entry.provenance.priorProvenanceSha256,file.priorProvenanceSha256);
  assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.productionQualified,false);assert.equal(entry.provenance.newBuildQualificationRequired,true);
 }
});

test('all other 876 vendor records, bytes, order and top-level metadata remain exact f7c011',()=>{
 const metadata=manifest=>Object.fromEntries(Object.entries(manifest).filter(([key])=>key!=='files'));
 assert.deepEqual(metadata(current),metadata(base));assert.equal(base.files.length,877);assert.equal(current.files.length,877);
 assert.deepEqual(current.files.map(file=>file.path),base.files.map(file=>file.path));
 const others=base.files.filter(file=>!B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS.includes(file.path));assert.equal(others.length,876);
 for(const file of others){assert.deepEqual(current.files.find(entry=>entry.path===file.path),file);const bytes=readSource(file.path);assert.equal(sha(bytes),file.sha256,file.path);assert.equal(bytes.length,file.bytes,file.path);}
});

test('refresh from the exact base or current layer produces the same single-record manifest',()=>{
 assert.deepEqual(refreshBTriggerCompletenessGuardSourceManifest({baseManifest:base,currentManifest:base,readSource}),current);
 assert.deepEqual(refreshBTriggerCompletenessGuardSourceManifest({baseManifest:base,currentManifest:current,readSource}),current);
});

test('B-trigger retains the full shared-962979 and d02f ancestry without inheriting qualification',()=>{
 const file=records[0],chain=[];for(let ancestor=file.priorProvenance;ancestor;ancestor=ancestor.priorProvenance)chain.push(ancestor);
 assert.deepEqual(chain.map(ancestor=>ancestor.classification),['SHARED_COMPLETENESS_GUARD_SOURCE_DERIVATIVE','LOCAL_AUTOMATION_SOURCE_DERIVATIVE']);
 assert.deepEqual(chain.map(ancestor=>ancestor.derivativeBaseCommit),['9629790860e68df0a8f09fb14f7ab05e1a2fbbfa','d02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f']);
 assert(sharedCompletenessGuardSourceProvenance(file.priorProvenance));
 assert.equal(chain[1].derivativeBaseSha256,'56a16ca89ae417c1613cb37f7beb53db82dbc55f181219c6db7f48b7e487223b');
 assert.equal(chain[1].ancestorOriginCommit,'3a2400768e8b087b8600dd05e1a32ac006bd7102');assert.equal(file.ancestorOriginCommit,undefined);
 for(const ancestor of chain){assert.equal(ancestor.originCommit,null);assert.equal(ancestor.productionQualified,false);}
});

test('the exact shared and legacy layers survive beneath B with all four original provenance scripts unchanged',()=>{
 assert.deepEqual(SHARED_COMPLETENESS_GUARD_SOURCE_PATHS,['src/crawler/completenessAnomalyPolicy.ts','src/crawler/runCrawlBatch.ts','src/db/ingestionRepository.ts']);
 assert.deepEqual(LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS,['scripts/p0-cloud-portable-source-pilot.ts']);
 const retained=current.files.map(file=>file.classification===B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS?file.priorProvenance:file);
 const shared=retained.filter(file=>file.classification===SHARED_COMPLETENESS_GUARD_DERIVATIVE_CLASS);assert.equal(shared.length,3);
 const legacy=retained.filter(file=>file.classification===LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS);assert.equal(legacy.length,1);
 for(const file of [...shared,...legacy]){
  assert.deepEqual(file,base.files.find(prior=>prior.path===file.path));
  const bytes=B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS.includes(file.path)?git('c60-source/'+file.path):readSource(file.path);assert.equal(sha(bytes),file.sha256);assert.equal(bytes.length,file.bytes);
 }
 for(const script of ['shared-completeness-guard-source-provenance.mjs','refresh-shared-completeness-guard-source-provenance.mjs','legacy-completeness-guard-source-provenance.mjs','refresh-legacy-completeness-guard-source-provenance.mjs']){
  const prior=execFileSync('git',['show',B_TRIGGER_COMPLETENESS_GUARD_BASE_COMMIT+':tools/dot-auto-controller/scripts/'+script],{cwd:root});assert(fs.readFileSync(root+'/scripts/'+script).equals(prior));
 }
});

test('old refreshers reject the B layer and the B refresher rejects changes to the other guards',()=>{
 const at=(commit,relative)=>execFileSync('git',['show',commit+':'+prefix+relative],{cwd:root,maxBuffer:8*1024*1024});
 const legacyBase=JSON.parse(at(LEGACY_COMPLETENESS_GUARD_BASE_COMMIT,'C60_SOURCE_MANIFEST.json'));
 assert.throws(()=>refreshLegacyCompletenessGuardSourceManifest({baseManifest:legacyBase,currentManifest:current,readSource}),/LEGACY_COMPLETENESS_GUARD_UNRELATED_PROVENANCE_CHANGED:src\/db\/ingestionRepository\.ts/);
 const legacy=current.files.find(file=>file.classification===LEGACY_COMPLETENESS_GUARD_DERIVATIVE_CLASS);assert(legacyCompletenessGuardSourceProvenance(legacy));
 const beforeLegacy={...current,files:current.files.map(file=>file===legacy?file.priorProvenance:file)};
 const sharedBase=JSON.parse(at(SHARED_COMPLETENESS_GUARD_BASE_COMMIT,'C60_SOURCE_MANIFEST.json'));
 const readBeforeLegacy=relative=>relative===legacy.path?at(LEGACY_COMPLETENESS_GUARD_BASE_COMMIT,'c60-source/'+relative):readSource(relative);
 assert.throws(()=>refreshSharedCompletenessGuardSourceManifest({baseManifest:sharedBase,currentManifest:beforeLegacy,readSource:readBeforeLegacy}),/SHARED_COMPLETENESS_GUARD_UNREVIEWED_SOURCE_PROVENANCE:src\/db\/ingestionRepository\.ts/);
 for(const target of [...SHARED_COMPLETENESS_GUARD_SOURCE_PATHS,...LEGACY_COMPLETENESS_GUARD_SOURCE_PATHS].filter(relative=>!B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS.includes(relative)))assert.throws(()=>refreshBTriggerCompletenessGuardSourceManifest({baseManifest:base,currentManifest:current,readSource:relative=>relative===target?Buffer.from('unreviewed other guard change'):readSource(relative)}),/B_TRIGGER_COMPLETENESS_GUARD_UNRELATED_SOURCE_CHANGED/);
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
 ['truncated-shared-d02f-chain',file=>delete file.priorProvenance.priorProvenance],
 ['rewritten-d02f-ancestor',file=>file.priorProvenance.priorProvenance.derivativeBaseCommit='0'.repeat(40)],
 ['missing-prior-hash',file=>delete file.priorProvenanceSha256],
 ['wrong-prior-hash',file=>file.priorProvenanceSha256='0'.repeat(64)],
 ['forged-prior-with-rehashed-proof',file=>{file.priorProvenance.bytes++;file.priorProvenanceSha256=sha(JSON.stringify(file.priorProvenance));}],
 ['foreign-source',file=>file.path='src/unknown.ts'],
 ['swapped-prior',file=>file.priorProvenance=structuredClone(base.files.find(entry=>entry.path==='scripts/p0-cloud-portable-source-pilot.ts'))],
 ['unchanged-bytes',file=>file.sha256=file.derivativeBaseSha256],
 ['invalid-current-hash',file=>file.sha256='not-a-hash'],
 ['invalid-byte-count',file=>file.bytes=-1],
])test('B-trigger guard validator rejects '+name,()=>{
 for(const original of records){const file=structuredClone(original);mutate(file);assert.throws(()=>bTriggerCompletenessGuardSourceProvenance(file),/B_TRIGGER_COMPLETENESS_GUARD_/);}
});

test('refresh rejects an altered base, even when both supplied manifests agree',()=>{
 const forged=structuredClone(base);forged.files.find(file=>!B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS.includes(file.path)).classification='FORGED';
 assert.throws(()=>refreshBTriggerCompletenessGuardSourceManifest({baseManifest:forged,currentManifest:forged,readSource}),/EXACT_BASE_MANIFEST_REQUIRED/);
});

for(const [name,mutate,pattern]of [
 ['unrelated-metadata',manifest=>manifest.productionQualified=true,/UNRELATED_MANIFEST_METADATA_CHANGED/],
 ['unrelated-record',manifest=>manifest.files.find(file=>!B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS.includes(file.path)).sha256='0'.repeat(64),/UNRELATED_PROVENANCE_CHANGED/],
 ['new-record',manifest=>manifest.files.push({path:'src/unrelated.ts'}),/UNRELATED_NEW_SOURCE_ENTRY/],
 ['missing-record',manifest=>manifest.files.pop(),/EXISTING_SOURCE_ENTRY_REMOVED/],
 ['duplicate-record',manifest=>manifest.files.push(structuredClone(manifest.files[0])),/DUPLICATE_SOURCE_ENTRY/],
 ['rewritten-prior',manifest=>manifest.files.find(file=>file.classification===B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS).priorProvenance.bytes++,/EXACT_F7C011_ANCESTRY/],
 ['relabelled-derivative',manifest=>manifest.files.find(file=>file.classification===B_TRIGGER_COMPLETENESS_GUARD_DERIVATIVE_CLASS).classification='EXACT_HISTORICAL_FILE_BYTES',/UNREVIEWED_SOURCE_PROVENANCE/],
])test('refresh rejects '+name,()=>{
 const manifest=structuredClone(current);mutate(manifest);
 assert.throws(()=>refreshBTriggerCompletenessGuardSourceManifest({baseManifest:base,currentManifest:manifest,readSource}),pattern);
});

test('refresh refuses unrelated byte changes and unchanged target bytes',()=>{
 const other=base.files.find(file=>!B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS.includes(file.path)).path;
 assert.throws(()=>refreshBTriggerCompletenessGuardSourceManifest({baseManifest:base,currentManifest:current,readSource:relative=>relative===other?Buffer.from('unreviewed bytes'):readSource(relative)}),/UNRELATED_SOURCE_CHANGED/);
 for(const target of B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS)assert.throws(()=>refreshBTriggerCompletenessGuardSourceManifest({baseManifest:base,currentManifest:current,readSource:relative=>relative===target?git('c60-source/'+relative):readSource(relative)}),/DERIVATIVE_MUST_CHANGE_BYTES/);
});

test('refresh can update target bytes without rewriting any ancestor or other current record',()=>{
 const target=B_TRIGGER_COMPLETENESS_GUARD_SOURCE_PATHS[0],bytes=Buffer.concat([readSource(target),Buffer.from('\n// provenance test fixture\n')]);
 const refreshed=refreshBTriggerCompletenessGuardSourceManifest({baseManifest:base,currentManifest:current,readSource:relative=>relative===target?bytes:readSource(relative)});
 for(const file of refreshed.files){const before=current.files.find(entry=>entry.path===file.path);if(file.path!==target)assert.deepEqual(file,before);else{assert.deepEqual({...file,sha256:before.sha256,bytes:before.bytes},before);assert.equal(file.sha256,sha(bytes));assert.equal(file.bytes,bytes.length);}}
});

/** Run the real exporter in an isolated minimal source-only fixture, never edit the candidate. */
function withExporterFixture(run){
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'b-trigger-guard-provenance-'));
 const write=(relative,bytes)=>{const full=path.join(temporary,relative);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,bytes);};
 const file=structuredClone(records[0]);
 try{
  for(const script of ['five-source-provenance.mjs','viatris-shared-integration-provenance.mjs','viatris-source-provenance.mjs','package-manifest.mjs','b-trigger-completeness-guard-source-provenance.mjs','legacy-completeness-guard-source-provenance.mjs','shared-completeness-guard-source-provenance.mjs','four-source-provenance.mjs','ucb-source-provenance.mjs','hengrui-source-provenance.mjs'])write('scripts/'+script,fs.readFileSync(root+'/scripts/'+script));
  for(const name of ['READER_MAIN_SOURCE_MANIFEST.json','READER_FALLBACK_SOURCE_MANIFEST.json'])write('vendor/'+name,JSON.stringify({files:[]}));
  write('config/hengrui-port-provenance.json',JSON.stringify({originCommit:null,productionQualified:false,files:[]}));
  const setRecord=record=>write('vendor/C60_SOURCE_MANIFEST.json',JSON.stringify({originCommit:base.originCommit,files:[record]}));
  const setBytes=bytes=>write('vendor/c60-source/'+file.path,bytes);
  const exportFixture=()=>execFileSync(process.execPath,[temporary+'/scripts/package-manifest.mjs'],{encoding:'utf8',maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});
  setRecord(file);setBytes(readSource(file.path));run({file,setRecord,setBytes,exportFixture});
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}

test('real package exporter rejects relabelling, stale bytes and forged ancestry',()=>withExporterFixture(({file,setRecord,setBytes,exportFixture})=>{
 assert.doesNotThrow(exportFixture);
 const relabelled={...file,classification:'EXACT_HISTORICAL_FILE_BYTES'};setRecord(relabelled);assert.throws(exportFixture,/B_TRIGGER_COMPLETENESS_GUARD_CLASS_REQUIRED/);
 setRecord(file);setBytes(Buffer.from('tampered current bytes'));assert.throws(exportFixture,/B_TRIGGER_COMPLETENESS_GUARD_CURRENT_BYTES_MISMATCH/);
 setBytes(readSource(file.path));const forged=structuredClone(file);forged.priorProvenance.bytes++;forged.priorProvenanceSha256=sha(JSON.stringify(forged.priorProvenance));setRecord(forged);assert.throws(exportFixture,/B_TRIGGER_COMPLETENESS_GUARD_EXACT_F7C011_ANCESTRY/);
}));
