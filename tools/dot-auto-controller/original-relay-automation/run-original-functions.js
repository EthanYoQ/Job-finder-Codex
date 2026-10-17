// Existing Functions runtime entry. Only the two already proven portable adapters are wired here.
const B='/workspace/scratch/5e9614251709',R=B+'/takeda-original-recovery-20261017T0417Z',D=B+'/original-relay-automation-20261017T0609Z',P=B+'/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller',V=P+'/vendor/c60-source',N=B+'/connector-host-runtime/node',relay=B+'/connector-host-task/relay';
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'",A=Object.getPrototypeOf(async function(){}).constructor;
async function command(cmd){let r=await tools.exec_command({cmd,max_output_tokens:200000}),output=r.output;while(r.session_id){r=await tools.write_stdin({session_id:r.session_id,chars:'',yield_time_ms:1000,max_output_tokens:200000});output+=r.output;}if(r.exit_code!==0)throw Error('LOCAL_STEP:'+output);return output;}
const read=p=>command('cat '+q(p)),save=async(p,x)=>{const r=await tools.apply_patch('*** Begin Patch\n*** Add File: '+p+'\n'+JSON.stringify(x).split('\n').map(s=>'+'+s).join('\n')+'\n*** End Patch');if(r?.isError)throw Error('SAVE_FAILED');};
function rows(raw){if(raw.isError)throw Error('OFFICIAL_SQL_FAILED');const t=raw.structuredContent?.result??JSON.parse(raw.content.find(x=>x.type==='text').text).result;return JSON.parse(t.match(/\n<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-/)[1]);}
const sql=async query=>rows(await tools.mcp__codex_apps__supabase_execute_sql({project_id:'yiopvxysxrtrnvqxwgbx',query}));
store('cloudPilotHostHelpers',await read(R+'/transport/adapted-host-helper-functions.js'));store('cloudPilotHostStages',await read(R+'/transport/original-host-stage-functions.js'));
const {runOriginalSerial}=await new A(await read(D+'/automatic-relay-functions.js'))();
const sourceFolders={'source-ucb-china-social':'ucb','source-viatris-social':'viatris'};
return await runOriginalSerial(Object.keys(sourceFolders),async sourceId=>{
 const [state]=await sql(`SELECT clock_timestamp() AS "checkedAt",(SELECT max(o."crawledAt") FROM public."CrawlObservation" o JOIN public."CrawlBatchSourceResult" r ON r.id=o."sourceResultId" JOIN public."CrawlBatch" b ON b.id=r."batchId" WHERE o."sourceId"='${sourceId}' AND o.successful AND r."atomicCommitState"='COMMITTED' AND b.status::text='SUCCESS') AS "crawledAt",(SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS holder,(SELECT count(*) FROM public."CrawlBatch" WHERE status::text='RUNNING') AS running,(SELECT count(*) FROM public."ManualCrawlRequest" WHERE status::text='RUNNING') AS manual;`);
 if(state.crawledAt&&Date.parse(state.checkedAt)-Date.parse(state.crawledAt)<43200000)return {skip:'REAL_OBSERVATION_WITHIN_12H:'+state.crawledAt};
 if(state.holder||Number(state.running)||Number(state.manual))throw Error('EXISTING_WRITER_RECONCILE_ONLY');
 const S=R+'/'+sourceFolders[sourceId],config=JSON.parse(await read(S+'/host-config.json')),control=JSON.parse(await read(S+'/control-base.json')),binding=JSON.parse(await read(S+'/binding-selector.json'));
 store('cloudPilotHostConfig',{mode:'NATIVE_PORTABLE_CONNECTOR_V1',bindingSha256:binding.sha256,root:V+'/ops/cloud-pilot-host',repo:V,project:'yiopvxysxrtrnvqxwgbx',sourceId});
 const stage=await new A(load('cloudPilotHostStages'))();await stage.h.binding(); // Existing identity validator rejects stale source/build bindings.
 const template=await read(R+'/transport/viatris-reader-before-original.sql');
 const query=template.replaceAll('source-viatris-social',sourceId).replaceAll('company-viatris',sourceId==='source-ucb-china-social'?'company-ucb-china':'company-viatris').replaceAll('5eab6bd8ba6973176376f492b9ce2105d81d8cae5afd4d3518daa6ad3dfcdad9',config.sourceConfigSha256).replaceAll('dot-cloud-native-c2b39d9-20261016',control.candidate.id);
 const before=(await sql(query))[0].reader_before;await save(S+'/READER_BEFORE.json',before);
 await command('python3 '+q(D+'/readback-original-web.py')+' '+q(S)+' '+q(sourceId==='source-ucb-china-social'?'company-ucb-china':'company-viatris'));
 const batchId='dot-auto-'+sourceFolders[sourceId]+'-'+new Date().toISOString().replace(/[-:.]/g,''),run=S+'/'+batchId;
 await command('mkdir -p '+q(run+'/artifacts'));
 const [fresh]=await sql(`SELECT clock_timestamp() AS "checkedAt",to_jsonb(r) AS candidate FROM public."ReleaseCandidate" r WHERE id='${control.candidate.id}';`);if(!fresh?.candidate)throw Error('CANDIDATE_MISSING');
 await save(run+'/bootstrap.json',{schemaVersion:1,checkedAt:new Date(fresh.checkedAt).toISOString(),candidateRows:[fresh.candidate],batchId});
 const digest=(await command('sha256sum '+q(run+'/bootstrap.json'))).split(' ')[0];
 const started=await tools.exec_command({cmd:'PYTHONDONTWRITEBYTECODE=1 TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 JOBFINDER_CLOUD_SOURCE_ID='+q(sourceId)+' python3 '+q(R+'/capture-simple-guard.py')+' -- '+q(N)+' '+q(V+'/scripts/run-with-http-diagnostics.mjs')+' '+q(run+'/diagnostics')+' 1800000 -- '+q(N)+' --import '+q(V+'/node_modules/tsx/dist/loader.mjs')+' '+q(V+'/scripts/p0-cloud-portable-source-pilot.ts')+' '+q(run+'/bootstrap.json')+' '+digest+' '+q(run+'/artifacts')+' '+q(relay)+' --db-started-control '+q(S+'/control-base.json'),yield_time_ms:1000,max_output_tokens:1000});
 let process=started;
 return {stage,sourceId,relayDirectory:relay,deadline:Date.now()+1800000,
  pollProducer:async()=>{if(process.session_id)process=await tools.write_stdin({session_id:process.session_id,chars:'',yield_time_ms:1000,max_output_tokens:1000});return {exitCode:process.exit_code??null};},
  reviewPublication:async request=>JSON.parse((await command('JOBFINDER_CLOUD_SOURCE_ID='+q(sourceId)+' '+q(N)+' --import '+q(V+'/node_modules/tsx/dist/loader.mjs')+' '+q(D+'/review-original-publication.mjs')+' '+q(run)+' '+q(request.requestId)+' '+q(relay))).trim().split('\n').at(-1)),
  readback:async()=>JSON.parse(await command('python3 '+q(D+'/readback-original-web.py')+' '+q(run)))};
});
