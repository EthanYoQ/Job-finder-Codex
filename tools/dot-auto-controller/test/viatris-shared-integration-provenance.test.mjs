import {FIVE_BASE_COMMIT} from '../scripts/five-source-provenance.mjs';
/** New integration invariants. The historical suites separately validate both retained views. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {INTEGRATION_SHARED_PARENT as S,INTEGRATION_VIATRIS_PARENT as V,INTEGRATION_PILOT as P,viatrisSharedIntegrationSourceProvenance as validate} from '../scripts/viatris-shared-integration-provenance.mjs';
import {actualIntegrationManifest as current,validateIntegrationViews,integrationGit as git,integrationHash as sha} from './viatris-shared-integration-layers.mjs';
const root=path.resolve(import.meta.dirname,'..'),prefix='tools/dot-auto-controller/',pilot=current.files.find(f=>f.path===P),read=relative=>fs.readFileSync(root+'/vendor/c60-source/'+relative);
test('the retained e478 integration is a real ordered two-parent merge beneath the current successor',()=>{
 const run=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 assert.equal(run('show','-s','--format=%P',FIVE_BASE_COMMIT),S+' '+V);assert.equal(run('rev-parse','--is-shallow-repository'),'false');
 assert.equal(run('merge-base',S,V),'9629790860e68df0a8f09fb14f7ab05e1a2fbbfa');
 for(const parent of [S,V])assert.doesNotThrow(()=>run('merge-base','--is-ancestor',parent,'HEAD'));
 assert.equal(fs.existsSync(path.join(run('rev-parse','--show-toplevel'),'.git/objects/info/alternates')),false);
});
test('both complete frozen source manifests reconstruct from validated actual records and bytes',()=>{const views=validateIntegrationViews(current);assert.equal(views.shared.files.length,877);assert.equal(views.viatris.files.length,878);});
test('portable pilot is exact bf192cd plus the original shared legacy guard, without other edits',()=>{
 const before=git(V,'c60-source/'+P).toString();
 const expected=before.replace('import { archiveSourceEvidence } from "../src/crawler/artifactArchive";','import { archiveSourceEvidence } from "../src/crawler/artifactArchive";\nimport { evaluateCompletenessAnomalyForCrawl } from "../src/crawler/completenessAnomalyPolicy";').replace('phase="BUILD_COMMIT";const commit=buildAtomicRuntimeCommit({plan,pending,identity,batchId,result,...context,artifacts:restoredArtifacts,attemptTracker,sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,sourceQualityAdmission:admission});','phase="BUILD_COMMIT";const anomaly=evaluateCompletenessAnomalyForCrawl(plan,result,context.trustedCompletenessBaseline);\n    const commit=buildAtomicRuntimeCommit({plan,pending,identity,batchId,result,...context,artifacts:restoredArtifacts,attemptTracker,sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,sourceQualityAdmission:admission,...(anomaly.triggerCodes.length>0?{completenessAnomalyTriggerCodes:anomaly.triggerCodes}:{})});');
 assert.notEqual(expected,before);assert.equal(read(P).toString(),expected);
});
test('shared compiler, B selector, original count thresholds and crawl delegation remain exact 36a03b8',()=>{for(const relative of ['src/db/ingestionRepository.ts','src/crawler/completenessAnomalyPolicy.ts','src/crawler/runCrawlBatch.ts'])assert.deepEqual(read(relative),git(S,'c60-source/'+relative));});
test('Viatris relay, DB-started route and sidecar remain exact bf192cd',()=>{for(const relative of ['src/crawler/cloudSourcePilotRelay.ts','src/crawler/cloudDbStartedPilot.ts','src/crawler/viatrisFixedJobProjectionSidecar.ts'])assert.deepEqual(read(relative),git(V,'c60-source/'+relative));});
test('retained four-source defaults remain exact both parents; current unchanged files remain byte-exact',()=>{
 const authorizedDerivatives=new Set(["fixed-host/sequence/README.md", "fixed-host/sequence/tests/GENERATED_COMPOSITION.md", "fixed-host/lifecycle/lifecycle_lock.py", "fixed-host/functions/source-pins.json", "fixed-host/functions-entry.js", "fixed-host/functions-loader.js", "fixed-host/functions-activate.js", "fixed-host/tests/request-ready.test.mjs", "fixed-host/tests/source-seal.test.mjs", "fixed-host/biogen/source-pins.json", "fixed-host/biogen/functions-entry.js", "fixed-host/biogen/functions-loader.js", "fixed-host/biogen/functions-activate.js", "fixed-host/hengrui/source-pins.json", "fixed-host/hengrui/functions-entry.js", "fixed-host/hengrui/functions-loader.js", "fixed-host/hengrui/functions-activate.js", "fixed-host/ucb/source-pins.json", "fixed-host/ucb/functions-entry.js", "fixed-host/ucb/functions-loader.js", "fixed-host/ucb/functions-activate.js", "fixed-host/sequence/build-functions-entry.py", "fixed-host/sequence/coordinator.template.js", "fixed-host/sequence/lifecycle-loader.template.js", "fixed-host/sequence/holder.py.in", "fixed-host/sequence/cli-entry.py.in", "fixed-host/sequence/local-activation.py.in", "fixed-host/sequence/bound-artifacts.py.in", "fixed-host/sequence/render-install.py", "fixed-host/sequence/source-pins.json", "fixed-host/sequence/functions-entry.js", "fixed-host/sequence/functions-loader.js", "fixed-host/sequence/functions-activate.js", "fixed-host/sequence/test-bound-install.py", "fixed-host/sequence/test-derive-release.py", "fixed-host/sequence/test-installed-prepare.py", "fixed-host/sequence/tests/activation-render.test.py", "fixed-host/sequence/tests/canonical.test.py", "fixed-host/sequence/tests/coordinator.test.mjs", "fixed-host/sequence/tests/install-closure.test.py", "fixed-host/sequence/tests/installed-prepare-identities.test.py", "fixed-host/sequence/tests/real-holder-fixture.py", "fixed-host/sequence/tests/real-holder.test.mjs", "fixed-host/sequence/tests/cli-durable.test.py", "fixed-host/sequence/tests/generated-composition.test.mjs"]);
 const paths=execFileSync('git',['ls-tree','--full-tree','-r','--name-only',S],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(f=>f.startsWith(prefix+'fixed-host/')||f.startsWith(prefix+'config/')||f.startsWith(prefix+'native/')||f.startsWith(prefix+'vendor/c60-source/src/data/')||f.startsWith(prefix+'vendor/c60-source/src/crawler/adapters/'));
 assert.ok(paths.length>100);for(const f of paths){const actual=execFileSync('git',['show',FIVE_BASE_COMMIT+':'+f],{cwd:root});for(const parent of [S,V])assert.deepEqual(actual,execFileSync('git',['show',parent+':'+f],{cwd:root}),f);if(!authorizedDerivatives.has(f.slice(prefix.length)))assert.deepEqual(fs.readFileSync(path.join(root,f.slice(prefix.length))),actual,'CURRENT_PROTECTED:'+f);}
});
for(const [name,mutate] of [
 ['drop shared parent',f=>delete f.derivativeBaseCommit],['drop second parent',f=>delete f.incomingViatrisCommit],['fake shared commit',f=>f.derivativeBaseCommit='0'.repeat(40)],['fake Viatris commit',f=>f.incomingViatrisCommit='0'.repeat(40)],
 ['fake shared blob',f=>f.derivativeBaseGitBlobSha1='0'.repeat(40)],['fake incoming blob',f=>f.incomingViatrisGitBlobSha1='0'.repeat(40)],['fake incoming hash',f=>f.incomingViatrisSha256='0'.repeat(64)],
 ['drop shared prior',f=>delete f.priorProvenance],['drop Viatris prior',f=>delete f.incomingViatrisProvenance],['replace shared prior and rehash',f=>{f.priorProvenance=f.incomingViatrisProvenance;f.priorProvenanceSha256=sha(JSON.stringify(f.priorProvenance));}],['replace Viatris prior and rehash',f=>{f.incomingViatrisProvenance=f.priorProvenance;f.incomingViatrisProvenanceSha256=sha(JSON.stringify(f.incomingViatrisProvenance));}],
 ['truncate shared ancestry',f=>delete f.priorProvenance.priorProvenance],['truncate Viatris ancestry',f=>delete f.incomingViatrisProvenance.priorProvenance],['foreign path privilege',f=>f.path='src/db/ingestionRepository.ts'],['unknown field',f=>f.allowProduction=true],['production claim',f=>f.productionQualified=true],['registered identity',f=>f.sourceStatus='REGISTERED'],['stale result hash',f=>f.sha256=f.derivativeBaseSha256],['stale bytes',f=>f.bytes++],
])test('integration validator rejects '+name,()=>{const f=structuredClone(pilot);mutate(f);assert.throws(()=>validate(f));});
test('full view reconstruction refuses dropped sidecar, rewritten unrelated record or current bytes',()=>{
 for(const change of [m=>m.files.pop(),m=>m.files.find(f=>f.path==='src/crawler/runCrawlBatch.ts').priorProvenance.bytes++,m=>m.files.reverse()]){const m=structuredClone(current);change(m);assert.throws(()=>validateIntegrationViews(m));}
 assert.throws(()=>validateIntegrationViews(current,p=>p===P?Buffer.from('forged'):read(p)));
});
test('real current exporter rejects stripped integration, prior forgery and stale current bytes',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'integration-export-'));const write=(f,b)=>{fs.mkdirSync(path.dirname(temp+'/'+f),{recursive:true});fs.writeFileSync(temp+'/'+f,b);};
 try{
  for(const f of ['package-manifest.mjs','five-source-provenance.mjs','viatris-shared-integration-provenance.mjs','viatris-source-provenance.mjs','b-trigger-completeness-guard-source-provenance.mjs','legacy-completeness-guard-source-provenance.mjs','shared-completeness-guard-source-provenance.mjs','four-source-provenance.mjs','ucb-source-provenance.mjs','hengrui-source-provenance.mjs'])write('scripts/'+f,fs.readFileSync(root+'/scripts/'+f));
  for(const name of ['READER_MAIN_SOURCE_MANIFEST.json','READER_FALLBACK_SOURCE_MANIFEST.json'])write('vendor/'+name,JSON.stringify({files:[]}));write('config/hengrui-port-provenance.json',JSON.stringify({originCommit:null,productionQualified:false,files:[]}));
  const record=f=>write('vendor/C60_SOURCE_MANIFEST.json',JSON.stringify({originCommit:current.originCommit,files:[f]}));const bytes=b=>write('vendor/c60-source/'+P,b);const run=()=>execFileSync(process.execPath,[temp+'/scripts/package-manifest.mjs'],{stdio:['ignore','pipe','pipe']});
  record(pilot);bytes(read(P));assert.doesNotThrow(run);
  record(pilot.priorProvenance);assert.throws(run,/INTEGRATION_CLASS_REQUIRED/);
  record(pilot.incomingViatrisProvenance);assert.throws(run,/INTEGRATION_CLASS_REQUIRED/);
  const forged=structuredClone(pilot);forged.incomingViatrisProvenance.bytes++;forged.incomingViatrisProvenanceSha256=sha(JSON.stringify(forged.incomingViatrisProvenance));record(forged);assert.throws(run,/VIATRIS_SHARED_INTEGRATION/);
  record(pilot);bytes(Buffer.from('wrong bytes'));assert.throws(run,/INTEGRATION_CURRENT_BYTES_MISMATCH/);
  // A real exporter must not label new Viatris bytes as an inherited UCB/historical layer.
  for(const relative of ['src/crawler/cloudDbStartedPilot.ts','src/crawler/cloudSourcePilotRelay.ts','src/crawler/viatrisFixedJobProjectionSidecar.ts']){
   fs.rmSync(temp+'/vendor/c60-source',{recursive:true,force:true});
   const exact=current.files.find(f=>f.path===relative);record(exact);write('vendor/c60-source/'+relative,read(relative));assert.doesNotThrow(run);
   record(exact.priorProvenance??{...exact,classification:'EXACT_HISTORICAL_FILE_BYTES'});assert.throws(run,/VIATRIS_CLASS_REQUIRED/);
   record(exact);write('vendor/c60-source/'+relative,Buffer.from('stale current bytes'));assert.throws(run,/VIATRIS_CURRENT_BYTES_MISMATCH/);
  }

 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
