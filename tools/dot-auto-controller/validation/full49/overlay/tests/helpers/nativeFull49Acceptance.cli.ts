/** SINGLE native full49 acceptance entry. Does NOT import the reduced fixture.
 * One case per NEW database. No server/database creation and no automatic retries.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {NativeFull49Db} from './nativeFull49Db';
import {renderNativeRetirement} from './nativeFull49Prepare.cli';
import {compileV75FenceProfileGuard} from '../../src/db/v75FenceProfile';
export const FULL49_CASES=['publish_commit','publish_rollback','retire_commit','retire_rollback','deferred_commit_failure','lock_timeout','post_retire_trigger_atomicity'] as const;
type Case=typeof FULL49_CASES[number];
type Actor=Awaited<ReturnType<NativeFull49Db['openActor']>>;
type Outcome=Awaited<ReturnType<Actor['query']>>;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const stable=(x:unknown):string=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function success(o:Outcome){if(!o.ok)throw Error('ACTOR_UNEXPECTED_ERROR:'+o.code+':'+o.message);return o.results;}
function rows(o:Outcome){return success(o).flatMap(r=>r.rows) as Record<string,unknown>[];}
function committed(o:Outcome){const r=success(o);if(r.at(-1)?.command!=='COMMIT')throw Error('EXACT_COMMIT_ACK_REQUIRED');}
function expectedError(o:Outcome,code:string,message:string){if(o.ok||o.code!==code||o.message!==message)throw Error('EXACT_EXPECTED_ERROR_MISSING:'+message);}
function stripRetirement(sql:string){const begin='BEGIN ISOLATION LEVEL READ COMMITTED;\n';if(!sql.startsWith(begin)||!sql.endsWith('COMMIT;\n'))throw Error('RETIREMENT_ENVELOPE');return sql.slice(begin.length,-'COMMIT;\n'.length);}
const finishClock=async(a:Actor)=>String(rows(await a.query('SELECT clock_timestamp()::text AS finished'))[0]?.finished);
async function start(a:Actor){success(await a.query("BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL lock_timeout='1000ms'; SET LOCAL transaction_timeout='15000ms';"));const r=rows(await a.query('SELECT pg_backend_pid() AS pid,txid_current()::text AS txid,clock_timestamp()::text AS started'))[0];if(!r)throw Error('ACTOR_IDENTITY');return r;}
async function snapshot(db:NativeFull49Db,oldResult:string,newResult:string,newBatch:string){
 const tables=['CrawlBatch','CrawlBatchSourceResult','CrawlObservation','EvidenceArtifact','PaginationEvidence','LossLedgerEntry','TransportAttemptEvidence','LifecycleSetEvidenceMember'];
 const counts=tables.map(t=>`'${t}',(SELECT count(*)::int FROM public."${t}" r WHERE to_jsonb(r)->>'batchId'=$3 OR ('${t}'='CrawlBatch' AND to_jsonb(r)->>'id'=$3))`).join(',');
 const q=`SELECT json_build_object('observedAt',clock_timestamp(),'candidateStatus',(SELECT status FROM public."ReleaseCandidate" WHERE id='dot-cloud-native-d02f4f5-20261011'),
 'jobs',(SELECT coalesce(json_agg(to_jsonb(j) ORDER BY id),'[]') FROM public."Job" j),
 'oldSource',(SELECT to_jsonb(s) FROM public."CrawlBatchSourceResult" s WHERE id=$1),
 'oldObservations',(SELECT coalesce(json_agg(to_jsonb(o) ORDER BY id),'[]') FROM public."CrawlObservation" o WHERE "sourceResultId"=$1),
 'newSource',(SELECT to_jsonb(s) FROM public."CrawlBatchSourceResult" s WHERE id=$2),
 'newCounts',json_build_object(${counts}),
 'ledgerCount',(SELECT count(*)::int FROM public."_prisma_migrations"),
 'ledger',(SELECT json_agg(to_jsonb(m) ORDER BY migration_name) FROM public."_prisma_migrations" m),
 'lateCloneCount',(SELECT count(*)::int FROM public."CrawlBatchSourceResult" WHERE id='full49-late-clone'),
 'fenceFunction',to_regprocedure('public.guard_v75_retired_source_publication()') IS NOT NULL,
 'fenceTrigger',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public."CrawlBatchSourceResult"'::regclass AND tgname='CrawlBatchSourceResult_v75_retired_candidate_guard' AND tgenabled='O'),
 'formalHolder',(SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl')) AS state`;
 return (await db.query<{state:Record<string,unknown>}>(q,[oldResult,newResult,newBatch])).rows[0]!.state;
}
export function classifyFull49(e:Record<string,any>){
 if(e.mode!=='FULL49_NATIVE_REAL_PUBLISHER'||e.nativeReplay!==true||e.realBaselineCommitted!==true||e.productionQualified!==false)throw Error('FULL49_INPUT_PROOF_REQUIRED');
 if(!FULL49_CASES.includes(e.case))throw Error('CASE');
 const {AIdentity:a,BIdentity:b,edge,before,after}=e;
 if(!a||!b||a.pid===b.pid||a.txid===b.txid||!edge||edge.blockedPid!==b.pid||!edge.blockers.includes(a.pid)||!edge.aActive||!edge.bActive)throw Error('REAL_DISTINCT_BLOCKING_EDGE_REQUIRED');
 for(const t of [a.started,b.started,edge.observedAt,e.AFinished,e.BFinished,after.observedAt])if(!Number.isFinite(Date.parse(t)))throw Error('DATABASE_TIMES_REQUIRED');
 if(Date.parse(a.started)>Date.parse(edge.observedAt)||Date.parse(b.started)>Date.parse(edge.observedAt)||Date.parse(e.AFinished)<Date.parse(edge.observedAt)||Date.parse(e.BFinished)<Date.parse(edge.observedAt)||Date.parse(after.observedAt)<Math.max(Date.parse(e.AFinished),Date.parse(e.BFinished)))throw Error('DATABASE_INTERVALS_NOT_OVERLAPPING');
 const retired=!['retire_rollback','lock_timeout'].includes(e.case);
 const published=['publish_commit','retire_rollback'].includes(e.case);
 if(after.candidateStatus!==(retired?'INVALIDATED':'BUILDING')||after.ledgerCount!==(retired?50:49)||after.fenceFunction!==retired||after.fenceTrigger!==retired||after.formalHolder!=='')throw Error('FULL_RETIREMENT_STATE_MISMATCH');
 if(after.lateCloneCount!==0)throw Error('LATE_CLONE_NOT_ROLLED_BACK');
 const oldLedger=after.ledger.filter((r:Record<string,unknown>)=>r.migration_name!=='20261014141000_v75_retired_candidate_fence');
 if(stable(oldLedger)!==stable(before.ledger))throw Error('OLD_LEDGER_CHANGED');
 const added=after.ledger.filter((r:Record<string,unknown>)=>r.migration_name==='20261014141000_v75_retired_candidate_fence');
 if(retired){if(added.length!==1||added[0].checksum!=='b7c868b224ce1f13789f6f2cdcebafe95f1b2d83da1ac037d9a298cff79e3284'||!added[0].finished_at||added[0].rolled_back_at!==null)throw Error('SCHEMA50_LEDGER_MISMATCH');const log=JSON.parse(added[0].logs);if(log.synthetic!==true||log.appliedBy!=='native-full49-test-runner')throw Error('TEST_LEDGER_PROVENANCE');}
 else if(added.length)throw Error('RETIRED_LEDGER_LEFT_BEHIND');
 if(stable(after.oldSource)!==stable(before.oldSource)||stable(after.oldObservations)!==stable(before.oldObservations))throw Error('HISTORICAL_EVIDENCE_CHANGED');
 if(stable(after.jobs)!==stable(published?e.expectedPublishedJobs:before.jobs))throw Error('JOB_COMMIT_OR_ROLLBACK_MISMATCH');
 if(published){if(stable(after.newSource)!==stable(e.expectedPublishedSource))throw Error('EXACT_SOURCE_AFTER_COMMIT_MISMATCH');if(!after.newSource||after.newSource.atomicCommitState!=='COMMITTED'||after.newCounts.CrawlBatch!==1||after.newCounts.CrawlBatchSourceResult!==1||after.newCounts.CrawlObservation<1)throw Error('REAL_PUBLICATION_NOT_COMMITTED');}
 else if(after.newSource!==null||Object.values(after.newCounts).some(v=>v!==0))throw Error('ROLLED_BACK_PUBLICATION_LEFT_ROWS');
 if(retired&&e.fenceProfileVerified!==true)throw Error('FULL_FENCE_PROFILE_REQUIRED');
 if(e.case==='publish_commit'){committed(e.ARelease);success(e.BOperation);committed(e.BRelease);}
 if(e.case==='publish_rollback'){if(e.ARelease.results?.at(-1)?.command!=='ROLLBACK')throw Error('A_ROLLBACK_ACK');success(e.BOperation);committed(e.BRelease);}
 if(e.case==='deferred_commit_failure'){expectedError(e.ARelease,'P0001','JOB_DELTA_COMMIT_PROJECTION_MISMATCH');success(e.BOperation);committed(e.BRelease);}
 if(e.case==='retire_commit'){committed(e.ARelease);expectedError(e.BOperation,'P0001','PILOT_MIGRATION_HISTORY');}
 if(e.case==='retire_rollback'){expectedError(e.ARelease,'P0001','TEST_RETIREMENT_INJECTED_FAILURE');success(e.BOperation);committed(e.BRelease);}
 if(e.case==='lock_timeout'){expectedError(e.BOperation,'55P03','canceling statement due to lock timeout');if(e.ARelease.results?.at(-1)?.command!=='ROLLBACK')throw Error('A_ROLLBACK_ACK');}
 if(e.case==='post_retire_trigger_atomicity'){committed(e.ARelease);expectedError(e.BOperation,'P0001','V75_FENCE_CANDIDATE_RETIRED');}
 return {status:'PASS_FULL49_NATIVE_CASE',case:e.case,triggerCoverage:e.case==='post_retire_trigger_atomicity'?'FULL49_FENCE_TRIGGER_ATOMICITY':'REAL_PUBLISHER_OR_FULL_RETIREMENT',productionQualified:false};
}
export async function runFull49Case(db:NativeFull49Db,caseId:Case){
 const {createNativeFull49PublisherFixture}=await import('./nativeFull49PublisherFixture');
 const e:Record<string,any>={mode:'FULL49_NATIVE_REAL_PUBLISHER',database:db.database,case:caseId,nativeReplay:false,realBaselineCommitted:false,productionQualified:false,status:'UNKNOWN'};
 let a:Actor|undefined,b:Actor|undefined;
 try{
  await db.replay49();e.nativeReplay=true;
  const baseline=await createNativeFull49PublisherFixture(db);
  await db.execute(baseline.wrappedSql,'real-compiler-baseline-commit');
  const oldId=baseline.packet.commit.sourceResult.id;
  const baseRead=await db.query<{atomicCommitState:string}>('SELECT "atomicCommitState" FROM public."CrawlBatchSourceResult" WHERE id=$1',[oldId]);
  if(baseRead.rows[0]?.atomicCommitState!=='COMMITTED')throw Error('REAL_BASELINE_COMMIT_REQUIRED');e.realBaselineCommitted=true;
  const fixture=await createNativeFull49PublisherFixture(db),newId=fixture.packet.commit.sourceResult.id,newBatch=fixture.packet.commit.sourceResult.batchId;
  await fixture.recompile();
  const rendered=await renderNativeRetirement(db.inputRoot,fixture.root);
  const retirement=await readFile(join(rendered,'RETIREMENT_TRANSACTION.native-synthetic.sql'),'utf8'),retireBody=stripRetirement(retirement);
  e.publisherSqlSha256=sha(fixture.packet.sql);e.retirementSqlSha256=sha(retirement);e.expiresAt=fixture.packet.expiresAt;
  e.before=await snapshot(db,oldId,newId,newBatch);
  if((e.before.jobs as unknown[]).length!==1)throw Error('ONE_REAL_BASELINE_JOB_REQUIRED');
  if(Date.now()>=Date.parse(fixture.packet.expiresAt))throw Error('PUBLISHER_EXPIRED');
  a=await db.openActor('A');b=await db.openActor('B');e.AIdentity=await start(a);e.BIdentity=await start(b);
  const publishFirst=['publish_commit','publish_rollback','deferred_commit_failure'].includes(caseId);
  if(publishFirst){success(await a.query(fixture.packet.sql));e.expectedPublishedJobs=rows(await a.query('SELECT to_jsonb(j) AS row FROM public."Job" j ORDER BY id')).map(x=>x.row);e.expectedPublishedSource=rows(await a.query('SELECT to_jsonb(s) AS row FROM public."CrawlBatchSourceResult" s WHERE id=$1',[newId]))[0]?.row;}
  else if(caseId==='lock_timeout')success(await a.query('SELECT id FROM public."CrawlCoordinatorLock" WHERE id=\'formal-crawl\' FOR UPDATE'));
  else success(await a.query(retireBody));
  if(caseId==='deferred_commit_failure')success(await a.query('UPDATE public."Job" SET "officialTitle"=\'synthetic tamper after compiler before commit\''));
  let bSql=publishFirst||caseId==='lock_timeout'?retireBody:fixture.packet.sql;
  if(caseId==='post_retire_trigger_atomicity')bSql=`UPDATE public."Job" SET "officialTitle"='synthetic atomic late packet'; INSERT INTO public."CrawlBatchSourceResult" SELECT (jsonb_populate_record(NULL::public."CrawlBatchSourceResult",to_jsonb(s)||jsonb_build_object('id','full49-late-clone'))).* FROM public."CrawlBatchSourceResult" s WHERE id='${oldId.replaceAll("'","''")}';`;
  const pending=b.query(bSql); // retain/drain this original operation; never replay it
  const deadline=Date.now()+850;
  while(Date.now()<deadline){
   const q=await db.query<{edge:Record<string,unknown>}>(`SELECT json_build_object('blockedPid',$1::int,'blockers',pg_blocking_pids($1::int),'observedAt',clock_timestamp(),'aActive',EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$2::int AND xact_start IS NOT NULL),'bActive',EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1::int AND xact_start IS NOT NULL)) AS edge`,[e.BIdentity.pid,e.AIdentity.pid]);
   const edge=q.rows[0]?.edge;if(edge&&Array.isArray(edge.blockers)&&edge.blockers.includes(e.AIdentity.pid)){e.edge=edge;break;}
   await new Promise(r=>setTimeout(r,10));
  }
  if(!e.edge){e.BOperation=await pending;throw Error('NO_REAL_BLOCKING_EDGE_INCONCLUSIVE');}
  if(caseId==='lock_timeout'){e.BOperation=await pending;e.ARelease=await a.query('ROLLBACK');}
  else{
   e.ARelease=await a.query(caseId==='publish_rollback'?'ROLLBACK':caseId==='retire_rollback'?"DO $fault$ BEGIN RAISE EXCEPTION 'TEST_RETIREMENT_INJECTED_FAILURE'; END $fault$;":'COMMIT');
   if(!e.ARelease.ok){if(!['P0001','55P03'].includes(e.ARelease.code??''))throw Error('A_UNKNOWN_NO_RETRY');success(await a.query('ROLLBACK'));}
   e.BOperation=await pending;
  }
  e.AFinished=await finishClock(a);
  if(e.BOperation.ok){if(!publishFirst&&caseId!=='lock_timeout'){e.expectedPublishedJobs=rows(await b.query('SELECT to_jsonb(j) AS row FROM public."Job" j ORDER BY id')).map(x=>x.row);e.expectedPublishedSource=rows(await b.query('SELECT to_jsonb(s) AS row FROM public."CrawlBatchSourceResult" s WHERE id=$1',[newId]))[0]?.row;}e.BRelease=await b.query('COMMIT');success(e.BRelease);}
  else{if(!['P0001','55P03'].includes(e.BOperation.code??''))throw Error('B_UNKNOWN_NO_RETRY');success(await b.query('ROLLBACK'));}
  e.BFinished=await finishClock(b);
  e.after=await snapshot(db,oldId,newId,newBatch);
  if(e.after.fenceFunction){await db.execute('BEGIN TRANSACTION READ ONLY; DO $profile$ BEGIN '+compileV75FenceProfileGuard()+' END $profile$; COMMIT;','read-only-full-fence-profile');e.fenceProfileVerified=true;}
  e.classification=classifyFull49(e);e.status=e.classification.status;return e;
 }catch(error){e.error=String(error);throw error;}
 finally{await Promise.allSettled([a?.close(),b?.close()]);await writeFile(join(db.outputRoot,'FULL49_ACCEPTANCE_EVIDENCE.json'),JSON.stringify(e,null,2)+'\n',{flag:'wx',mode:0o600});}
}
export async function main(argv:string[]){
 if(argv.length!==6||argv[0]!=='--run-authorized-local-full49-acceptance')throw Error('Usage: --run-authorized-local-full49-acceptance SOCKET EMPTY_DB INPUT_ROOT NEW_OUTPUT_DIR CASE');
 const [,socket,database,inputRoot,outputRoot,caseId]=argv;if(!socket||!database||!inputRoot||!outputRoot||!FULL49_CASES.includes(caseId as Case))throw Error('ARGUMENTS');
 process.env.JOBFINDER_CLOUD_SOURCE_ID='source-hansoh-social';
 const db=await NativeFull49Db.open({socket,database,inputRoot,outputRoot,explicitLocalExecutionApproval:'RUN_NEW_EMPTY_LOCAL_TEST_DATABASE'});
 try{console.log(JSON.stringify((await runFull49Case(db,caseId as Case)).classification));}finally{await db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main(process.argv.slice(2));
