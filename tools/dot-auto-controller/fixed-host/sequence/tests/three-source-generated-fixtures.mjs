/** Offline fixture adapter. Reuses the actual frozen Hengrui schema50 builder,
 * compiler and Moka synthetic fetch; never mutates/copies runtime dependencies.
 * Args: frozen package root, existing runtime package root, pinned Node, evidence dir.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';import {spawnSync} from 'node:child_process';
const [frozenArg,runtimeArg,nodeArg,evidenceArg]=process.argv.slice(2);
assert.ok(frozenArg&&runtimeArg&&nodeArg&&evidenceArg,'FROZEN_RUNTIME_NODE_EVIDENCE_REQUIRED');
const frozen=path.resolve(frozenArg),runtime=path.resolve(runtimeArg),node=path.resolve(nodeArg),evidence=path.resolve(evidenceArg);
for(const root of [frozen,runtime,path.resolve(import.meta.dirname,'../../../..')])assert.ok(evidence!==root&&!evidence.startsWith(root+path.sep),'EVIDENCE_MUST_BE_EXTERNAL');
fs.mkdirSync(evidence,{recursive:true,mode:0o700});const temporary=fs.mkdtempSync(path.join(evidence,'fixture-build-'));fs.mkdirSync(path.join(temporary,'tmp'));fs.mkdirSync(path.join(temporary,'cache'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const rel='fixed-host/hengrui/build-full-composition-fixture.mts',originalPath=path.join(runtime,rel),original=fs.readFileSync(path.join(frozen,rel),'utf8');
assert.equal(fs.readFileSync(originalPath,'utf8'),original,'ACTUAL_FROZEN_GENERATOR_BYTES');
const provenance=[];
for(const r of [rel,'connector-gate/hengrui-synthetic-fixture.mts','connector-gate/hengrui-publication-review.mts','test/fixtures/hengrui-moka-synthetic.mts','vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts','vendor/c60-source/src/db/ingestionRepository.ts','vendor/c60-source/src/db/cloudPilotSqlControl.ts']){
 const raw=fs.readFileSync(path.join(frozen,r));assert.equal(sha(fs.readFileSync(path.join(runtime,r))),sha(raw),'FROZEN_SOURCE:'+r);provenance.push({relative:r,sha256:sha(raw)});
}
const require=createRequire(originalPath),variants={};
for(const [key,options] of [['zero',{count:0}],['one',{count:1}],['seven',{count:7}],['fiftyOne',{count:51,excludeUS:true,excludeHK:true}]]){
 const output=path.join(temporary,'hengrui-'+key+'.json'),script=path.join(temporary,'builder-'+key+'.mts');
 // Only module resolution, synthetic input options, and returned diagnostic
 // data change. The original ingestion/publication compilers are not replaced.
 let code=original.replace(/from '([^']+)'/g,(whole,spec)=>spec.startsWith('node:')?whole:"from "+JSON.stringify(pathToFileURL(spec.startsWith('.')?path.resolve(path.dirname(originalPath),spec):require.resolve(spec)).href));
 code=code.replaceAll('import.meta.dirname',JSON.stringify(path.dirname(originalPath)));
 assert.equal(code.split('syntheticOptions:{count:7}').length,2);code=code.replace('syntheticOptions:{count:7}','syntheticOptions:'+JSON.stringify(options));
 assert.equal(code.split("const data={kind:").length,2);code=code.replace("const data={kind:","const data={syntheticFixtureOptions:"+JSON.stringify(options)+",syntheticSourceEvidence:source.result.fetchEvidence,kind:");
 fs.writeFileSync(script,code,{flag:'wx'});
 const args=['--require',path.join(runtime,'test/no-network.cjs'),'--import',path.join(runtime,'node_modules/tsx/dist/loader.mjs'),script,output];
 const env={...process.env,JOBFINDER_CLOUD_SOURCE_ID:'source-hengrui-social',TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1',TMPDIR:path.join(temporary,'tmp'),XDG_CACHE_HOME:path.join(temporary,'cache')};
 const run=spawnSync(node,args,{cwd:runtime,env,encoding:'utf8',maxBuffer:16*1024*1024});
 fs.writeFileSync(path.join(temporary,key+'.stdout.log'),run.stdout??'',{flag:'wx'});fs.writeFileSync(path.join(temporary,key+'.stderr.log'),run.stderr??'',{flag:'wx'});
 assert.equal(run.status,0,'ACTUAL_HENGRUI_FIXTURE_FAILED:'+key+':'+run.stderr);
 const f=JSON.parse(fs.readFileSync(output));assert.equal(f.model.projections.length,options.count);assert.equal(f.context.sourceId,'source-hengrui-social');
 assert.ok(f.model.projections.every(p=>!p.officialUrl.includes('synthetic-hengrui-us')&&!p.officialUrl.includes('synthetic-hengrui-hk')),'US_HK_EXCLUDED_BY_ORIGINAL_ADAPTER');
 variants[key]={path:output,sha256:sha(fs.readFileSync(output)),options,projectionCount:f.model.projections.length,compilerCounts:f.model.row.completenessCertificate.legacyCertificate.counts,sourceEvidence:f.syntheticSourceEvidence};
 console.log(JSON.stringify({variant:key,passed:true,projectionCount:options.count,path:output}));
}
const report={kind:'THREE_SOURCE_HENGRUI_FIXTURE_SET',variants,provenance,frozenPackage:frozen,runtimePackage:runtime,node:{path:node,sha256:sha(fs.readFileSync(node))},realDatabaseCalls:0,realBrowserCalls:0,networkCalls:0,newInstalls:0,dependencyCopies:0,deletedEvidence:false,temporary};
const manifest=path.join(temporary,'manifest.json');fs.writeFileSync(manifest,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({manifest}));
