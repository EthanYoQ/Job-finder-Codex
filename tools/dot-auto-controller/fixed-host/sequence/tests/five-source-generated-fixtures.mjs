/** Assemble already generated ORIGINAL Viatris native-compiler fixtures.
 * This script never fabricates native receipts and does not run native code.
 * Args: one.json seven.json eleven.json external-manifest.json.
 * The separate native emitter requires its own approved dependency/runtime gate.
 */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const [one,seven,eleven,out]=process.argv.slice(2);assert.equal(process.argv.length,6,'VIATRIS_ONE_SEVEN_ELEVEN_MANIFEST_REQUIRED');
for(const file of [one,seven,eleven,out])assert(!path.resolve(file).startsWith(root+path.sep),'FIXTURE_MUST_BE_EXTERNAL');
const variants={};
for(const [name,count,file] of [['one',1,one],['seven',7,seven],['eleven',11,eleven]]){
 const raw=fs.readFileSync(file),data=JSON.parse(raw);assert.equal(data.kind,'SYNTHETIC_ORIGINAL_SCHEMA50_VIATRIS_COMPILER_FIXTURE');assert.equal(data.context.sourceId,'source-viatris-social');assert.equal(data.model.row.sourceId,'source-viatris-social');assert.equal(data.syntheticFixtureOptions.count,count);assert.equal(data.model.projections.length,count);assert(data.model.row.completenessCertificate);assert.equal(data.context.latestAccepted,null);assert.equal(data.context.firstAccepted,null);
 const expected=new Map(Array.from({length:count},(_,i)=>['synthetic-'+(i+1),{title:'Synthetic Viatris Role '+(i+1),url:'https://careersite.tupu360.com/Viatris/position/detail?positionId=synthetic-'+(i+1)}]));
 // Native projection order is lexical by raw ID, not numeric fixture order.
 // Compare an ID copy, preserving duplicates; never reorder native projections.
 assert.deepEqual(data.model.projections.map(p=>p.sourceJobId).sort(),[...expected.keys()].sort(),'EXACT_NATIVE_RAW_ID_BIJECTION');
 for(const p of data.model.projections){const row=expected.get(p.sourceJobId);assert.ok(row,'EXACT_NATIVE_RAW_ID');assert.equal(p.sourceId,'source-viatris-social');assert.equal(p.companyId,'company-viatris');assert.equal(p.officialTitle,row.title);assert.equal(p.officialUrl,row.url);}
 variants[name]={path:path.resolve(file),sha256:sha(raw),options:data.syntheticFixtureOptions,projectionCount:count};
}
const result={kind:'FIVE_SOURCE_VIATRIS_FIXTURE_SET',variants,zeroSemantics:'ORIGINAL_TUPU_FAILED_NO_SUCCESS_FIXTURE',nativeEmitter:'fixed-host/viatris/build-full-composition-fixture.mts',nativeEmitterSha256:sha(fs.readFileSync(root+'/fixed-host/viatris/build-full-composition-fixture.mts')),realDatabaseCalls:0,realBrowserCalls:0,networkCalls:0,productionQualified:false};
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({manifest:path.resolve(out),variants:Object.keys(variants)}));
