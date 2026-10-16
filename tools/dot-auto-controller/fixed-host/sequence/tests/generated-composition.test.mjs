/** Actual closed Takeda -> Biogen -> Hengrui -> UCB generated entry.
 * External CLI, SQL, child/session, classification, lifecycle and UI ports are
 * SYNTHETIC. Actual factories, source bodies, shared cores and UI code execute.
 * Args: Takeda JSON, Biogen JSON, Hengrui manifest, UCB manifest, report JSON.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {withKnownNotDispatchedScenarios} from '../../tests/source-seal-harness.mjs';
import {hengruiMokaId,hengruiMokaRawId} from '../../../public-verification/hengrui/moka-id.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),SEQUENCE=path.dirname(HERE),HOST=path.dirname(SEQUENCE),PACKAGE=path.dirname(HOST);
const ORDER=['takeda','biogen','hengrui','ucb'],IDS={takeda:'source-takeda-china-social',biogen:'source-biogen-china-social',hengrui:'source-hengrui-social',ucb:'source-ucb-china-social'};
const sha=x=>createHash('sha256').update(x).digest('hex');
const [takedaPath,biogenPath,hengruiManifestPath,ucbManifestPath,reportPath]=process.argv.slice(2);
assert.ok(takedaPath&&biogenPath&&hengruiManifestPath&&ucbManifestPath,'FOUR_SOURCE_FIXTURE_PATHS_REQUIRED');
for(const p of [takedaPath,biogenPath,hengruiManifestPath,ucbManifestPath,...reportPath?[reportPath]:[]])assert.ok(!path.resolve(p).startsWith(PACKAGE+path.sep),'FIXTURE_OR_REPORT_MUST_BE_EXTERNAL');
const manifest=JSON.parse(fs.readFileSync(hengruiManifestPath,'utf8'));assert.equal(manifest.kind,'THREE_SOURCE_HENGRUI_FIXTURE_SET');
const hengruiFixtures=Object.fromEntries(Object.entries(manifest.variants).map(([key,v])=>{const raw=fs.readFileSync(v.path);assert.equal(sha(raw),v.sha256);return [key,JSON.parse(raw)];}));
const ucbManifest=JSON.parse(fs.readFileSync(ucbManifestPath,'utf8'));assert.equal(ucbManifest.kind,'FOUR_SOURCE_UCB_FIXTURE_SET');
const ucbFixtures=Object.fromEntries(Object.entries(ucbManifest.variants).map(([key,v])=>{const raw=fs.readFileSync(v.path);assert.equal(sha(raw),v.sha256);return [key,JSON.parse(raw)];}));
assert.equal(ucbManifest.readerCases.length,5);assert.ok(ucbManifest.readerCases.every(c=>c.passed));
const fixturePaths={takeda:path.resolve(takedaPath),biogen:path.resolve(biogenPath),hengrui:manifest.variants.seven.path,ucb:ucbManifest.variants.seven.path};
const fixtures=Object.fromEntries(Object.entries(fixturePaths).map(([k,p])=>[k,JSON.parse(fs.readFileSync(p,'utf8'))]));
for(const [name,f] of [...Object.entries(fixtures),...Object.values(hengruiFixtures).map(f=>['hengrui',f])]){
 assert.equal(f.context.sourceId,IDS[name]);assert.equal(f.context.latestAccepted,null,'FIRST_PUBLIC_LATEST_NULL');assert.equal(f.context.firstAccepted,null,'FIRST_PUBLIC_FIRST_NULL');
 if(name==='hengrui'){
  assert.equal(f.model.row.sourceId,IDS.hengrui);
  for(const p of f.model.projections){assert.equal(p.sourceId,IDS.hengrui);assert.equal(p.companyId,'company-hengrui');assert.equal(p.sourceJobId,hengruiMokaId(hengruiMokaRawId(p.officialUrl)));assert.ok(!/synthetic-hengrui-(us|hk)/.test(p.officialUrl));}
  assert.ok(!f.requests.PUBLISH.payload.sql.includes('biibhr.wd3.myworkdayjobs.com'));assert.ok(!f.requests.PUBLISH.payload.sql.includes('jobs.takeda.com'));
 }
}
for(const [variant,f]of Object.entries(ucbFixtures)){
 assert.equal(f.context.sourceId,IDS.ucb);assert.equal(f.model.row.sourceId,IDS.ucb);
 const rows=f.syntheticFixtureOptions.rows??Array.from({length:f.syntheticFixtureOptions.priorCount??f.syntheticFixtureOptions.count},(_,i)=>({jobSeqNo:'UCB1GLOBALSYNTHETIC'+(i+1)+'EXTERNALZHGLOBAL',reqId:'synthetic-'+(i+1)}));
 for(const p of f.model.projections){assert.equal(p.sourceId,IDS.ucb);assert.equal(p.companyId,'company-ucb-china');assert.ok(rows.some(r=>r.jobSeqNo!==r.reqId&&p.sourceJobId==='official-json:sha256:'+sha(JSON.stringify(r.jobSeqNo))),'NATIVE_JOBSEQNO_ID_NOT_REQID');}
 if(variant!=='grace'){assert.equal(f.context.latestAccepted,null);assert.equal(f.context.firstAccepted,null);}
}
assert.equal(ucbFixtures.zero.model.projections.length,0);assert.equal(ucbFixtures.zero.syntheticSourceEvidence.declaredCompleteness.value,0);
const graceMembers=ucbFixtures.grace.model.row.completenessCertificate.members.filter(m=>m.setKind==='GRACE');assert.equal(graceMembers.length,1);assert.equal(graceMembers[0].missingCount,1);assert.equal(graceMembers[0].lastConfirmedObservedAt,ucbFixtures.grace.context.latestAccepted.completenessCertificate.observedAt);assert.equal(graceMembers[0].lastPresentResultId,ucbFixtures.grace.context.latestAccepted.id);assert.equal(graceMembers[0].lifecycleLastSeenAt,graceMembers[0].lastConfirmedObservedAt);
assert.ok(ucbFixtures.applyUrl.model.projections.some(p=>p.officialUrl===ucbFixtures.applyUrl.syntheticFixtureOptions.rows[0].applyUrl));
assert.equal(fixtures.biogen.model.projections.length,7);assert.ok(fixtures.biogen.requests.PUBLISH.payload.sql.includes('biibhr.wd3.myworkdayjobs.com'));
for(const [key,count] of [['zero',0],['one',1],['seven',7],['fiftyOne',51]])assert.equal(hengruiFixtures[key].model.projections.length,count);
assert.deepEqual(manifest.variants.fiftyOne.options,{count:51,excludeUS:true,excludeHK:true});
const zeroEvidence=hengruiFixtures.zero.syntheticSourceEvidence,pagedEvidence=hengruiFixtures.fiftyOne.syntheticSourceEvidence;
assert.equal(zeroEvidence.declaredCompleteness.value,0);assert.equal(zeroEvidence.pages.length,1);assert.equal(zeroEvidence.pages[0].requestedPageSize,50);assert.equal(zeroEvidence.pages[0].rawJobIds.length,0);
assert.deepEqual(pagedEvidence.pages.map(p=>p.requestedOffset),[0,50]);assert.ok(pagedEvidence.pages.every(p=>p.requestedPageSize===50&&p.declaredTotal===53));assert.equal(pagedEvidence.fetchCounts.rawCount,53);assert.equal(pagedEvidence.fetchCounts.validCount,51);assert.equal(pagedEvidence.fetchLosses.length,2);assert.ok(pagedEvidence.fetchLosses.every(f=>f.details.code==='OUT_OF_SCOPE'));

const original=fs.readFileSync(path.join(SEQUENCE,'functions-entry.js'),'utf8');
const py=String.raw`import json,runpy,sys
sys.dont_write_bytecode=True
m=runpy.run_path(sys.argv[1]);b=m['b'];i=b.load_source_inputs();r=m['synthetic_release'](i);b.validate_release(i,r)
print(json.dumps({'release':r,'entry':b.render_entry(i,r).decode(),'defaultSha256':b.sha(b.render_entry(i))}))`;
const built=spawnSync('python3',['-B','-c',py,path.join(HERE,'canonical.test.py')],{encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(built.status,0,built.stderr);
const {release,entry,defaultSha256}=JSON.parse(built.stdout);assert.equal(release.kind,'CLOSED_FOUR_SOURCE_RELEASE');assert.deepEqual(release.order,ORDER);assert.equal(sha(original),defaultSha256,'ACTUAL_DEFAULT_GENERATED_BYTES');
const outer=entry.split('\n',1)[0];assert.ok(outer.includes('"enabled":false'));
const bundle=entry.replace(outer,outer.replace('"enabled":false','"enabled":true'));assert.equal(bundle.slice(bundle.indexOf('\n')),entry.slice(entry.indexOf('\n')),'ACTUAL_EXECUTION_BYTES_UNCHANGED');
const digestSource=fs.readFileSync(path.join(HOST,'functions/sha256.js'),'utf8'),originalHarness=fs.readFileSync(path.join(HOST,'tests/full-composition-v8-harness.js'),'utf8');
const AF=Object.getPrototypeOf(async function(){}).constructor;
function replaceOnce(s,from,to){assert.equal(s.split(from).length,2,'TEST_HARNESS_ANCHOR:'+from);return s.replace(from,to);}
let portSource=withKnownNotDispatchedScenarios(originalHarness);portSource=portSource.slice(0,portSource.indexOf(' const actualBundle='));
portSource=replaceOnce(portSource,"roundId='round-'+sha(name).slice(0,32)","roundId='round-'+sha(profile+'_'+name).slice(0,32)");
portSource=replaceOnce(portSource,"TASK=BASE+'/rounds/'+roundId","TASK=BASE+'/sources/'+profile+'/rounds/'+roundId");
portSource=replaceOnce(portSource,"buildSha256:'a'.repeat(64)","buildSha256:deployment.build.contentSha256");
portSource=portSource.replaceAll('fixed-functions-v4-unregistered',release.profiles.takeda.candidate.id);
portSource=replaceOnce(portSource,"else setTimeout(()=>{resolved=true;resolve(rawRows([]));},3);","else setTimeout(()=>{Promise.resolve(externalPending()).then(()=>{resolved=true;resolve(rawRows([]));});},3);");
portSource=replaceOnce(portSource,"readOutcomeCalls++;return Promise.resolve(rawRows([{row:f.model.row,batch:f.model.batch,holderId:f.model.holderId}]));","readOutcomeCalls++;const row=name==='invalid-committed'?{...f.model.row,completenessCertificate:null,completenessCertificateSha256:null}:f.model.row;return Promise.resolve(rawRows([{row,batch:f.model.batch,holderId:f.model.holderId}]));");
portSource+='\n return {tools:syntheticTools,TestDate,requests,seed,cfg,fixture:f,terminal,stats:()=>({prepareCalls,bootstrapCalls,launchCalls,publishCalls,publishMarkCalls,publishResponseCalls,responseCalls,readOutcomeCalls,polls,ended,resolved,rawEvidenceWrites:[...files.keys()].filter(x=>x.endsWith(\'.raw-diagnostic\')).length,uiCalls:uiCalls.length}),calls,uiCalls,safeNotices};\n}\nreturn scenario(scenarioName);';
function sourcePortCode(name){
 if(name==='takeda')return portSource;
 const h=name==='hengrui',u=name==='ucb',native=h||u,company=h?'company-hengrui':u?'company-ucb-china':'company-biogen-china',label=h?'江苏恒瑞医药股份有限公司':u?'优时比中国':'渤健中国',entry=h?'https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs':u?'https://careers.ucb.com/global/zh/search-results?keywords=China':'https://biibhr.wd3.myworkdayjobs.com/external';
 let code=portSource.replaceAll('source-takeda-china-social',IDS[name]).replaceAll('company-takeda-china',company).replaceAll('武田中国',label).replaceAll('https://jobs.takeda.com/location/china-jobs/1113/1814991/2',entry);
 const list="const jobs=f.model.projections.map(p=>({sourceJobId:p.sourceJobId,officialTitle:p.officialTitle,officialUrl:p.officialUrl}));";
 code=replaceOnce(code,list,native?"const jobs=f.model.projections.map(p=>({sourceJobId:p.officialUrl,officialTitle:p.officialTitle,officialUrl:p.officialUrl}));":"const jobs=f.model.projections.map(p=>({sourceJobId:p.officialUrl.slice('https://biibhr.wd3.myworkdayjobs.com/external'.length),officialTitle:p.officialTitle,officialUrl:p.officialUrl}));");
 if(!native)return code.replaceAll('2 个职位','7 个职位');
 // Native Hengrui/UCB DOM packets expose URLs only. The unchanged source UI
 // normalizer, including UCB's receipt-bound URL/native-ID join, must accept them.
 code=replaceOnce(code,'return packet(action,{anchorJobs:jobs,visibleTitles:','return packet(action,{companyPresent:jobs.length>0,anchorJobs:jobs,visibleTitles:');
 code=replaceOnce(code,".replaceAll('116 个职位','2 个职位')",".replaceAll('116 个职位',f.model.projections.length+' 个职位')");
 code=replaceOnce(code,"if(checked)s=s.replace(","if(!f.model.projections.length&&uiView!=='directory')s=s.split('\\n').filter(line=>!line.includes('"+label+"')&&!line.includes('row-"+company+"')&&!line.includes('jobs-"+company+"')&&!line.includes('查看全部')).join('\\n');if(checked)s=s.replace(");
 code=replaceOnce(code,"if(all)s=s.replace(/\\n[^\\n]*8 button 查看全部 2 个职位/,'')","if(all)s=s.split('\\n').filter(line=>!line.includes('8 button 查看全部 ')).join('\\n')");
 return code;
}
const portFactory=Object.fromEntries(ORDER.map(n=>[n,new AF('fixtureData','digestSource','mode','deploymentInfo','profile','scenarioName','externalPending',sourcePortCode(n))]));
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cases=[
 {name:'all-four-success-fresh-context',continued:true},
 ...ORDER.flatMap(source=>[
  {name:source+'-not-due-continues',scenario:{[source]:'not-due'},continued:true},
  {name:source+'-exact-known-failure-continues',scenario:{[source]:'known-not-dispatched'},continued:true},
  ...['pending-late','tool-isError','projection-tamper','ui-hold','known-may-have-been-sent','known-signal','known-half-frame','record-deferred-hold','mark-deferred-hold','record-half-frame','mark-half-frame','raw-diagnostic-failure','not-due-child-nonzero','invalid-committed'].map(scenario=>({name:source+'-'+scenario+'-holds',scenario:{[source]:scenario},stop:source})),
  {name:source+'-raw-evidence-before-next-source-or-close',block:'raw',blockSource:source,continued:true},
  {name:source+'-durable-source-settled-before-next-source-or-close',block:'durable',blockSource:source,continued:true},
 ]),
 {name:'hengrui-original-publication-promise-before-ucb',block:'promise',blockSource:'hengrui',continued:true},
 {name:'hengrui-original-service-after-terminal-before-ucb',block:'service',blockSource:'hengrui',continued:true},
 ...['zero','one','fiftyOne'].map(variant=>({name:'hengrui-'+variant+'-actual-projections-ui',variant,continued:true})),
 ...['zero','applyUrl','grace'].map(ucbVariant=>({name:'ucb-'+ucbVariant+'-actual-projections-ui',ucbVariant,continued:true})),
 {name:'all-source-json-cross-cycle-one-shot-capability',capability:true,continued:true},
];
const reports=[];
for(const c of cases){
 const events=[],ports={},facts=[],contexts=[],dueClassifications=[],blocked=defer(),releaseBlock=defer();let active=null,closed=false,completed=false,ledgerVersion=0,activeCommands=0,pendingSeen=false;
 const scenario=profile=>c.scenario?.[profile]??'success';
 const push=(type,extra={})=>events.push({i:events.length,type,source:active,...extra});
 const noLater=(source=active)=>{
  for(const name of ORDER.slice(ORDER.indexOf(source)+1)){assert.equal(ports[name],undefined,name.toUpperCase()+'_FACTORY_NOT_CREATED');assert.equal(events.some(e=>e.type==='source-started'&&e.source===name),false,name.toUpperCase()+'_NOT_STARTED');}
  assert.equal(closed,false,'CYCLE_NOT_CLOSED_BEFORE_ALL_SOURCES_SETTLE');assert.equal(completed,false,'ENTRY_NOT_COMPLETE_WHILE_ORIGINAL_PENDING');
 };
 async function block(kind){noLater();push(kind+'-pending');blocked.resolve();await releaseBlock.promise;noLater();push(kind+'-released');}
 const scope={
  assertOriginal(){assert.equal(closed,false,'ORIGINAL_SCOPE_STILL_OPEN');},
  async sourceStarted(profile,releaseSha){
   assert.equal(profile,ORDER[facts.length],'FIXED_FOUR_SOURCE_ORDER');assert.equal(activeCommands,0,'NO_PRIOR_UNSETTLED_COMMANDS');
   for(const fact of facts)assert.ok(['VERIFIED','NOT_DUE','KNOWN_NOT_DISPATCHED'].includes(fact.kind));
   active=profile;push('source-started',{releaseSha});
   const deployment=release.profiles[profile],activation={enabled:true,mode:'LIVE',deploymentSha256:sha(JSON.stringify(deployment))};
   ports[profile]=await portFactory[profile](profile==='hengrui'?hengruiFixtures[c.variant??'seven']:profile==='ucb'?ucbFixtures[c.ucbVariant??'seven']:fixtures[profile],digestSource,'LIVE',{deployment,activation},profile,scenario(profile),()=>c.block==='promise'&&profile===c.blockSource?block('original-publication-promise'):undefined);
   ports[profile].fixture.context.syntheticLedgerVersion=ledgerVersion;
   push('fresh-source-seed',{batchId:ports[profile].seed.batchId,challenge:ports[profile].seed.launchChallenge,taskRoot:ports[profile].cfg.taskRoot,sourceId:ports[profile].seed.sourceId});
  },
  async sourceSettled(profile,releaseSha,fact){
   assert.equal(profile,active);assert.equal(activeCommands,0,'ALL_ORIGINAL_COMMANDS_SETTLED');
   const s=ports[profile].stats();assert.ok(s.ended,'ORIGINAL_SYNTHETIC_DUAL_TERMINAL');
   if(fact.kind==='VERIFIED'){assert.equal(s.resolved,true);assert.equal(s.rawEvidenceWrites,1);assert.equal(s.publishResponseCalls,1);assert.ok(s.uiCalls>0);}
   if(profile===c.blockSource&&c.block==='durable')await block('durable-ack');
   facts.push(fact);push('source-settled',{kind:fact.kind,stats:s});
  },
  closeCycle(result){assert.equal(facts.length,4);assert.equal(result.results.length,4);assert.equal(activeCommands,0);closed=true;push('cycle-closed');}
 };
 const current=()=>{assert.ok(active&&ports[active]);return ports[active];};
 const tools={
  async exec_command(args){
   const profile=active,p=current();activeCommands++;
   try{
    if(args.cmd.includes(" 'prepare'")){assert.ok(args.cmd.includes('cli-'+profile+'.py'),'COMPILE_FIXED_STABLE_CLI');push('prepare');}
    if(c.block==='raw'&&profile===c.blockSource&&args.cmd.includes(" 'record-tool-result' "))await block('raw-evidence');
    const result=await p.tools.exec_command(args);
    if(args.cmd.includes(" 'classify-context' ")){const classification=JSON.parse(result.output);dueClassifications.push({source:profile,due:classification.due,ledgerVersion,inputSha256:classification.inputSha256});push('source-specific-due',{due:classification.due});}
    if(c.block==='service'&&profile===c.blockSource&&args.cmd.startsWith('/usr/bin/python3 -I - <<')&&result.output.includes('"kind":"READ_OUTCOME"')){assert.equal(p.stats().ended,true);await block('original-service-after-terminal');}
    return result;
   }finally{activeCommands--;}
  },
  async write_stdin(args){activeCommands++;try{return await current().tools.write_stdin(args);}finally{activeCommands--;}}
  ,async apply_patch(patch){activeCommands++;try{return await current().tools.apply_patch(patch);}finally{activeCommands--;}}
  ,mcp__codex_apps__supabase_execute_sql(args){
   const profile=active,p=current(),kind=args.query===p.requests.PUBLISH.payload.sql?'PUBLISH':args.query===p.requests.READ_PUBLICATION_CONTEXT.payload.sql?'READ_PUBLICATION_CONTEXT':args.query==='SELECT TEST_ONLY_CONTEXT'?'READ_CONTEXT':args.query===p.requests.READ_OUTCOME.payload.sql?'READ_OUTCOME':'BOOTSTRAP';
   push('sql',{kind,ledgerVersion});
   if(kind==='READ_CONTEXT'||kind==='READ_PUBLICATION_CONTEXT')contexts.push({source:profile,kind,ledgerVersion,firstPublic:p.fixture.context.latestAccepted===null,sourceId:p.fixture.context.sourceId,querySha256:sha(args.query)});
   const originalPromise=p.tools.mcp__codex_apps__supabase_execute_sql(args);
   if(kind==='PUBLISH')originalPromise.then(()=>{if(scenario(profile)==='success'){ledgerVersion++;push('synthetic-db-committed',{profile,ledgerVersion});}},()=>{});
   return originalPromise; // Exact same synthetic official Promise, never chained/replaced.
  },
  async mcp__cua_repl__js(args){return current().tools.mcp__cua_repl__js(args);}
 };
 class CycleDate extends Date{static now(){return active?current().TestDate.now():Date.now();}}
 const notice=x=>{push('notice',{kind:x.kind});if(x.kind==='ORIGINAL_SESSION_DRAINED_BEFORE_PENDING_SERVICE'&&scenario(active)==='pending-late'){noLater();pendingSeen=true;assert.equal(current().stats().resolved,false);}};
 const api=new Function('tools','Date','notify','lifecycleScope',bundle)(tools,CycleDate,notice,scope);
 let running;
 if(c.capability){
  // Test-only lexical accessor omits the coordinator footer. Every generated
  // factory/body/core/UI byte remains identical; no consume implementation mock.
  const boundary=bundle.indexOf('// The only public entry.');assert.ok(boundary>0);
  const constructors=new Function('tools','Date','notify',bundle.slice(0,boundary)+'\nreturn {create_takeda,create_biogen,create_hengrui,create_ucb};')(tools,CycleDate,notice);
  running=(async()=>{const results=[];for(const name of ORDER){await scope.sourceStarted(name,sha(JSON.stringify(release)));const cycle=Object.freeze({}),other=Object.freeze({}),factory=constructors['create_'+name](cycle),foreign=constructors['create_'+name](other),result=await factory.run();
   assert.equal(result.status,'LIVE_ROUND_VERIFIED');
   for(const [label,attempt] of [['json-result',()=>factory.consume(JSON.parse(JSON.stringify(result)),cycle)],['forged-status',()=>factory.consume({status:'LIVE_ROUND_VERIFIED'},cycle)],['cross-cycle-token',()=>factory.consume(result,other)],['foreign-factory',()=>foreign.consume(result,other)]]){assert.throws(attempt,/SOURCE_CLOSE_CAPABILITY_REQUIRED/);push('capability-rejected',{label});}
   const fact=factory.consume(result,cycle);assert.throws(()=>factory.consume(result,cycle),/SOURCE_CLOSE_CAPABILITY_REQUIRED/);await assert.rejects(factory.run(),/SOURCE_CYCLE_ALREADY_STARTED/);push('capability-rejected',{label:'one-shot-replay'});await scope.sourceSettled(name,sha(JSON.stringify(release)),fact);results.push({sourceId:IDS[name],result});
  }const result={status:'SEQUENCE_SAFELY_CLOSED',results};scope.closeCycle(result);return result;})();
 }else running=api.runLiveRound();
 running.then(()=>{completed=true;},()=>{completed=true;});
 if(c.block){await Promise.race([blocked.promise,running.then(()=>{throw Error('EXPECTED_PENDING_BLOCK_NOT_REACHED:'+c.name);})]);noLater();await sleep(20);noLater();releaseBlock.resolve();}
 const result=await running;
 for(const [name,p] of Object.entries(ports)){
  const s=p.stats(),mode=scenario(name);assert.ok(s.publishCalls<=1,'PUBLISH_AT_MOST_ONCE');
  if(['record-deferred-hold','mark-deferred-hold','record-half-frame','mark-half-frame','known-may-have-been-sent','known-signal','known-half-frame','not-due-child-nonzero'].includes(mode))assert.equal(s.publishCalls,0,'HELD_CONTINUATION_NEVER_PUBLISHES');
  const r=result.results.find(r=>r.sourceId===IDS[name]).result;
  if(mode==='pending-late'){assert.equal(s.publishCalls,1);assert.equal(s.publishResponseCalls,0);assert.equal(r.sameOriginalPromise,true);assert.equal(pendingSeen,true);assert.equal(s.resolved,true);}
  if(mode==='tool-isError')assert.equal(r.databaseStatus,'UNKNOWN');
  if(mode==='ui-hold'){assert.equal(r.databaseStatus,'LIVE_VERIFIED');assert.equal(s.publishCalls,1);}
  if(mode==='invalid-committed'){assert.equal(s.publishCalls,1);assert.equal(s.readOutcomeCalls,1);assert.equal(s.uiCalls,0);assert.equal(r.status,'HOLD');assert.ok(r.errors.includes('UI_COMMITTED_RECEIPT_BINDING'));}
 }
 if(c.continued){
  assert.equal(result.status,'SEQUENCE_SAFELY_CLOSED',JSON.stringify(result));assert.equal(closed,true);assert.equal(result.results.length,4);assert.deepEqual(result.results.map(r=>r.sourceId),ORDER.map(n=>IDS[n]));
  for(const key of ['batchId','launchChallenge'])assert.equal(new Set(ORDER.map(n=>ports[n].seed[key])).size,4,'FOUR_FRESH_'+key);
  assert.equal(new Set(ORDER.map(n=>ports[n].cfg.taskRoot)).size,4,'FOUR_SOURCE_STATE_ROOTS');assert.equal(dueClassifications.length,4);assert.equal(new Set(dueClassifications.map(d=>d.inputSha256)).size,4,'FRESH_DUE_INPUT_PER_SOURCE');
  let expectedLedger=0;
  for(const name of ORDER){const p=ports[name],s=p.stats(),mode=scenario(name),index=ORDER.indexOf(name),fact=facts[index],r=result.results[index].result;
   assert.equal(s.bootstrapCalls,1);assert.equal(s.prepareCalls,1);assert.equal(s.launchCalls,1);assert.ok(p.cfg.taskRoot.includes('/sources/'+name+'/rounds/'));assert.equal(p.seed.sourceId,IDS[name]);
   const context=contexts.find(v=>v.source===name&&v.kind==='READ_CONTEXT');assert.ok(context);assert.equal(context.ledgerVersion,expectedLedger);assert.equal(context.sourceId,IDS[name]);assert.equal(context.firstPublic,!(name==='ucb'&&c.ucbVariant==='grace'));
   if(mode!=='not-due'){const pc=contexts.find(v=>v.source===name&&v.kind==='READ_PUBLICATION_CONTEXT');assert.ok(pc);assert.equal(pc.ledgerVersion,expectedLedger);}
   if(index)assert.ok(events.find(e=>e.type==='source-settled'&&e.source===ORDER[index-1]).i<events.find(e=>e.type==='source-started'&&e.source===name).i);
   if(mode==='success'){expectedLedger++;assert.equal(s.publishCalls,1);assert.equal(fact.kind,'VERIFIED');assert.equal(r.ui.status,'PASS_LIST_AND_SOURCE_TIME_ONLY');}
   if(mode==='known-not-dispatched'){assert.equal(fact.kind,'KNOWN_NOT_DISPATCHED');assert.equal(r.status,'HOLD');assert.equal(r.knownNotDispatchedReceipt.oldFailurePreserved,true);assert.equal(r.knownNotDispatchedReceipt.newSuccessRecorded,false);}
   if(mode==='not-due'){assert.equal(fact.kind,'NOT_DUE');assert.equal(s.publishCalls,0);assert.equal(r.noPublicationReceipt.newSuccessRecorded,false);assert.equal(dueClassifications[index].due,false);}
  }
 }else{
  assert.equal(result.status,'GLOBAL_HOLD',JSON.stringify(result));assert.equal(closed,false);assert.equal(facts.length,ORDER.indexOf(c.stop));assert.equal(result.stoppedAt,IDS[c.stop]);
  for(const name of ORDER.slice(ORDER.indexOf(c.stop)+1)){assert.equal(ports[name],undefined,'NO_LATER_FACTORY');assert.equal(events.filter(e=>e.type==='prepare'&&e.source===name).length,0,'NO_LATER_PREPARE');}
  // Hengrui cannot prepare/launch while either earlier source remains unsettled.
  if(ORDER.indexOf(c.stop)<2)assert.equal(ports.hengrui,undefined,'H_PREPARE_AND_LAUNCH_ZERO');
  if(c.stop!=='ucb')assert.equal(ports.ucb,undefined,'UCB_PREPARE_AND_LAUNCH_ZERO');
 }
 reports.push({name:c.name,passed:true,status:result.status,sourceResults:result.results.map(r=>({sourceId:r.sourceId,status:r.result.status,databaseStatus:r.result.databaseStatus,errors:r.result.errors,publicationCallCount:r.result.publicationCallCount,sameOriginalPromise:r.result.sameOriginalPromise,pipe:r.result.pipe,ui:r.result.ui?.status})),stats:Object.fromEntries(Object.entries(ports).map(([k,p])=>[k,p.stats()])),unstartedSources:Object.fromEntries(ORDER.filter(name=>!ports[name]).map(name=>[name,{factoryCreated:false,prepareCalls:0,bootstrapCalls:0,launchCalls:0}])),closedKinds:facts.map(f=>f.kind),contexts,dueClassifications,events});
 console.log(JSON.stringify({name:c.name,status:result.status,passed:true}));
}
assert.equal(fs.readFileSync(path.join(SEQUENCE,'functions-entry.js'),'utf8'),original,'SOURCE_NOT_CHANGED_DURING_TEST');
const report={kind:'ACTUAL_FOUR_SOURCE_GENERATED_ENTRY_SYNTHETIC_PORT_COMPOSITION',passed:true,nodeVersion:process.version,generatedDefaultSha256:sha(original),closedDisabledEntrySha256:sha(entry),inMemorySyntheticEnabledEntrySha256:sha(bundle),originalHarnessSha256:sha(originalHarness),fixtureInputs:Object.fromEntries(Object.entries(fixturePaths).map(([k,p])=>[k,{path:p,sha256:sha(fs.readFileSync(p)),firstPublicLatestAcceptedNull:true,jobCount:fixtures[k].model.projections.length}])),hengruiManifest:{path:path.resolve(hengruiManifestPath),sha256:sha(fs.readFileSync(hengruiManifestPath))},ucbManifest:{path:path.resolve(ucbManifestPath),sha256:sha(fs.readFileSync(ucbManifestPath)),nativeReaderCases:ucbManifest.readerCases.map(c=>({name:c.name,passed:c.passed}))},coverageCount:reports.length,realToolsInvoked:0,realDatabaseCalls:0,realBrowserCalls:0,networkCalls:0,productionActivated:false,sourceBodiesCoresUiUnchanged:true,limitations:['External SQL, CLI, child terminal, UI, classification and durable receipts are synthetic; this is actual generated control-flow/authority composition, not production or original-process/filesystem acceptance.','First-public null contexts and UCB original-compiler GRACE context are fixtures. Due classification port is synthetic; native due boundaries remain separate.','Capability case uses a test-only lexical accessor to unchanged generated factories, with the coordinator omitted; remaining cases run the unchanged generated coordinator.'],scenarios:reports};
if(reportPath)fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({kind:report.kind,passed:true,coverageCount:reports.length,generatedDefaultSha256:report.generatedDefaultSha256,closedDisabledEntrySha256:report.closedDisabledEntrySha256,realDatabaseCalls:0,realBrowserCalls:0}));
