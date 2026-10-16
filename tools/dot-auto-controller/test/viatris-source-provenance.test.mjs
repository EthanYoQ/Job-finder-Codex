/** Built-in-only local-source checks. These tests do not qualify a build or live run. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {VIATRIS_BASE_COMMIT,VIATRIS_SHARED_SOURCE_PATHS,VIATRIS_NEW_SOURCE_PATH,VIATRIS_BASE_HASHES,VIATRIS_DERIVATIVE_CLASS,VIATRIS_NEW_SOURCE_CLASS,viatrisSourceProvenance,refreshViatrisSourceManifest} from '../scripts/viatris-source-provenance.mjs';
import {ucbSourceProvenance} from '../scripts/ucb-source-provenance.mjs';
import {hengruiSourceProvenance} from '../scripts/hengrui-source-provenance.mjs';
import {fourSourceProvenance} from '../scripts/four-source-provenance.mjs';
import {retainedViatrisParent} from './viatris-provenance-layers.mjs';

const root=path.resolve(import.meta.dirname,'..');
const prefix='tools/dot-auto-controller/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=relative=>execFileSync('git',['show',VIATRIS_BASE_COMMIT+':'+prefix+relative],{cwd:root,maxBuffer:8*1024*1024});
const base=JSON.parse(git('vendor/C60_SOURCE_MANIFEST.json'));
const current=JSON.parse(fs.readFileSync(path.join(root,'vendor/C60_SOURCE_MANIFEST.json')));
const readSource=relative=>fs.readFileSync(path.join(root,'vendor/c60-source',relative));
const exported=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/package-manifest.mjs')],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}));
const records=current.files.filter(file=>file.classification===VIATRIS_DERIVATIVE_CLASS);
const source=relative=>current.files.find(file=>file.path===relative);
const entry=relative=>exported.entries.find(file=>file.path===prefix+'vendor/c60-source/'+relative);

test('Viatris changes exactly three native records and adds one source-only sidecar',()=>{
 assert.equal(VIATRIS_BASE_COMMIT,'9629790860e68df0a8f09fb14f7ab05e1a2fbbfa');
 assert.equal(base.files.length,877);assert.equal(current.files.length,878);
 assert.deepEqual(records.map(file=>file.path).sort(),[...VIATRIS_SHARED_SOURCE_PATHS].sort());
 assert.deepEqual(current.files.filter(file=>!base.files.some(old=>old.path===file.path)).map(file=>file.path),[VIATRIS_NEW_SOURCE_PATH]);
 assert.deepEqual(retainedViatrisParent(current),base);
 for(const file of records){
  const prior=base.files.find(old=>old.path===file.path),bytes=git('vendor/c60-source/'+file.path);
  assert.deepEqual(file.priorProvenance,prior);assert.equal(file.derivativeBaseCommit,VIATRIS_BASE_COMMIT);
  assert.equal(file.derivativeBaseSha256,VIATRIS_BASE_HASHES[file.path]);assert.equal(file.derivativeBaseSha256,sha(bytes));assert.equal(prior.bytes,bytes.length);
  assert.notEqual(file.sha256,prior.sha256);assert.equal(file.sha256,sha(readSource(file.path)));assert.equal(file.bytes,readSource(file.path).length);
  assert.equal(file.originCommit,null);assert.equal(file.sourceStatus,'LOCAL_UNREGISTERED');assert.equal(file.productionQualified,false);
  assert.deepEqual(entry(file.path).provenance,viatrisSourceProvenance(file));assert.equal(entry(file.path).sha256,file.sha256);
  assert.equal(prior.classification,'UCB_OWNED_BRIDGE_SOURCE_DERIVATIVE');assert.notEqual(ucbSourceProvenance(prior),null);
  assert.equal(prior.priorProvenance.classification,'HENGRUI_OWNED_BRIDGE_SOURCE_DERIVATIVE');assert.notEqual(hengruiSourceProvenance(prior.priorProvenance),null);
  assert.equal(prior.priorProvenance.priorProvenance.classification,'BIOGEN_FIXED_HOST_SOURCE_DERIVATIVE');
 }
});

test('all 874 unrelated native records and source bytes remain exact 962979',()=>{
 const untouched=base.files.filter(file=>!VIATRIS_SHARED_SOURCE_PATHS.includes(file.path));assert.equal(untouched.length,874);
 for(const file of untouched){assert.deepEqual(source(file.path),file);assert.equal(sha(readSource(file.path)),file.sha256,file.path);assert.equal(readSource(file.path).length,file.bytes,file.path);}
 for(const file of current.files.filter(file=>file.classification==='FOUR_SOURCE_SEQUENCE_SOURCE_DERIVATIVE'))assert.deepEqual(entry(file.path).provenance,fourSourceProvenance(file));
 const metadata=manifest=>Object.fromEntries(Object.entries(manifest).filter(([key])=>key!=='files'));
 assert.deepEqual(metadata(current),metadata(base));
});

test('new Viatris sidecar has no inherited origin or ancestor',()=>{
 const file=source(VIATRIS_NEW_SOURCE_PATH);assert.equal(file.classification,VIATRIS_NEW_SOURCE_CLASS);
 assert.equal(file.originCommit,null);assert.equal(file.sourceStatus,'LOCAL_UNREGISTERED');assert.equal(file.productionQualified,false);
 for(const key of ['originSha256','ancestorOriginCommit','derivativeBaseCommit','derivativeBaseSha256','priorProvenance'])assert.equal(file[key],undefined);
 assert.equal(file.sha256,sha(readSource(file.path)));assert.equal(file.bytes,readSource(file.path).length);
 assert.deepEqual(entry(file.path).provenance,viatrisSourceProvenance(file));assert.equal(entry(file.path).provenance.kind,'new-viatris-owned-bridge-source');
});

test('Viatris adapter, fixture, test and provenance sources export explicit local-only identity',()=>{
 const additions=exported.entries.filter(file=>/\/(?:connector-gate|test)\/viatris[-.]|\/test\/fixtures\/viatris-|\/scripts\/(?:refresh-)?viatris-source-provenance\.mjs$|\/connector-gate\/VIATRIS_OWNED_BRIDGE\.md$/.test(file.path));
 assert.ok(additions.length>=10);
 for(const file of additions)assert.deepEqual(file.provenance,{kind:'new-viatris-owned-bridge-source',originCommit:null,sourceStatus:'LOCAL_UNREGISTERED',productionQualified:false,newBuildQualificationRequired:true},file.path);
 assert.ok(!exported.entries.some(file=>file.path.split('/').includes('node_modules')||file.path.includes('/vendor/c60-source/dist/')||file.path.endsWith('/vendor/c60-source/build-identity.json')));
});

for(const [name,mutate] of [
 ['historical origin',file=>file.originCommit=base.originCommit],
 ['origin hash',file=>file.originSha256=file.derivativeBaseSha256],
 ['historical ancestor',file=>file.ancestorOriginCommit=base.originCommit],
 ['production qualification',file=>file.productionQualified=true],
 ['registered identity',file=>file.sourceStatus='REGISTERED'],
 ['missing status',file=>delete file.sourceStatus],
 ['extra build qualification',file=>file.buildIdentity={qualified:true}],
 ['wrong parent',file=>file.derivativeBaseCommit='0'.repeat(40)],
 ['wrong base hash',file=>file.derivativeBaseSha256='0'.repeat(64)],
 ['missing prior',file=>delete file.priorProvenance],
 ['truncated UCB ancestry',file=>delete file.priorProvenance.priorProvenance],
 ['rewritten UCB ancestry',file=>file.priorProvenance.derivativeBaseCommit='0'.repeat(40)],
 ['foreign path',file=>file.path='src/crawler/other.ts'],
 ['unchanged derivative bytes',file=>file.sha256=file.derivativeBaseSha256],
 ['missing byte hash',file=>delete file.sha256],
 ['invalid byte count',file=>file.bytes=-1],
])test('Viatris source validator rejects '+name,()=>{for(const original of records){const file=structuredClone(original);mutate(file);assert.throws(()=>viatrisSourceProvenance(file));}});

test('new sidecar rejects derivative ancestry and inherited qualification',()=>{
 for(const mutate of [file=>file.derivativeBaseCommit=VIATRIS_BASE_COMMIT,file=>file.derivativeBaseSha256=VIATRIS_BASE_HASHES[VIATRIS_SHARED_SOURCE_PATHS[0]],file=>file.priorProvenance=records[0],file=>file.originCommit=base.originCommit,file=>file.productionQualified=true,file=>file.sourceStatus='REGISTERED']){
  const file=structuredClone(source(VIATRIS_NEW_SOURCE_PATH));mutate(file);assert.throws(()=>viatrisSourceProvenance(file));
 }
});

test('refresh is idempotent and accepts only exact 962979 input provenance',()=>{
 assert.deepEqual(refreshViatrisSourceManifest({baseManifest:base,currentManifest:current,readSource}),current);
 assert.deepEqual(refreshViatrisSourceManifest({baseManifest:base,currentManifest:base,readSource}),current);
 for(const mutate of [manifest=>manifest.originCommit='0'.repeat(40),manifest=>manifest.files[0].bytes++,manifest=>manifest.files.reverse()]){const bad=structuredClone(base);mutate(bad);assert.throws(()=>refreshViatrisSourceManifest({baseManifest:bad,currentManifest:current,readSource}),/EXACT_962979_MANIFEST_REQUIRED/);}
});

test('refresh rejects unrelated source, provenance, metadata, duplicate and removed entries',()=>{
 const other=base.files.find(file=>!VIATRIS_SHARED_SOURCE_PATHS.includes(file.path));
 assert.throws(()=>refreshViatrisSourceManifest({baseManifest:base,currentManifest:current,readSource:relative=>relative===other.path?Buffer.from('changed'):readSource(relative)}),/UNRELATED_SOURCE_CHANGED/);
 for(const [mutate,expected] of [
  [manifest=>manifest.files.find(file=>file.path===other.path).sha256='0'.repeat(64),/UNRELATED_PROVENANCE_CHANGED/],
  [manifest=>manifest.productionQualified=true,/UNRELATED_MANIFEST_METADATA_CHANGED/],
  [manifest=>manifest.files.push(structuredClone(manifest.files[0])),/DUPLICATE_SOURCE_ENTRY/],
  [manifest=>manifest.files=manifest.files.filter(file=>file.path!==other.path),/EXISTING_SOURCE_ENTRY_REMOVED/],
  [manifest=>manifest.files.push({path:'unrelated.ts'}),/UNRELATED_NEW_SOURCE_ENTRY/],
  [manifest=>delete manifest.files.find(file=>file.path===VIATRIS_SHARED_SOURCE_PATHS[0]).priorProvenance.priorProvenance,/EXACT_962979_BASE_REQUIRED/],
 ]){const bad=structuredClone(current);mutate(bad);assert.throws(()=>refreshViatrisSourceManifest({baseManifest:base,currentManifest:bad,readSource}),expected);}
});

test('refresh changes current content hashes only while retaining the complete immutable parent',()=>{
 const relative=VIATRIS_SHARED_SOURCE_PATHS[0],bytes=Buffer.concat([readSource(relative),Buffer.from('\n// test-only local derivative\n')]);
 const next=refreshViatrisSourceManifest({baseManifest:base,currentManifest:current,readSource:target=>target===relative?bytes:readSource(target)});
 const changed=next.files.find(file=>file.path===relative);assert.equal(changed.sha256,sha(bytes));assert.equal(changed.bytes,bytes.length);assert.deepEqual(changed.priorProvenance,source(relative).priorProvenance);
 for(const file of next.files.filter(file=>file.path!==relative))assert.deepEqual(file,source(file.path));
 assert.throws(()=>refreshViatrisSourceManifest({baseManifest:base,currentManifest:current,readSource:target=>target===relative?git('vendor/c60-source/'+target):readSource(target)}),/DERIVATIVE_MUST_CHANGE_BYTES/);
});
