import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {verifyActiveImports} from '../scripts/verify-active-imports.mjs';
const root=path.resolve(import.meta.dirname,'..');
// The existing projection sidecar reaches this binding. No other host module is
// an active source root; its private loader uses only these reviewed literals.
const reviewedHostBinding='vendor/c60-source/ops/cloud-pilot-host/connector-host-binding.mjs';
const reviewedHostExpression='import(pathToFileURL(path.join(PRODUCER_ROOT,p)).href)';
const reviewedHostTargets=[
 'scripts/p0-cloud-portable-source-pilot.ts',
 'scripts/run-with-http-diagnostics.mjs',
 'src/db/cloudPilotSqlControl.ts',
 'src/db/ingestionRepository.ts',
 'src/crawler/cloudDbStartedPilot.ts',
 'src/crawler/stagedScheduleAuthority.ts',
 'src/crawler/sourcePlan.ts'
];
test('all active native/controller/transport source closures resolve inside declared package roots',()=>{const result=verifyActiveImports(root);assert(result.sourceFiles>100);assert(result.files.some(f=>f.path==='vendor/c60-source/src/domain/jobProjectionDeltaReceipt.ts'));assert.deepEqual(result.files.filter(f=>f.path.startsWith('vendor/c60-source/ops/cloud-pilot-host/')).map(f=>f.path),[reviewedHostBinding]);
 const config=JSON.parse(fs.readFileSync(path.join(root,'config/active-import-roots.json')));
 assert.deepEqual(config.dynamicSourceRoots[reviewedHostBinding],['vendor/c60-source']);
 assert.deepEqual(config.dynamicExpressions[reviewedHostBinding],[reviewedHostExpression]);
 assert.deepEqual(result.dynamic.find(d=>d.file===reviewedHostBinding),{file:reviewedHostBinding,expressions:1,reviewedRoots:['vendor/c60-source']});
 assert.deepEqual(result.edges.filter(e=>e.from===reviewedHostBinding&&e.dynamic).map(e=>e.to).sort(),reviewedHostTargets.map(p=>'vendor/c60-source/'+p).sort());
 assert.deepEqual(result.edges.filter(e=>e.from===reviewedHostBinding&&e.dependency),[{from:reviewedHostBinding,dependency:'node_modules/tsx/dist/esm/api/index.mjs',classification:'DECLARED_LOCKED_DEPENDENCY'}]);});
for(const target of ['missing-module.mjs','../outside.mjs'])test('active import checker refuses '+target,()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'active-import-test-'));try{fs.mkdirSync(dir+'/vendor/c60-source',{recursive:true});fs.writeFileSync(dir+'/vendor/c60-source/package.json','{}');fs.writeFileSync(dir+'/vendor/c60-source/package-lock.json','{"packages":{}}');fs.writeFileSync(dir+'/entry.mjs',`import './${target}';`);assert.throws(()=>verifyActiveImports(dir,{entrypoints:['entry.mjs'],dynamicSourceRoots:{},quarantinedNotEntrypoints:[]}),/ACTIVE_IMPORT_(MISSING|OUTSIDE_PACKAGE)/);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
test('stale package-relative dynamic import is rejected, not hidden by quarantine',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'active-dynamic-test-'));try{fs.mkdirSync(dir+'/vendor/c60-source',{recursive:true});fs.writeFileSync(dir+'/vendor/c60-source/package.json','{}');fs.writeFileSync(dir+'/vendor/c60-source/package-lock.json','{"packages":{}}');fs.writeFileSync(dir+'/entry.mjs',`await import(pathToFileURL(path.join(BASE,'historical-missing/producer/source.ts')).href);`);assert.throws(()=>verifyActiveImports(dir,{entrypoints:['entry.mjs'],dynamicSourceRoots:{'entry.mjs':['vendor']},dynamicExpressions:{'entry.mjs':["import(pathToFileURL(path.join(BASE,'historical-missing/producer/source.ts')).href)"]},quarantinedNotEntrypoints:[]}),/DYNAMIC_IMPORT_MISSING/);}finally{fs.rmSync(dir,{recursive:true,force:true});}});

// These fixtures parse source only. Loading any target would throw.
function reviewedDynamicFixture(run){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'active-reviewed-dynamic-test-'));
 try{
  fs.mkdirSync(path.join(dir,'vendor/c60-source/src'),{recursive:true});
  fs.writeFileSync(path.join(dir,'vendor/c60-source/package.json'),'{}');
  fs.writeFileSync(path.join(dir,'vendor/c60-source/package-lock.json'),' {"packages":{}}');
  fs.writeFileSync(path.join(dir,'vendor/c60-source/src/reviewed.ts'),"throw Error('ACTIVE_IMPORT_MUST_NOT_EXECUTE');");
  const writeEntry=(target='src/reviewed.ts',extra='')=>fs.writeFileSync(path.join(dir,'entry.mjs'),`const module=p=>${reviewedHostExpression}; await module(${JSON.stringify(target)}); ${extra}`);
  writeEntry();
  const config={entrypoints:['entry.mjs'],dynamicSourceRoots:{'entry.mjs':['vendor/c60-source']},dynamicExpressions:{'entry.mjs':[reviewedHostExpression]},quarantinedNotEntrypoints:[]};
  return run({dir,config,writeEntry});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('reviewed private dynamic loader resolves only the declared target without executing it',()=>reviewedDynamicFixture(({dir,config})=>{
 const result=verifyActiveImports(dir,config);
 assert.deepEqual(result.files.map(f=>f.path),['entry.mjs','vendor/c60-source/src/reviewed.ts']);
 assert.deepEqual(result.edges,[{from:'entry.mjs',to:'vendor/c60-source/src/reviewed.ts',dynamic:true}]);
}));
for(const scenario of [
 {name:'missing exact expression registration',change:({config})=>delete config.dynamicExpressions['entry.mjs'],error:/UNREVIEWED_DYNAMIC_IMPORT_EXPRESSION/},
 {name:'changed dynamic expression',change:({dir})=>fs.writeFileSync(path.join(dir,'entry.mjs'),"await import(userControlled); const reviewed='src/reviewed.ts';"),error:/UNREVIEWED_DYNAMIC_IMPORT_EXPRESSION/},
 {name:'additional unknown dynamic expression',change:({writeEntry})=>writeEntry('src/reviewed.ts','await import(userControlled);'),error:/UNREVIEWED_DYNAMIC_IMPORT_EXPRESSION/},
 {name:'missing fixed source root',change:({config})=>delete config.dynamicSourceRoots['entry.mjs'],error:/UNDECLARED_DYNAMIC_IMPORT/},
 {name:'fake configured source root',change:({config})=>{config.dynamicSourceRoots['entry.mjs']=['vendor/not-the-producer'];},error:/DYNAMIC_IMPORT_MISSING/},
 {name:'configured root outside package',change:({config})=>{config.dynamicSourceRoots['entry.mjs']=['../outside'];},error:/ACTIVE_IMPORT_OUTSIDE_PACKAGE/},
 {name:'missing reviewed target',change:({writeEntry})=>writeEntry('src/missing.ts'),error:/DYNAMIC_IMPORT_MISSING/},
 {name:'target outside package',change:({writeEntry})=>writeEntry('../outside.mjs'),error:/ACTIVE_IMPORT_OUTSIDE_PACKAGE/},
 {name:'absolute dynamic target',change:({writeEntry})=>writeEntry('/outside.mjs'),error:/ACTIVE_IMPORT_ABSOLUTE/}
])test('reviewed dynamic import rejects '+scenario.name,()=>reviewedDynamicFixture(fixture=>{
 scenario.change(fixture);
 assert.throws(()=>verifyActiveImports(fixture.dir,fixture.config),scenario.error);
}));
