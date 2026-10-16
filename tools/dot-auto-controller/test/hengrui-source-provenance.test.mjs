import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {HENGRUI_BASE_COMMIT,HENGRUI_BASE_HASHES,HENGRUI_SHARED_SOURCE_PATHS,HENGRUI_NEW_SOURCE_PATH,HENGRUI_DERIVATIVE_CLASS,HENGRUI_NEW_SOURCE_CLASS,hengruiSourceProvenance,refreshHengruiSourceManifest} from '../scripts/hengrui-source-provenance.mjs';

const root=path.resolve(import.meta.dirname,'..');
const sourcePrefix='tools/dot-auto-controller/vendor/c60-source/';
const packagePrefix='tools/dot-auto-controller/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const currentManifest=JSON.parse(fs.readFileSync(path.join(root,'vendor/C60_SOURCE_MANIFEST.json')));
// Verify the retained Hengrui layer against its exact frozen 48e Git bytes.
const manifest={...currentManifest,files:currentManifest.files.filter(f=>f.classification!=='UCB_OWNED_BRIDGE_NEW_SOURCE').map(f=>f.classification==='UCB_OWNED_BRIDGE_SOURCE_DERIVATIVE'?f.priorProvenance:f)};
const ucbPaths=new Set(currentManifest.files.filter(f=>f.classification==='UCB_OWNED_BRIDGE_SOURCE_DERIVATIVE').map(f=>f.path));
const portManifest=JSON.parse(fs.readFileSync(path.join(root,'config/hengrui-port-provenance.json')));
const exported=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/package-manifest.mjs')],{encoding:'utf8',maxBuffer:8*1024*1024}));
const entry=relative=>{const current=exported.entries.find(file=>file.path===sourcePrefix+relative);if(!ucbPaths.has(relative))return current;const ancestor=manifest.files.find(f=>f.path===relative);assert.deepEqual(current.provenance.priorProvenance,ancestor);return {...current,sha256:ancestor.sha256,bytes:ancestor.bytes,provenance:hengruiSourceProvenance(ancestor)};};
const source=relative=>manifest.files.find(file=>file.path===relative);
const priorHashes={
 'scripts/p0-cloud-portable-source-pilot.ts':'8fc297cdc3487ad8a3767514d19330fbbfcf377843644518b2aff9c5be8e9db4',
 'src/crawler/cloudDbStartedPilot.ts':'c95748a2427b0b7ab5d4f1237842baac663b179138186b02ce4a0615ac2ddc8f',
 'src/crawler/cloudSourcePilotRelay.ts':'2b59b6739d54822507be139c358934745b9e9c54fd28d77e8ca361274eba855c',
};
// These fingerprints were taken from the exact c53 Git objects, not this derivative.
// Exact c53 Hengrui base records plus the independently reviewed merged records
// outside the Hengrui refresh scope. This is not a claim that all rows are c53.
const refreshBase={...manifest,files:manifest.files.filter(file=>file.path!==HENGRUI_NEW_SOURCE_PATH).map(file=>HENGRUI_SHARED_SOURCE_PATHS.includes(file.path)?file.priorProvenance:file)};
const bytesByPath=new Map(manifest.files.map(file=>[file.path,ucbPaths.has(file.path)?execFileSync('git',['show','48e56500bfe6a77ed712abfd54a98154cf963032:'+sourcePrefix+file.path],{cwd:root}):fs.readFileSync(path.join(root,'vendor/c60-source',file.path))]));
const readSource=relative=>bytesByPath.get(relative);

function assertLocal(source,entry){
 assert.equal(source.originCommit,null);assert.equal(source.productionQualified,false);
 assert.equal(source.originSha256,undefined);assert.equal(source.ancestorOriginCommit,undefined);
 assert.equal(entry.provenance.originCommit,null);assert.equal(entry.provenance.sourceStatus,'LOCAL_UNREGISTERED');
 assert.equal(entry.provenance.productionQualified,false);assert.equal(entry.provenance.newBuildQualificationRequired,true);
 assert.equal(entry.sha256,source.sha256);assert.equal(entry.bytes,source.bytes);
 assert.equal(sha(readSource(source.path)),source.sha256);assert.equal(readSource(source.path).length,source.bytes);
}

test('retained three Hengrui ancestors bind exact c53 and 48e bytes beneath UCB',()=>{
 const files=manifest.files.filter(file=>file.classification===HENGRUI_DERIVATIVE_CLASS);
 assert.deepEqual(files.map(file=>file.path).sort(),[...HENGRUI_SHARED_SOURCE_PATHS].sort());
 for(const file of files){const exportedFile=entry(file.path);assertLocal(file,exportedFile);
  assert.equal(file.derivativeBaseCommit,HENGRUI_BASE_COMMIT);assert.equal(file.derivativeBaseSha256,HENGRUI_BASE_HASHES[file.path]);
  assert.equal(sha(JSON.stringify(file.priorProvenance)),priorHashes[file.path]);
  assert.equal(file.priorProvenance.classification,'BIOGEN_FIXED_HOST_SOURCE_DERIVATIVE');
  assert.notEqual(file.sha256,file.derivativeBaseSha256);
  assert.deepEqual(exportedFile.provenance,hengruiSourceProvenance(file));
  assert.deepEqual(exportedFile.provenance.priorProvenance,file.priorProvenance);
 }
});

test('new Hengrui sidecar has explicit local-new provenance and no invented ancestor',()=>{
 const files=manifest.files.filter(file=>file.classification===HENGRUI_NEW_SOURCE_CLASS);
 assert.equal(files.length,1);const file=files[0];assert.equal(file.path,HENGRUI_NEW_SOURCE_PATH);assertLocal(file,entry(file.path));
 assert.equal(file.derivativeBaseCommit,undefined);assert.equal(file.derivativeBaseSha256,undefined);assert.equal(file.priorProvenance,undefined);
 assert.equal(entry(file.path).provenance.kind,'new-hengrui-owned-bridge-source');
});

test('all 870 unaffected vendor records retain c53 metadata, hashes and bytes',()=>{
 const untouched=manifest.files.filter(file=>!HENGRUI_SHARED_SOURCE_PATHS.includes(file.path)&&file.path!==HENGRUI_NEW_SOURCE_PATH&&file.classification!=='SEQUENCE_FIXED_HOST_SOURCE_DERIVATIVE');
 assert.equal(untouched.length,870);assert.equal(sha(JSON.stringify(untouched)),'0839d90ebc46d0540907f22abc3756a07707f1168ad01b8ae80ed9d353ff7684');
 for(const file of untouched){assert.equal(sha(readSource(file.path)),file.sha256,file.path);assert.equal(readSource(file.path).length,file.bytes,file.path);}
 assert.deepEqual(refreshHengruiSourceManifest({baseManifest:refreshBase,currentManifest:manifest,readSource}),manifest);
});

test('all Hengrui adapter families export as local-new source without inherited qualification',()=>{
 for(const relative of ['run-hengrui.mjs','native/hengrui-original-run.mjs','native/hengrui-worker.mts','src/hengrui-catalog.mjs','transport/hengrui-existing-compiler.mjs','transport/queries/hengrui-c60-reader-before.sql','connector-gate/hengrui-producer-adapter.mts','connector-gate/hengrui-run-with-owned-publication-pipe.mjs','fixed-host/hengrui/render-hengrui-source.py','public-verification/hengrui/contract.mjs','test/hengrui-source-provenance.test.mjs','test/fixtures/hengrui-moka-synthetic.mts','config/hengrui-native-catalog.json']){
  const file=exported.entries.find(file=>file.path===packagePrefix+relative);assert(file,relative);
  const port=portManifest.files.find(input=>input.path===relative);
  assert.deepEqual(file.provenance,{kind:'new-hengrui-owned-bridge-source',originCommit:null,sourceStatus:'LOCAL_UNREGISTERED',productionQualified:false,newBuildQualificationRequired:true,...(port?{sourceBasis:file.sha256===port.sha256?'ORIGINAL_HENGRUI_CANDIDATE_PORT':'ORIGINAL_HENGRUI_CANDIDATE_DERIVATIVE',portInput:{candidate:portManifest.originalCandidate,...port}}:{})},relative);
 }
});

test('source export excludes dependencies, generated identities, dist and old Hengrui cache',()=>{
 assert(!exported.entries.some(file=>file.path.split('/').includes('node_modules')));
 assert(!exported.entries.some(file=>file.path.startsWith(sourcePrefix+'dist/')||file.path===sourcePrefix+'build-identity.json'||file.path.startsWith(packagePrefix+'.hengrui-test-cache/')));
 assert(fs.readFileSync(path.join(root,'scripts/package-manifest.mjs'),'utf8').includes("new Set(['.hengrui-test-cache'])"));
});

for(const scenario of [
 {name:'historical origin',mutate:file=>file.originCommit='3a2400768e8b087b8600dd05e1a32ac006bd7102'},
 {name:'origin hash',mutate:file=>file.originSha256=file.derivativeBaseSha256},
 {name:'historical ancestor on current derivative',mutate:file=>file.ancestorOriginCommit='3a2400768e8b087b8600dd05e1a32ac006bd7102'},
 {name:'production qualification',mutate:file=>file.productionQualified=true},
 {name:'wrong base commit',mutate:file=>file.derivativeBaseCommit='0'.repeat(40)},
 {name:'wrong base hash',mutate:file=>file.derivativeBaseSha256='0'.repeat(64)},
 {name:'truncated prior ancestry',mutate:file=>delete file.priorProvenance.priorProvenance},
 {name:'rewritten prior ancestry',mutate:file=>file.priorProvenance.priorProvenance.derivativeBaseCommit='0'.repeat(40)},
])test('Hengrui exporter rejects '+scenario.name,()=>{
 for(const relative of HENGRUI_SHARED_SOURCE_PATHS){const file=structuredClone(source(relative));scenario.mutate(file);assert.throws(()=>hengruiSourceProvenance(file),/HENGRUI_SOURCE_(LOCAL_ONLY|C53_BASE_REQUIRED)/);}
});

test('new sidecar cannot claim a derivative ancestor',()=>{
 for(const mutate of [file=>file.derivativeBaseCommit=HENGRUI_BASE_COMMIT,file=>file.derivativeBaseSha256='0'.repeat(64),file=>file.priorProvenance={}]){
  const file=structuredClone(source(HENGRUI_NEW_SOURCE_PATH));mutate(file);assert.throws(()=>hengruiSourceProvenance(file),/HENGRUI_NEW_SOURCE_HAS_NO_ANCESTOR/);
 }
});

test('targeted refresh refuses unrelated metadata or byte changes',()=>{
 const relative=refreshBase.files.find(file=>!HENGRUI_SHARED_SOURCE_PATHS.includes(file.path)).path;
 const changed=structuredClone(manifest);changed.files.find(file=>file.path===relative).sha256='0'.repeat(64);
 assert.throws(()=>refreshHengruiSourceManifest({baseManifest:refreshBase,currentManifest:changed,readSource}),/HENGRUI_UNRELATED_PROVENANCE_CHANGED/);
 assert.throws(()=>refreshHengruiSourceManifest({baseManifest:refreshBase,currentManifest:manifest,readSource:target=>target===relative?Buffer.from('unexpected change'):readSource(target)}),/HENGRUI_UNRELATED_SOURCE_CHANGED/);
 const top=structuredClone(manifest);top.productionQualified=true;
 assert.throws(()=>refreshHengruiSourceManifest({baseManifest:refreshBase,currentManifest:top,readSource}),/HENGRUI_UNRELATED_MANIFEST_METADATA_CHANGED/);
});

test('targeted refresh changes only current hashes and preserves original c53 ancestry',()=>{
 const relative=HENGRUI_SHARED_SOURCE_PATHS[0],bytes=Buffer.concat([readSource(relative),Buffer.from('\n// offline test derivative\n')]);
 const refreshed=refreshHengruiSourceManifest({baseManifest:refreshBase,currentManifest:manifest,readSource:target=>target===relative?bytes:readSource(target)});
 const file=refreshed.files.find(file=>file.path===relative);assert.equal(file.sha256,sha(bytes));assert.equal(file.bytes,bytes.length);
 assert.deepEqual(file.priorProvenance,source(relative).priorProvenance);
 for(const other of refreshed.files.filter(file=>file.path!==relative))assert.deepEqual(other,source(other.path));
});

test('Hengrui native launchers and owned wrapper are declared active roots',()=>{
 const config=JSON.parse(fs.readFileSync(path.join(root,'config/active-import-roots.json')));
 for(const relative of ['run-hengrui.mjs','native/hengrui-bootstrap.mjs','native/hengrui-worker.mts','native/hengrui-reconcile.mts','native/hengrui-reader-gate.mts','native/hengrui-api-gate.mts','connector-gate/hengrui-run-with-owned-publication-pipe.mjs'])assert(config.entrypoints.includes(relative),relative);
 for(const relative of ['native/hengrui-bootstrap.mjs','native/hengrui-worker.mts','native/hengrui-reconcile.mts','src/hengrui-completion-control-plane.mjs','transport/hengrui-existing-compiler.mjs']){
  assert.deepEqual(config.dynamicSourceRoots[relative],['vendor/c60-source'],relative);assert(config.dynamicExpressions[relative].length>0,relative);
 }
 assert.deepEqual(config.dynamicSourceRoots['native/hengrui-api-gate.mts'],['vendor/reader-main','vendor/reader-fallback']);
 assert.equal(config.dynamicExpressions['native/hengrui-api-gate.mts'].length,5);
});

test('ported original Hengrui adapter inputs are identified separately from new bridge work',()=>{
 assert.equal(portManifest.originalCandidate,'hengrui-auto-adapter-candidate-20261016T0315Z');
 assert.equal(portManifest.originCommit,null);assert.equal(portManifest.productionQualified,false);assert.equal(portManifest.files.length,34);
 for(const port of portManifest.files){
  assert(!path.isAbsolute(port.path));assert(!port.path.split('/').includes('node_modules'));
  const file=exported.entries.find(file=>file.path===packagePrefix+port.path);assert(file,port.path);
  assert.deepEqual(file.provenance.portInput,{candidate:portManifest.originalCandidate,...port});
  assert.equal(file.provenance.sourceBasis,file.sha256===port.sha256?'ORIGINAL_HENGRUI_CANDIDATE_PORT':'ORIGINAL_HENGRUI_CANDIDATE_DERIVATIVE');
 }
 const fixture=exported.entries.find(file=>file.path===packagePrefix+'connector-gate/hengrui-synthetic-fixture.mts');assert.equal(fixture.provenance.sourceBasis,'ORIGINAL_HENGRUI_CANDIDATE_DERIVATIVE');
 assert.equal(exported.entries.find(file=>file.path===packagePrefix+'connector-gate/hengrui-producer-adapter.mts').provenance.portInput,undefined);
});
