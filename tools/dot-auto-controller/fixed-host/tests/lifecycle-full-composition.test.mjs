/** Actual generated functions body, existing synthetic full-composition ports,
 * and real Python SH holder. No real DB, browser, network or publication call.
 * Only deployment/activation data constants in the test bundle are synthetic.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareFixture,holderTools,writer} from './lifecycle-bridge.test.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),HOST=path.dirname(HERE);
const EVIDENCE=path.resolve(HOST,'../../../evidence/lifecycle');
const fixtureData=JSON.parse(fs.readFileSync(path.join(EVIDENCE,'lifecycle-composition-fixture.json'),'utf8'));
const productionBundle=fs.readFileSync(path.join(HOST,'functions-entry.js'),'utf8');
const activation={enabled:true,mode:'LIVE',deploymentSha256:'c'.repeat(64)};
const expectedRow={...fixtureData.context.candidateRow,id:'fixed-functions-v4-unregistered'};
const deployment={kind:'LIVE_DEPLOYMENT',fixturePreloadSha256:null,expectedRow};
const query="BEGIN READ ONLY; SET LOCAL statement_timeout='4s'; SELECT clock_timestamp() AS \"checkedAt\",to_jsonb(r) AS candidate FROM public.\"ReleaseCandidate\" r WHERE id='fixed-functions-v4-unregistered'; COMMIT;\n";
let bundle=productionBundle.replace(/^const ACTIVATION=.*\n/,'const ACTIVATION=Object.freeze('+JSON.stringify(activation)+');\n')
 .replace(/^const DEPLOYMENT=.*\n/m,'const DEPLOYMENT='+JSON.stringify(deployment)+';\n')
 .replace(/^const BOOTSTRAP_SQL=.*\n/m,()=> 'const BOOTSTRAP_SQL='+JSON.stringify(query)+';\n');
assert.notEqual(bundle,productionBundle);
const tail=source=>source.slice(source.indexOf('// Fixed functions composition:'));
assert.equal(tail(bundle),tail(productionBundle),'Actual canonical generated execution body is unchanged');
let harness=fs.readFileSync(path.join(HERE,'full-composition-v8-harness.js'),'utf8');
const creation="const api=new Function('tools','Date','notify',actualBundle)(syntheticTools,TestDate,x=>safeNotices.push(x));";
assert.equal(harness.split(creation).length,2);
harness=harness.replace(creation,"const api=await lifecycleFactory(actualBundle,syntheticTools,TestDate,x=>safeNotices.push(x),name);");
// Select existing scenarios without rewriting their original fake tools/gates.
const footer=harness.indexOf('const reports=[];const prod=');assert.ok(footer>0);
harness=harness.slice(0,footer)+"const reports=[];for(const name of ['success','pending-late','not-due'])reports.push(await scenario(name));return reports;";
const leases=[],coverage=[];
async function lifecycleFactory(actualBundle,syntheticTools,TestDate,notice,name){
 const fixture=prepareFixture(actualBundle);const owner=holderTools(fixture,syntheticTools);leases.push({fixture,owner});
 let observedPending=false;
 const observed=value=>{
  notice(value);
  if(value.kind==='ORIGINAL_SESSION_DRAINED_BEFORE_PENDING_SERVICE'&&!value.publicationSettled&&name==='pending-late'){
   assert.equal(writer(fixture).reason,'LIFECYCLE_BUSY','EX must remain blocked while original publish is pending after terminal');observedPending=true;
  }
 };
 const stableSource=fs.readFileSync(fixture.loader,'utf8');
 const stable=new Function('tools','notify','Date',stableSource)(owner.tools,observed,TestDate);
 return Object.freeze({async runLiveRound(){
  const result=await stable.runPinnedRound();
  if(name==='success'||name==='not-due'){
   assert.equal(result.lifecycle?.state,'ORIGINAL_ROUND_FINISHED');assert.equal(writer(fixture).status,'IDLE');
  }else{
   assert.equal(observedPending,true);assert.equal(writer(fixture).reason,'ACTIVE_OR_UNKNOWN_ROUND');assert.equal(result.lifecycle,undefined);
  }
  coverage.push({name,status:result.status,originalPromiseSame:result.sameOriginalPromise,
   observedPending,markerExists:fs.existsSync(fixture.active),terminalObservedAt:result.terminalObservedAt,
   lifecycle:result.lifecycle??null,writerAfter:writer(fixture)});
  return result;
 }});
}
try{
 const AF=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AF('bundle','fixtureData','digestSource','mode','deploymentInfo','productionBundle','notify','lifecycleFactory',harness);
 const scenarios=await run(bundle,fixtureData,fs.readFileSync(path.join(HOST,'functions/sha256.js'),'utf8'),'LIVE',{deployment,activation},productionBundle,()=>{},lifecycleFactory);
 const report={kind:'ACTUAL_GENERATED_FUNCTIONS_WITH_REAL_LIFECYCLE_HOLDER',passed:true,
  originalCanonicalExecutionBodyUnchanged:true,syntheticDeploymentConstants:true,scenarios,coverage,
  realDatabaseCalls:0,realBrowserCalls:0,networkCalls:0,productionActivated:false};
 fs.writeFileSync(path.join(EVIDENCE,'lifecycle-full-composition-results.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({kind:report.kind,passed:true,coverage},null,2));
}finally{
 for(const {fixture,owner} of leases){await owner.stop();fs.rmSync(fixture.case,{recursive:true,force:true});}
}
