/** Actual Biogen functions-entry body and original shared synthetic transport
 * harness. Real Python SH holder and EX writer probe. No DB/browser/network.
 * Only deployment/activation/bootstrap DATA constants become synthetic.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {prepareFixture,holderTools,writer} from '../tests/lifecycle-bridge.test.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),HOST=path.dirname(HERE),PACKAGE=path.dirname(HOST),hash=x=>createHash('sha256').update(x).digest('hex');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'biogen-fixed-full-composition-')),fixturePath=path.join(temporary,'fixture.json');
const productionBundle=fs.readFileSync(path.join(HERE,'functions-entry.js'),'utf8'),productionSha256=hash(productionBundle);
const leases=[];
try{
 const built=spawnSync(process.execPath,['--require',path.join(PACKAGE,'test/no-network.cjs'),'--import',path.join(PACKAGE,'node_modules/tsx/dist/loader.mjs'),path.join(HERE,'build-full-composition-fixture.mts'),fixturePath],{cwd:PACKAGE,encoding:'utf8',env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:'source-biogen-china-social',TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1'}});
 assert.equal(built.status,0,built.stderr+'\n'+built.stdout);
 const fixtureData=JSON.parse(fs.readFileSync(fixturePath,'utf8'));
 assert.equal(fixtureData.model.row.sourceId,'source-biogen-china-social');assert.equal(fixtureData.model.projections.length,7);
 assert.ok(fixtureData.requests.PUBLISH.payload.sql.includes('PILOT_V75_FENCE_TRIGGER_DRIFT'));
 assert.ok(fixtureData.requests.PUBLISH.payload.sql.includes('biibhr.wd3.myworkdayjobs.com'));
 assert.ok(!fixtureData.requests.PUBLISH.payload.sql.includes('jobs.takeda.com'));
 const activation={enabled:true,mode:'LIVE',deploymentSha256:'c'.repeat(64)};
 const deployment={kind:'LIVE_DEPLOYMENT',fixturePreloadSha256:null,expectedRow:{...fixtureData.context.candidateRow,id:'fixed-functions-v4-unregistered'}};
 const query="BEGIN READ ONLY; SET LOCAL statement_timeout='4s'; SELECT clock_timestamp() AS \"checkedAt\",to_jsonb(r) AS candidate FROM public.\"ReleaseCandidate\" r WHERE id='fixed-functions-v4-unregistered'; COMMIT;\n";
 const bundle=productionBundle.replace(/^const ACTIVATION=.*\n/,'const ACTIVATION=Object.freeze('+JSON.stringify(activation)+');\n')
  .replace(/^const DEPLOYMENT=.*\n/m,'const DEPLOYMENT='+JSON.stringify(deployment)+';\n')
  .replace(/^const BOOTSTRAP_SQL=.*\n/m,()=> 'const BOOTSTRAP_SQL='+JSON.stringify(query)+';\n');
 assert.notEqual(bundle,productionBundle);
 const executionBody=s=>s.slice(s.indexOf('// Fixed functions composition:'));
 assert.equal(executionBody(bundle),executionBody(productionBundle),'Actual Biogen host execution body must remain unchanged');
 let harness=fs.readFileSync(path.join(HOST,'tests/full-composition-v8-harness.js'),'utf8');
 const originalHarnessSha256=hash(harness);
 // Source-specific synthetic values only. Original harness port logic is retained.
 harness=harness.replaceAll('source-takeda-china-social','source-biogen-china-social').replaceAll('company-takeda-china','company-biogen-china')
  .replaceAll('武田中国','渤健中国').replaceAll('https://jobs.takeda.com/location/china-jobs/1113/1814991/2','https://biibhr.wd3.myworkdayjobs.com/external')
  .replaceAll('2 个职位','7 个职位');
 // Actual Biogen CUA emits the URL externalPath; normalization stays in its original port.
 const originalList="const jobs=f.model.projections.map(p=>({sourceJobId:p.sourceJobId,officialTitle:p.officialTitle,officialUrl:p.officialUrl}));";
 assert.equal(harness.split(originalList).length,2);
 harness=harness.replace(originalList,"const jobs=f.model.projections.map(p=>({sourceJobId:p.officialUrl.slice('https://biibhr.wd3.myworkdayjobs.com/external'.length),officialTitle:p.officialTitle,officialUrl:p.officialUrl}));");
 const AF=Object.getPrototypeOf(async function(){}).constructor,digestSource=fs.readFileSync(path.join(HOST,'functions/sha256.js'),'utf8');
 const coverage=[];
 async function lifecycleFactory(actualBundle,syntheticTools,TestDate,notice,name){
  const fixture=prepareFixture(actualBundle),owner=holderTools(fixture,{...syntheticTools});leases.push({fixture,owner});
  let observedPending=false,blockedDuringRound=false;
  const observed=value=>{
   notice(value);
   if(value.kind==='ORIGINAL_SESSION_DRAINED_BEFORE_PENDING_SERVICE'&&!value.publicationSettled&&name==='pending-late'){
    assert.equal(writer(fixture).reason,'LIFECYCLE_BUSY','EX must remain blocked after original child terminal while original publish Promise is pending');observedPending=true;
   }
  };
  const stableSource=fs.readFileSync(fixture.loader,'utf8');
  const stable=new Function('tools','notify','Date',stableSource)(owner.tools,observed,TestDate);let attempted=false;
  return Object.freeze({async runLiveRound(){
   if(attempted)return stable.runPinnedRound();attempted=true;
   const running=stable.runPinnedRound();
   // The shared loader issues its actual Python holder before candidate entry execution.
   while(!owner.holder)await new Promise(r=>setTimeout(r,2));
   while(!fs.existsSync(fixture.active))await new Promise(r=>setTimeout(r,2));
   assert.equal(writer(fixture).reason,'LIFECYCLE_BUSY');blockedDuringRound=true;
   let result;try{result=await running;}catch(error){assert.equal(writer(fixture).reason,'ACTIVE_OR_UNKNOWN_ROUND');throw error;}
   if(result.status==='LIVE_ROUND_VERIFIED'||result.status==='SKIPPED_NOT_DUE'){
    assert.equal(result.lifecycle?.state,'ORIGINAL_ROUND_FINISHED',JSON.stringify(result));assert.equal(writer(fixture).status,'IDLE');
   }else{
    if(name==='pending-late')assert.equal(observedPending,true);assert.equal(writer(fixture).reason,'ACTIVE_OR_UNKNOWN_ROUND');assert.equal(result.lifecycle,undefined);
   }
   coverage.push({name,status:result.status,sameOriginalPromise:result.sameOriginalPromise,blockedDuringRound,observedPending,markerExists:fs.existsSync(fixture.active),lifecycle:result.lifecycle??null,writerAfter:writer(fixture)});
   return result;
  }});
 }
 const creation="const api=new Function('tools','Date','notify',actualBundle)(syntheticTools,TestDate,x=>safeNotices.push(x));";
 assert.equal(harness.split(creation).length,2);
 let lifecycleHarness=harness.replace(creation,"const api=await lifecycleFactory(actualBundle,syntheticTools,TestDate,x=>safeNotices.push(x),name);");
 const footer=lifecycleHarness.indexOf('const reports=[];const prod=');assert.ok(footer>0);
 lifecycleHarness=lifecycleHarness.slice(0,footer)+"const reports=[];for(const name of ['success','pending-late','not-due'])reports.push(await scenario(name));return reports;";
 const lifecycleRun=new AF('bundle','fixtureData','digestSource','mode','deploymentInfo','productionBundle','notify','lifecycleFactory',lifecycleHarness);
 const lifecycleScenarios=await lifecycleRun(bundle,fixtureData,digestSource,'LIVE',{deployment,activation},productionBundle,()=>{},lifecycleFactory);
 console.log(JSON.stringify({kind:'BIOGEN_REAL_LIFECYCLE_COMPOSITION',passed:true,productionSha256,coverage}));
 let fullHarness=harness.replace(creation,"const api=await lifecycleFactory(actualBundle,syntheticTools,TestDate,x=>safeNotices.push(x),name);");
 const poison="new Function('tools',bundle.replace('PIPE_SCOPE','PIPE_SCOPE_TAMPER'))({exec_command(){tamperCalls++;},write_stdin(){},apply_patch(){},mcp__codex_apps__supabase_execute_sql(){},mcp__cua_repl__js(){}})";
 assert.equal(fullHarness.split(poison).length,2);
 fullHarness=fullHarness.replace(poison,"await lifecycleFactory(bundle.replace('PIPE_SCOPE','PIPE_SCOPE_TAMPER'),{exec_command(){tamperCalls++;},write_stdin(){},apply_patch(){},mcp__codex_apps__supabase_execute_sql(){},mcp__cua_repl__js(){}},Date,()=>{},'dependency-pin-tamper')");
 const fullRun=new AF('bundle','fixtureData','digestSource','mode','deploymentInfo','productionBundle','notify','lifecycleFactory',fullHarness);
 const full=await fullRun(bundle,fixtureData,digestSource,'LIVE',{deployment,activation},productionBundle,()=>{},lifecycleFactory);
 assert.equal(fs.readFileSync(path.join(HERE,'functions-entry.js'),'utf8'),productionBundle,'Profile source must remain stable throughout the test');
 const report={kind:'BIOGEN_ACTUAL_GENERATED_FUNCTIONS_AND_REAL_LIFECYCLE',passed:true,productionSha256,originalHarnessSha256,originalExecutionBodyUnchanged:true,fixtureSource:'ORIGINAL_BIOGEN_SCHEMA50_GATE_WORKDAY_SYNTHETIC',fixtureJobCount:7,lifecycleScenarios,coverage,full,realDatabaseCalls:0,realBrowserCalls:0,networkCalls:0,productionActivated:false};
 const output=process.argv[2];if(output)fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({kind:report.kind,passed:true,productionSha256,fullCases:full.scenarios.length,lifecycleCases:coverage.length,realDatabaseCalls:0,realBrowserCalls:0,networkCalls:0,productionActivated:false}));
}finally{
 for(const {fixture,owner} of leases){await owner.stop();fs.rmSync(fixture.case,{recursive:true,force:true});}
 fs.rmSync(temporary,{recursive:true,force:true});
}
