/** Current five-source source closure; no runtime/installation/collection qualification. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {FIVE_BASE_COMMIT,FIVE_DERIVATIVE_CLASS,FIVE_SOURCE_PATHS,FIVE_EXPECTED,fiveSourceProvenance,refreshFiveSourceManifest} from '../scripts/five-source-provenance.mjs';
import {actualFiveSourceManifest as current,retainedFiveSourceManifest,validateFiveSourceView,fiveHash as sha,fiveGit} from './five-source-ancestry.mjs';
const root=path.resolve(import.meta.dirname,'..'),prefix='tools/dot-auto-controller/',read=p=>fs.readFileSync(root+'/'+p),git=(...args)=>execFileSync('git',args,{cwd:root,maxBuffer:12*1024*1024});
test('current source is a real complete Git successor of the sealed ordered integration',()=>{
 const head=git('rev-parse','HEAD').toString().trim();assert.notEqual(head,FIVE_BASE_COMMIT);git('merge-base','--is-ancestor',FIVE_BASE_COMMIT,head);
 assert.equal(git('show','-s','--format=%P',FIVE_BASE_COMMIT).toString().trim(),'36a03b847f66e8d68d68e2cff1f00fd6b4b83b51 bf192cdce3d3b13347ab51ca3b26120786d55544');
 assert.equal(git('rev-parse','--is-shallow-repository').toString().trim(),'false');assert.equal(fs.existsSync(path.join(git('rev-parse','--show-toplevel').toString().trim(),'.git/objects/info/alternates')),false);
});
test('entire current native manifest restores the real complete e478 prior view',()=>{assert.equal(current.files.length,878);assert.deepEqual(validateFiveSourceView(current),JSON.parse(fiveGit('C60_SOURCE_MANIFEST.json')));assert.deepEqual(retainedFiveSourceManifest,JSON.parse(fiveGit('C60_SOURCE_MANIFEST.json')));});
test('all original vendor profiles, guards, reader bytes, schemas and permissions are unchanged outside exactly two host layout files',()=>{
 const files=git('ls-tree','-r','--name-only',FIVE_BASE_COMMIT,'--',prefix+'vendor/',prefix+'config/',prefix+'native/').toString().trim().split('\n');assert(files.length>1000);
 for(const file of files){const relative=file.slice(prefix.length);if(relative==='vendor/C60_SOURCE_MANIFEST.json'||FIVE_SOURCE_PATHS.some(p=>relative==='vendor/c60-source/'+p))continue;assert.deepEqual(read(relative),git('show',FIVE_BASE_COMMIT+':'+file),relative);}
});
for(const [name,change] of [['stripped class',f=>delete f.classification],['wrong parent',f=>f.derivativeBaseCommit='0'.repeat(40)],['foreign path',f=>f.path='src/crawler/runCrawlBatch.ts'],['missing prior',f=>delete f.priorProvenance],['truncated prior',f=>delete f.priorProvenance.priorProvenance],['forged prior rehash',f=>{f.priorProvenance.bytes++;f.priorProvenanceSha256=sha(JSON.stringify(f.priorProvenance));}],['stale hash',f=>f.sha256=f.derivativeBaseSha256],['stale bytes',f=>f.bytes++],['qualified',f=>f.productionQualified=true],['registered',f=>f.sourceStatus='REGISTERED'],['extra field',f=>f.permission=true]])test('current five-source view rejects '+name,()=>{const m=structuredClone(current);change(m.files.find(f=>f.classification===FIVE_DERIVATIVE_CLASS));assert.throws(()=>validateFiveSourceView(m));});
test('full prior view rejects unrelated record and byte drift, dropped/duplicated/reordered records',()=>{
 for(const change of [m=>m.files.pop(),m=>m.files.push(m.files[0]),m=>m.files.reverse(),m=>m.files.find(f=>f.path==='src/crawler/runCrawlBatch.ts').priorProvenance.bytes++]){const m=structuredClone(current);change(m);assert.throws(()=>validateFiveSourceView(m));}
 assert.throws(()=>validateFiveSourceView(current,p=>p===FIVE_SOURCE_PATHS[0]?Buffer.from('forged'):read('vendor/c60-source/'+p)));
});
test('current exporter verifies exact host bytes, complete prior and required class',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'five-export-')),write=(p,b)=>{fs.mkdirSync(path.dirname(temp+'/'+p),{recursive:true});fs.writeFileSync(temp+'/'+p,b);};
 try{
  for(const f of ['package-manifest.mjs','five-source-provenance.mjs','viatris-shared-integration-provenance.mjs','viatris-source-provenance.mjs','b-trigger-completeness-guard-source-provenance.mjs','legacy-completeness-guard-source-provenance.mjs','shared-completeness-guard-source-provenance.mjs','four-source-provenance.mjs','ucb-source-provenance.mjs','hengrui-source-provenance.mjs'])write('scripts/'+f,read('scripts/'+f));
  for(const f of ['READER_MAIN_SOURCE_MANIFEST.json','READER_FALLBACK_SOURCE_MANIFEST.json'])write('vendor/'+f,JSON.stringify({files:[]}));write('config/hengrui-port-provenance.json',JSON.stringify({originCommit:null,productionQualified:false,files:[]}));
  const run=()=>execFileSync(process.execPath,[temp+'/scripts/package-manifest.mjs'],{stdio:['ignore','pipe','pipe']});
  for(const relative of FIVE_SOURCE_PATHS){
   fs.rmSync(temp+'/vendor/c60-source',{recursive:true,force:true});const original=current.files.find(f=>f.path===relative),record=f=>write('vendor/C60_SOURCE_MANIFEST.json',JSON.stringify({originCommit:current.originCommit,files:[f]}));
   record(original);write('vendor/c60-source/'+relative,read('vendor/c60-source/'+relative));assert.doesNotThrow(run);
   record(original.priorProvenance);assert.throws(run,/FIVE_SOURCE_CLASS_REQUIRED/);
   const forged=structuredClone(original);forged.priorProvenance.bytes++;forged.priorProvenanceSha256=sha(JSON.stringify(forged.priorProvenance));record(forged);assert.throws(run,/FIVE_SOURCE/);
   record(original);write('vendor/c60-source/'+relative,Buffer.from('stale'));assert.throws(run,/FIVE_SOURCE_CURRENT_BYTES_MISMATCH/);
  }
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('new fixed Viatris and UI files export as local unregistered source, all current exported bytes match committed HEAD',()=>{
 const exported=JSON.parse(git('show','HEAD:'+prefix+'package.json'));assert(exported.private);
 const out=JSON.parse(execFileSync(process.execPath,[root+'/scripts/package-manifest.mjs'],{cwd:root,maxBuffer:12*1024*1024}));
 for(const dir of ['fixed-host/viatris/','public-verification/viatris/']){const rows=out.entries.filter(e=>e.path.startsWith(prefix+dir));assert(rows.length>5);for(const e of rows){assert.equal(e.provenance.kind,'new-viatris-owned-bridge-source');assert.equal(e.provenance.originCommit,null);assert.equal(e.provenance.sourceStatus,'LOCAL_UNREGISTERED');assert.equal(e.provenance.productionQualified,false);}}
 for(const e of out.entries){const bytes=git('show','HEAD:'+e.path);assert.equal(sha(bytes),e.sha256,e.path);assert.equal(bytes.length,e.bytes,e.path);}
});

test('strict refresher rejects dropped/duplicate/reordered rows, metadata drift, forged hosts and unrelated bytes before writing',()=>{
 const baseManifest=JSON.parse(fiveGit('C60_SOURCE_MANIFEST.json')),readSource=p=>read('vendor/c60-source/'+p),refresh=(currentManifest,reader=readSource)=>refreshFiveSourceManifest({baseManifest,currentManifest,readSource:reader});
 assert.deepEqual(refresh(current),current);
 for(const change of [m=>m.files.pop(),m=>m.files.push(m.files[0]),m=>m.files.reverse(),m=>m.originCommit='0'.repeat(40),m=>m.extra=true,m=>m.files.find(f=>FIVE_SOURCE_PATHS.includes(f.path)).priorProvenance.bytes++,m=>m.files.find(f=>!FIVE_SOURCE_PATHS.includes(f.path)).bytes++]){const m=structuredClone(current);change(m);assert.throws(()=>refresh(m));}
 const other=current.files.find(f=>!FIVE_SOURCE_PATHS.includes(f.path)).path;assert.throws(()=>refresh(current,p=>p===other?Buffer.from('changed'):readSource(p)),/UNRELATED_RECORD_OR_BYTES/);
 const base=structuredClone(baseManifest);base.files.pop();assert.throws(()=>refreshFiveSourceManifest({baseManifest:base,currentManifest:current,readSource}),/EXACT_BASE_MANIFEST/);
 for(const entry of Object.values(FIVE_EXPECTED))assert(Object.isFrozen(entry));
});
test('real refresher CLI preserves the manifest on every rejection and closes only exact allowed host derivatives',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'five-refresh-')),write=(p,b)=>{fs.mkdirSync(path.dirname(temp+'/'+p),{recursive:true});fs.writeFileSync(temp+'/'+p,b);};
 const file='vendor/C60_SOURCE_MANIFEST.json',repo=git('rev-parse','--show-toplevel').toString().trim();
 try{
  for(const f of ['refresh-five-source-provenance.mjs','five-source-provenance.mjs','four-source-provenance.mjs','ucb-source-provenance.mjs','hengrui-source-provenance.mjs'])write('scripts/'+f,read('scripts/'+f));
  for(const entry of current.files)write('vendor/c60-source/'+entry.path,read('vendor/c60-source/'+entry.path));
  const run=()=>execFileSync(process.execPath,[temp+'/scripts/refresh-five-source-provenance.mjs'],{cwd:temp,env:{...process.env,GIT_DIR:repo+'/.git',GIT_WORK_TREE:temp},stdio:['ignore','pipe','pipe']});
  const reset=manifest=>write(file,JSON.stringify(manifest,null,2)+'\n');
  reset(current);const expected=fs.readFileSync(temp+'/'+file);assert.doesNotThrow(run);assert.deepEqual(fs.readFileSync(temp+'/'+file),expected);
  reset(JSON.parse(fiveGit('C60_SOURCE_MANIFEST.json')));assert.doesNotThrow(run);assert.deepEqual(fs.readFileSync(temp+'/'+file),expected);
  for(const change of [m=>m.files.pop(),m=>m.files.push(m.files[0]),m=>m.files.reverse(),m=>m.originCommit='0'.repeat(40),m=>m.extra=true,m=>m.files.find(f=>FIVE_SOURCE_PATHS.includes(f.path)).priorProvenance.bytes++,m=>m.files.find(f=>!FIVE_SOURCE_PATHS.includes(f.path)).bytes++]){
   const mutated=structuredClone(current);change(mutated);reset(mutated);const before=fs.readFileSync(temp+'/'+file);assert.throws(run,/FIVE_SOURCE/);assert.deepEqual(fs.readFileSync(temp+'/'+file),before);
  }
  reset(current);const other=current.files.find(f=>!FIVE_SOURCE_PATHS.includes(f.path)).path;write('vendor/c60-source/'+other,Buffer.from('unrelated byte drift'));assert.throws(run,/UNRELATED_RECORD_OR_BYTES/);assert.deepEqual(fs.readFileSync(temp+'/'+file),expected);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
