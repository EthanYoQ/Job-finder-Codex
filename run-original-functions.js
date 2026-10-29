// Existing Functions runtime entry. Concrete source adapters reuse their original packet and raw-review functions.
const B='/workspace/scratch/5e9614251709',R=B+'/takeda-original-recovery-20261017T0417Z',D=B+'/original-relay-automation-20261017T0609Z',P=B+'/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller',V=P+'/vendor/c60-source',N=B+'/connector-host-runtime/node';
let roundId=load('originalRelayRoundId');
if(roundId!==undefined&&!/^round-[a-f0-9]{32}$/.test(roundId))throw Error('HOST_ROUND_SELECTOR');
const defaultRelay=B+'/connector-host-task/relay';
let relay=roundId?B+'/rounds/'+roundId+'/connector-host-task/relay':defaultRelay;
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'",A=Object.getPrototypeOf(async function(){}).constructor;
async function command(cmd){let r=await tools.exec_command({cmd,max_output_tokens:200000}),output=r.output;while(r.session_id){r=await tools.write_stdin({session_id:r.session_id,chars:'',yield_time_ms:1000,max_output_tokens:200000});output+=r.output;}if(r.exit_code!==0)throw Error('LOCAL_STEP:exit='+String(r.exit_code)+'; '+output);return output;}
const read=p=>command('cat '+q(p)),save=async(p,x)=>{const r=await tools.apply_patch('*** Begin Patch\n*** Add File: '+p+'\n'+JSON.stringify(x).split('\n').map(s=>'+'+s).join('\n')+'\n*** End Patch');if(r?.isError)throw Error('SAVE_FAILED');};
function rows(raw){if(raw.isError)throw Error('OFFICIAL_SQL_FAILED: '+(raw.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n')||JSON.stringify(raw.structuredContent??raw)));const t=raw.structuredContent?.result??JSON.parse(raw.content.find(x=>x.type==='text').text).result;return JSON.parse(t.match(/\n<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-/)[1]);}
const sql=async query=>rows(await tools.mcp__codex_apps__supabase_execute_sql({project_id:'yiopvxysxrtrnvqxwgbx',query}));
store('cloudPilotHostHelpers',await read(R+'/transport/adapted-host-helper-functions.js'));store('cloudPilotHostStages',await read(R+'/transport/original-host-stage-functions.js'));
const {runOriginalSerial}=await new A(await read(D+'/automatic-relay-functions.js'))();
let backupSuccessfulSource;
const sourceFolders={'source-bayer-healthcare-social':'bayer','source-servier-china-social':'servier','source-pfizer-china-social':'pfizer','source-ucb-china-social':'ucb','source-viatris-social':'viatris','source-biogen-china-social':'biogen','source-hengrui-social':'hengrui','source-hansoh-social':'hansoh','source-takeda-china-social':'takeda','source-merck-china-social':'merck','source-fosun-pharma-social':'fosun','source-cspc-social':'cspc','source-abbvie-china-social':'abbvie','source-bms-china-social':'bms','source-boehringer-ingelheim-china-social':'boehringer-ingelheim','source-gilead-china-social':'gilead','source-kelun-social':'kelun','source-novartis-social':'novartis','source-novo-nordisk-china-social':'novo-nordisk','source-organon-china-social':'organon','source-amgen-china-social':'amgen','source-cr-pharma-social':'cr-pharma','source-csl-china-social':'csl','source-cttq-social':'cttq','source-daiichi-sankyo-china-social':'daiichi-sankyo','source-gsk-china-social':'gsk','source-lilly-china-social':'lilly','source-msd-china-social':'msd','source-roche-china-social':'roche','source-sanofi-china-social':'sanofi','source-shanghai-pharma-social':'shanghai-pharma','source-qilu-social':'qilu','source-grifols-china-social':'grifols','source-astellas-china-social':'astellas','source-johnson-innovative-medicine-social':'jnj','source-astrazeneca-social':'astrazeneca'};
const routes=JSON.parse(await read(D+'/sources.json')).rows,routeById=Object.fromEntries(routes.map(row=>[row.sourceId,row]));
async function resumeTail(sourceId,run){
 const {resumeCommittedTail}=await new A(await read(D+'/committed-tail-functions.js'))();
 return resumeCommittedTail({
  verifyCommitted:async()=>{
   if(!run.startsWith(R+'/'+sourceFolders[sourceId]+'/dot-auto-')||run.includes('/../'))throw Error('RESUME_RUN_SCOPE');
   const checkpoint=JSON.parse(await read(run+'/relay-checkpoint.json'));
   const batchRelay=checkpoint.relayDirectory??defaultRelay;
   if(batchRelay!==defaultRelay&&!new RegExp('^'+B+'/rounds/round-[a-f0-9]{32}/connector-host-task/relay$').test(batchRelay))throw Error('RESUME_RELAY_SCOPE');
   if(checkpoint.sourceId!==sourceId||checkpoint.batchId!==run.split('/').at(-1))throw Error('RESUME_SOURCE_OR_BATCH');
   return JSON.parse(await command('python3 '+q(D+'/package-success-evidence.py')+' --verify-committed --run '+q(run)+' --relay '+q(batchRelay)+checkpoint.requestIds.map(id=>' --request-id '+q(id)).join('')));
  },
  readback:async()=>JSON.parse(await command('python3 '+q(D+'/readback-original-web.py')+' '+q(run))),
  verifyUploaded:async()=>{
   const uploaded=JSON.parse(await read(run+'/backup/UPLOADED.json'));
   const fetched=await tools.mcp__codex_apps__google_drive_fetch({url:'https://drive.google.com/file/d/'+uploaded.fileId+'/view',download_raw_file:true,include_base64:false});
   const downloadUrl=fetched.structuredContent?.file_uri?.download_url;if(fetched.isError||typeof downloadUrl!=='string')throw Error('DRIVE_READBACK_UNAVAILABLE');
   const downloaded=run+'/backup/remote-readback.tar.gz';
   const restored=JSON.parse(await command('python3 -c '+q("import shutil,urllib.request;\nwith urllib.request.urlopen("+JSON.stringify(downloadUrl)+") as response, open("+JSON.stringify(downloaded)+",'wb') as output: shutil.copyfileobj(response,output)")+' && python3 '+q(D+'/package-success-evidence.py')+' --verify '+q(downloaded)));
   const packed=JSON.parse(await read(run+'/backup/LOCAL_PACKAGE.json'));
   if(packed.sources?.length!==1||packed.sources[0].source!==run.split('/').at(-2)||packed.sources[0].batch!==run.split('/').at(-1))throw Error('BACKUP_BATCH_BINDING');
   if(restored.sha256!==uploaded.sha256||restored.sha256!==packed.sha256||restored.verifiedMembers!==packed.members)throw Error('DRIVE_READBACK_MISMATCH');
   const receipt={status:'REMOTE_RESTORE_VERIFIED',fileId:uploaded.fileId,...packed,verifiedAt:new Date().toISOString(),recoveredTail:true};
   await save(run+'/backup/REMOTE_BACKUP_READBACK.json',receipt);return receipt;
  }
 });
}
// Explicit completed-tail recovery returns here even across a schedule boundary.
// It cannot enter preparation, launch a producer, replay SQL, or upload.
const tail=load('originalCommittedTailResume');if(tail)return await resumeTail(tail.sourceId,tail.runDirectory);

const states=(await sql(`SELECT requested.id AS "sourceId",clock_timestamp() AS "checkedAt",(SELECT jsonb_build_object('crawledAt',o."crawledAt",'successfulBatchId',b.id) FROM public."CrawlObservation" o JOIN public."CrawlBatchSourceResult" r ON r.id=o."sourceResultId" JOIN public."CrawlBatch" b ON b.id=r."batchId" WHERE o."sourceId"=requested.id AND o.successful AND r."atomicCommitState"='COMMITTED' AND b.status::text='SUCCESS' ORDER BY o."crawledAt" DESC,b.id DESC LIMIT 1) AS "successfulObservation",(SELECT CASE WHEN "heartbeatAt">clock_timestamp()-interval '300 seconds' THEN "holderId" ELSE '' END FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS holder,(SELECT count(*) FROM public."CrawlBatch" WHERE status::text='RUNNING' AND "heartbeatAt">clock_timestamp()-interval '300 seconds') AS running,(SELECT count(*) FROM public."ManualCrawlRequest" WHERE status::text='RUNNING' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt">clock_timestamp())) AS manual FROM unnest(ARRAY[${routes.map(row=>"'"+row.sourceId.replaceAll("'","''")+"'").join(",")} ]::text[]) requested(id);`)).map(({successfulObservation,...state})=>({...state,...(successfulObservation??{})})),stateById=Object.fromEntries(states.map(row=>[row.sourceId,row]));
// Asia/Shanghai 08:00/20:00 are UTC 00:00/12:00; freeze this run's official-time slot.
const slotStartMs=Math.floor(Date.parse(states[0].checkedAt)/43200000)*43200000,slotEndMs=slotStartMs+43200000,slotStart=new Date(slotStartMs).toISOString(),slotEnd=new Date(slotEndMs).toISOString();
const succeededInSlot=s=>s.crawledAt&&Date.parse(s.crawledAt)>=slotStartMs&&Date.parse(s.crawledAt)<slotEndMs;
if(load('originalRelayReadOnly')===true)return states.map(s=>({sourceId:s.sourceId,checkedAt:s.checkedAt,crawledAt:s.crawledAt,status:succeededInSlot(s)?'SKIPPED_CURRENT_SLOT':'DUE_READ_ONLY'}));
// New runs own separate queues; an unresolved newer round must still be reconciled first.
roundId=(await command('python3 -c '+q("import pathlib,sys,hashlib,uuid\nroot=pathlib.Path(sys.argv[1]); default=root/'connector-host-task/relay'\nretired={'92ced010-7cbe-4891-bba4-53dfca11fb4c':'c55c6bdd34fb6f63e397fb2a0eb935be9e5bd59864aa526f838957c47a17f462','3f2add2e-1d37-4847-8ae5-49e86ba6985d':'2709f5467e9007d4eda5a73b37ebcf12ebb2e895fda18334f0bee5bd723b145e'}\npending=[]\nfor p in [*default.glob('*.request.ready'),*(root/'rounds').glob('round-*/connector-host-task/relay/*.request.ready')]:\n if p.with_name(p.name.replace('.request.ready','.response.json')).exists(): continue\n id=p.name.removesuffix('.request.ready'); request=p.with_name(id+'.request.json')\n if p.parent==default and id in retired and hashlib.sha256(request.read_bytes()).hexdigest()==retired[id]: continue\n pending.append(str(p))\nassert not pending,'PRIOR_ROUND_RECONCILE_ONLY:'+','.join(pending)\nprint(sys.argv[2] or 'round-'+uuid.uuid4().hex)")+' '+q(B)+' '+q(roundId??''))).trim();
relay=B+'/rounds/'+roundId+'/connector-host-task/relay';
await command('python3 -c '+q("import pathlib,sys; p=pathlib.Path(sys.argv[1]); [d.mkdir(mode=0o700,exist_ok=True) for d in [p.parents[2],p.parents[1],p.parent,p]]")+' '+q(relay));
return await runOriginalSerial(routes.map(row=>row.sourceId),async sourceId=>{
 const state=stateById[sourceId];
 if(Date.now()>=slotEndMs)throw Error('SCHEDULE_SLOT_ENDED:'+slotStart);
 if(succeededInSlot(state)){
  const pending=JSON.parse(await command('python3 -c '+q("import pathlib,json,sys; root=pathlib.Path(sys.argv[1]); batch=sys.argv[2]; assert batch.startswith('dot-auto-') and '/' not in batch and '..' not in batch; run=root/batch; print(json.dumps(str(run) if (run/'relay-checkpoint.json').exists() else None))")+' '+q(R+'/'+sourceFolders[sourceId])+' '+q(state.successfulBatchId)));
  const tailRecovery=pending?await resumeTail(sourceId,pending):undefined;
  return {skip:'REAL_OBSERVATION_IN_SCHEDULE_SLOT:'+slotStart+':'+state.crawledAt,...(tailRecovery?{tailRecovery}:{})};
 }
 const hold=sourceId==='source-cttq-social'?'UNRESOLVED_20261028_BATCH_READONLY':load('originalSourceHolds')?.[sourceId];if(hold)throw Error('PENDING_USER_DECISION:'+hold);
 
 if(!sourceFolders[sourceId])throw Error('ROUTE_NOT_CONNECTED:'+routeById[sourceId].route);
 if(state.holder||Number(state.running)||Number(state.manual))throw Error('EXISTING_WRITER_RECONCILE_ONLY');
 const active=await command("python3 -c "+q("import pathlib; print(any((p.read_bytes().split(b'\\0')[0].endswith(b'/node') and any(a.endswith(b'/run-with-http-diagnostics.mjs') or a.endswith(b'/p0-cloud-portable-source-pilot.ts') or a.endswith(b'/p0-cloud-source-pilot.ts') for a in p.read_bytes().split(b'\\0'))) for p in pathlib.Path('/proc').glob('[0-9]*/cmdline') if p.exists()))"));if(active.trim()==='True')throw Error('EXISTING_CLOUD_PRODUCER_RECONCILE_ONLY');
 const {config,control,binding}=JSON.parse(await command('python3 '+q(D+'/prepare-original-source.py')+' '+q(sourceId)+' '+q(sourceFolders[sourceId])));
 const S=R+'/'+sourceFolders[sourceId];
 store('cloudPilotHostConfig',{mode:config.mode,bindingSha256:binding.sha256,root:V+'/ops/cloud-pilot-host',repo:V,roundId,project:'yiopvxysxrtrnvqxwgbx',sourceId});
 const stage=await new A(load('cloudPilotHostStages'))();await stage.h.binding();if(await stage.h.next(relay))throw Error('EXISTING_RELAY_RECONCILE_ONLY'); // Existing identity validator rejects stale source/build bindings.
 const template=await read(R+'/transport/'+(sourceId==='source-sanofi-china-social'?'sanofi-reader-before-original.sql':'viatris-reader-before-original.sql'));
 const query=template.replaceAll('__ORIGINAL_CERTIFICATE_SCHEMA__',routeById[sourceId].route==='PORTABLE'?'plan-bound-source-quality-v1':routeById[sourceId].route==='TRUE_A'?'a-grade-official-total-v2':'b-grade-independent-traversal-v2').replaceAll('__ORIGINAL_REQUIRES_PORTABLE_POLICY__',String(routeById[sourceId].route==='PORTABLE')).replaceAll('source-viatris-social',sourceId).replaceAll('company-viatris',routeById[sourceId].companyId).replaceAll('5eab6bd8ba6973176376f492b9ce2105d81d8cae5afd4d3518daa6ad3dfcdad9',config.sourceConfigSha256).replaceAll('dot-cloud-native-c2b39d9-20261016',control.candidate.id).replaceAll('viatris-reader-before-v1',sourceFolders[sourceId]+'-reader-before-v1');
 let before;
 if(['source-servier-china-social','source-sanofi-china-social','source-bayer-healthcare-social','source-hengrui-social'].includes(sourceId)){
  const {readOriginalReaderBefore}=await new A(await read(D+'/reader-before-functions.js'))();
  before=await readOriginalReaderBefore(query,sql,['source-bayer-healthcare-social','source-hengrui-social'].includes(sourceId)?'15s':'8s');
 }else {const {readOriginalReaderBeforeSingle}=await new A(await read(D+'/reader-before-functions.js'))();before=await readOriginalReaderBeforeSingle(query,sql);}
 await save(S+'/READER_BEFORE.json',before);await save(S+'/expected-candidate.json',before.publicationContext.candidateRow);
 const batchId='dot-auto-'+sourceFolders[sourceId]+'-'+new Date().toISOString().replace(/[-:.]/g,''),run=S+'/'+batchId;
 await command('mkdir -p '+q(run+'/artifacts'));
 if(sourceId==='source-cspc-social'){
  const runStartedAt=new Date().toISOString(),directory=run+'/independent-dom';await command('mkdir -p '+q(directory));await save(run+'/run-start.json',{runStartedAt});
  const {captureCspcDomObservation}=await new A(await read(D+'/cspc-functions.js'))();
  await captureCspcDomObservation({directory,browserSource:await read(D+'/cspc-dom-runtime-functions.js')+'\n'+await read(D+'/cspc-browser-runtime.js'),runStartedAt,dispatchBefore:new Date(Date.now()+1800000).toISOString()});
 }
 if(sourceId==='source-boehringer-ingelheim-china-social'){
  const directory=run+'/independent-dom';await command('mkdir -p '+q(directory));
  const {captureBiDom}=await new A(await read(D+'/bi-functions.js'))();
  await captureBiDom({directory,deadline:Date.now()+1800000});
 }
 let independentValidation,currentCapture;
 if(sourceId==='source-johnson-innovative-medicine-social'){
  const directory=run+'/native-dom';await command('mkdir -p '+q(directory));
  const {captureJnjManagedDom}=await new A(await read(D+'/jnj-functions.js'))();
  await captureJnjManagedDom({directory,browserSource:await read(D+'/cspc-dom-runtime-functions.js')+'\n'+await read(D+'/jnj-browser-runtime.js'),deadline:Date.now()+1200000});
  const manifest=directory+'/manifest.json',manifestSha=(await command('sha256sum '+q(manifest))).split(' ')[0];
  const prepared=run+'/current-capture';await command(q(N)+' --import '+q(V+'/node_modules/tsx/dist/loader.mjs')+' '+q(V+'/scripts/prepare-jnj-dom-current-capture.ts')+' '+q(directory)+' '+q(manifestSha)+' '+q(prepared));
  const path=prepared+'/current-capture.json';currentCapture={path,sha256:(await command('sha256sum '+q(path))).split(' ')[0]};
 }
 if(sourceId==='source-sanofi-china-social'){
  const directory=run+'/independent-dom';await command('mkdir -p '+q(directory));
  const {captureSanofiDom}=await new A(await read(D+'/sanofi-functions.js'))();
  await captureSanofiDom({directory,browserSource:await read(D+'/sanofi-browser-runtime.js'),deadline:Date.now()+1200000});
  const validationDirectory=run+'/independent-validation';await command(q(N)+' --import '+q(V+'/node_modules/tsx/dist/loader.mjs')+' '+q(V+'/scripts/capture-sanofi-cn-b-source.ts')+' independent '+q(validationDirectory)+' '+q(directory+'/dom-capture.json'));
  const path=validationDirectory+'/independent-validation.json';independentValidation={path,sha256:(await command('sha256sum '+q(path))).split(' ')[0]};
 }
 if(['source-bayer-healthcare-social','source-servier-china-social'].includes(sourceId)){
  const source=sourceFolders[sourceId],directory=run+'/independent-dom';await command('mkdir -p '+q(directory));
  const {captureMokaBDom}=await new A(await read(D+'/moka-b-functions.js'))();
  await captureMokaBDom({source,directory,browserSource:await read(D+'/moka-b-browser-runtime.js'),deadline:Date.now()+1200000});
  const validationDirectory=run+'/independent-validation';await command(q(N)+' --import '+q(V+'/node_modules/tsx/dist/loader.mjs')+' '+q(V+'/scripts/capture-'+source+'-b-source.ts')+' independent '+q(validationDirectory)+' '+q(directory+'/dom-capture.json'));
  const path=validationDirectory+'/independent-validation.json';independentValidation={path,sha256:(await command('sha256sum '+q(path))).split(' ')[0]};
 }
 if(sourceId==='source-pfizer-china-social'){
  const directory=run+'/independent-dom';await command('mkdir -p '+q(directory));
  const {capturePfizerManagedDom}=await new A(await read(D+'/pfizer-functions.js'))();
  await capturePfizerManagedDom({directory,browserSource:await read(D+'/cspc-dom-runtime-functions.js')+'\n'+await read(D+'/pfizer-browser-runtime.js'),deadline:Date.now()+1200000});
  const validationDirectory=run+'/independent-validation';await command(q(N)+' --import '+q(V+'/node_modules/tsx/dist/loader.mjs')+' '+q(V+'/scripts/capture-pfizer-b-source.ts')+' dom '+q(validationDirectory)+' '+q(directory+'/managed-browser-capture.json'));
  const path=validationDirectory+'/independent-validation.json';independentValidation={path,sha256:(await command('sha256sum '+q(path))).split(' ')[0]};
 }
 const [fresh]=await sql(`SELECT clock_timestamp() AS "checkedAt",to_jsonb(r) AS candidate FROM public."ReleaseCandidate" r WHERE id='${control.candidate.id}';`);if(!fresh?.candidate)throw Error('CANDIDATE_MISSING');
 await save(run+'/bootstrap.json',{schemaVersion:1,checkedAt:new Date(fresh.checkedAt).toISOString(),candidateRows:[fresh.candidate],batchId,...(currentCapture?{currentCapture}:{}),...(independentValidation?{independentValidation}:{})});
 const digest=(await command('sha256sum '+q(run+'/bootstrap.json'))).split(' ')[0];
 let started;
 try{started=await tools.exec_command({cmd:'PYTHONDONTWRITEBYTECODE=1 TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 JOBFINDER_CLOUD_SOURCE_ID='+q(sourceId)+(roundId?' JOBFINDER_CONNECTOR_ROUND_ID='+q(roundId):'')+' python3 '+q(R+'/capture-simple-guard.py')+' -- '+q(N)+' '+q(V+'/scripts/run-with-http-diagnostics.mjs')+' '+q(run+'/diagnostics')+' 1800000 -- '+q(N)+' --import '+q(V+'/node_modules/tsx/dist/loader.mjs')+' '+q(V+'/scripts/'+(config.route==='PORTABLE'?'p0-cloud-portable-source-pilot.ts':'p0-cloud-source-pilot.ts'))+' '+q(run+'/bootstrap.json')+' '+digest+' '+q(run+'/artifacts')+' '+q(relay)+' --db-started-control '+q(S+'/control-base.json'),yield_time_ms:1000,max_output_tokens:1000});await save(run+'/producer-session.json',{sessionId:started.session_id??null,exitCode:started.exit_code??null,recordedAt:new Date().toISOString()});}
 catch(error){error.producerStateUnconfirmed=true;throw error;}
 let process=started, terminalRecorded=false;
 return {stage,sourceId,runDirectory:run,relayDirectory:relay,deadline:Date.now()+1800000,
  checkpoint:requestIds=>save(run+'/relay-checkpoint.json',{sourceId,batchId,requestIds,relayDirectory:relay}),
  pollProducer:async()=>{if(process.session_id)process=await tools.write_stdin({session_id:process.session_id,chars:'',yield_time_ms:1000,max_output_tokens:1000});let outcome=null;try{outcome=process.exit_code===0?JSON.parse(await read(run+'/artifacts/'+batchId+'.outcome.json')):null;}finally{if(process.exit_code!==undefined&&process.exit_code!==null&&!terminalRecorded){await save(run+'/producer-session.json',{sessionId:started.session_id??null,exitCode:process.exit_code,outcomeState:outcome?.state??null,recordedAt:new Date().toISOString()});terminalRecorded=true;}}return {exitCode:process.exit_code??null,outcomeState:outcome?.state,diagnostic:process.exit_code?process.output?.trim()||await command('python3 '+q(D+'/failure-summary.py')+' '+q(run)):process.output?.slice(-1200)};},
  reviewPublication:async (request,prepared,publicationContextRequestId)=>{const reviewed=JSON.parse((await command('JOBFINDER_CLOUD_SOURCE_ID='+q(sourceId)+' '+q(N)+' --import '+q(V+'/node_modules/tsx/dist/loader.mjs')+' '+q(D+'/review-original-publication.mjs')+' '+q(run)+' '+q(request.requestId)+' '+q(relay)+' '+q(publicationContextRequestId??'')+' > '+q(run+'/review-command.log')+' 2>&1; code=$?; printf \"%s\\n\" \"$code\" > '+q(run+'/review-command.exit')+'; cat '+q(run+'/review-command.log')+'; exit \"$code\"')).trim().split('\n').at(-1));
   const [recent]=await sql(`SELECT clock_timestamp()<'${slotEnd}'::timestamptz AS "sameSlot",EXISTS(SELECT 1 FROM public."CrawlObservation" o JOIN public."CrawlBatchSourceResult" r ON r.id=o."sourceResultId" JOIN public."CrawlBatch" b ON b.id=r."batchId" WHERE o."sourceId"='${sourceId}' AND o.successful AND r."atomicCommitState"='COMMITTED' AND b.status::text='SUCCESS' AND o."crawledAt">='${slotStart}'::timestamptz AND o."crawledAt"<'${slotEnd}'::timestamptz) AS fresh;`);if(!recent.sameSlot)throw Error('SCHEDULE_SLOT_ENDED:'+slotStart);if(recent.fresh)throw Error('NEW_SUCCESS_BEFORE_DISPATCH');
   let captureTimes={firstHttpObservedAt:null,lastHttpObservedAt:null}; try {captureTimes=JSON.parse(await command('python3 -c '+q("import json,pathlib,sys; p=pathlib.Path(sys.argv[1])/'diagnostics/http-requests.jsonl'; rows=[json.loads(s) for s in p.read_text().splitlines() if s.strip()] if p.exists() else []; times=[r['recordedAt'] for r in rows if r.get('event') in ['REQUEST_START','HEADERS_RECEIVED'] and r.get('recordedAt')]; print(json.dumps({'firstHttpObservedAt':min(times) if times else None,'lastHttpObservedAt':max(times) if times else None}))")+' '+q(run)));} catch(error) {captureTimes.captureNoticeError=String(error).slice(0,240);}
   if(typeof notify==='function')notify({sourceId,batchId,publicationRequestId:request.requestId,...captureTimes,dispatchBefore:request.payload.dispatchBefore,rawReviewMeaning:'Local revalidation of freshly captured responses from this same batch; not replay of a prior publication.'});
   return reviewed;},
  readback:async()=>JSON.parse(await command('python3 '+q(D+'/readback-original-web.py')+' '+q(run)))};
},async (sourceId,result,job)=>{
 if(result.status==='WEB_VERIFIED'||result.committedExact===true){
  const auditPath=job.runDirectory+'/review/NATIVE_RAW_REPLAY.json',sourceAudit=JSON.parse(await command('if test -f '+q(auditPath)+'; then cat '+q(auditPath)+"; else printf '{}'; fi")).sourceAudit;if(sourceAudit)result.sourceAudit=sourceAudit;
  if(result.status!=='WEB_VERIFIED')await save(job.runDirectory+'/WEB_READBACK_PENDING.json',{status:'WEB_PENDING',reason:result.reason,diagnostic:result.diagnostic});
  try{
   if(!backupSuccessfulSource)({backupSuccessfulSource}=await new A(await read(D+'/evidence-backup-functions.js'))());
   result.evidenceBackup=await backupSuccessfulSource({command,save,q,D,run:job.runDirectory,relay,requestIds:job.relayRequestIds});
  }catch(error){
   result.evidenceBackup={status:'PENDING',stage:'BACKUP_HELPER',reason:String(error).slice(0,300)};
   try{await save(job.runDirectory+'/EVIDENCE_BACKUP_PENDING.json',result.evidenceBackup);}catch{}
  }
 }
 if(sourceId!=='source-novo-nordisk-china-social')return undefined;
 const {verifyNovoPublishedJobs}=await new A(await read(D+'/novo-job-verification-functions.js'))();
 return verifyNovoPublishedJobs({command,read,save,q,N,V,P,D,R,rows,
  official:query=>tools.mcp__codex_apps__supabase_execute_sql({project_id:'yiopvxysxrtrnvqxwgbx',query})});
});
