
const A=Object.getPrototypeOf(async function(){}).constructor;
const h=await new A(load(ns+"cloudPilotHostHelpers"))();
const run=load(ns+"refreshCurrentRun"), batch=load(ns+"refreshCurrentBatch");
const review=load(ns+"publicationReview"), src=review.sourceResult;
const terminal=load(ns+"lastPortableExecPoll");
if(!terminal||terminal.exit_code!==0)throw Error("ACTUAL_ZERO_EXIT_REQUIRED");
const sql=`WITH latest AS (SELECT DISTINCT ON (s."sourceId") s."sourceId",s."dedupeOutputCount" FROM public."CrawlBatchSourceResult" s JOIN public."CrawlBatch" b ON b.id=s."batchId" WHERE s."releaseCandidateId"=${h.q(src.releaseCandidateId)} AND s."atomicCommitState"='COMMITTED' AND s."completenessState"='VERIFIED' AND b.status='SUCCESS' ORDER BY s."sourceId",s."finishedAt" DESC,s.id DESC)
SELECT clock_timestamp() AS "checkedAt",(SELECT to_jsonb(s) FROM public."CrawlBatchSourceResult" s WHERE id=${h.q(src.id)}) AS row,(SELECT to_jsonb(b) FROM public."CrawlBatch" b WHERE id=${h.q(batch)}) AS batch,(SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS "holderId",(SELECT jsonb_agg(to_jsonb(o)) FROM public."CrawlObservation" o WHERE o."sourceResultId"=${h.q(src.id)} AND o."batchId"=${h.q(batch)} AND o."sourceId"=${h.q(src.sourceId)} AND o."releaseCandidateId"=${h.q(src.releaseCandidateId)}) AS observations,(SELECT count(*) FROM latest) AS "successfulSourceCount",(SELECT sum("dedupeOutputCount") FROM latest) AS "successfulCurrentJobCount"`;
const raw=await tools.mcp__codex_apps__supabase_execute_sql({project_id:h.cfg.project,query:sql});
const rows=h.rows(raw), r=rows[0], s=r?.row,b=r?.batch;
if(rows.length!==1||!s||!b||s.id!==src.id||s.batchId!==batch||s.sourceId!==src.sourceId||s.releaseCandidateId!==src.releaseCandidateId||s.sourceConfigHash!==src.sourceConfigHash||s.atomicCommitState!=="COMMITTED"||s.completenessState!=="VERIFIED"||b.status!=="SUCCESS"||r.holderId!==""||s.canonicalCurrentJobSetSha256!==src.canonicalCurrentJobSetSha256||s.completenessCertificateSha256!==src.completenessCertificateSha256||s.dedupeOutputCount!==src.dedupeOutputCount)throw Error("EXACT_COMMIT_READBACK_FAILED");
if(r.observations?.length!==1)throw Error("EXACT_OBSERVATION_REQUIRED");
const o=r.observations[0];
if(![o.successful,o.transportSucceeded,o.adapterSucceeded,o.completenessVerified,o.atomicCommitSucceeded].every(x=>x===true))throw Error("OBSERVATION_FLAGS");
const summary={recordedAt:new Date().toISOString(),state:"COMMITTED_EXACT",candidateVersion:42,sourceId:s.sourceId,batchId:batch,sourceResultId:s.id,rawCount:s.rawCount,currentJobCount:s.dedupeOutputCount,sourceObservedFrom:s.startedAt,sourceObservedTo:s.finishedAt,batchFinishedAt:b.finishedAt,holderId:r.holderId,canonicalCurrentJobSetSha256:s.canonicalCurrentJobSetSha256,completenessCertificateSha256:s.completenessCertificateSha256,publicVerified:false,privateEvidenceRemoteSaved:false,observationId:o.id,crawledAt:o.crawledAt};
await h.save(run+"/FINALIZED_BATCH_AND_RELEASE.json",rows);
await h.save(run+"/POST_COMMIT_OBSERVATION.json",{checkedAt:r.checkedAt,observation:o});
await h.save(run+"/completion-summary.json",summary);
const statePath="/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/PUBLISHER-ACTIVE-STATE.json";
const data={summary,run,sourceCount:Number(r.successfulSourceCount),jobCount:Number(r.successfulCurrentJobCount)};
const code="import json,sys,datetime\nfrom pathlib import Path\np=Path(sys.argv[1]);d=json.loads(sys.argv[2]);s=json.loads(p.read_text());v=d['summary']\nactive=s.get('active') or {}\npending=s.get('pendingReadOnlyTerminalSources',[])\nassert active.get('batchId')==v['batchId'] or any(x.get('batchId')==v['batchId'] and x.get('noFurtherProductionWriteInOriginalProcess') is True for x in pending)\nif active.get('batchId')==v['batchId']:s['active']=None\ns['pendingReadOnlyTerminalSources']=[x for x in pending if x.get('batchId')!=v['batchId']]\ns['latestCompletedContinuation']=v;s['updatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()\ns['runtimeCandidate']['successfulSourceCount']=d['sourceCount'];s['runtimeCandidate']['successfulCurrentJobCount']=d['jobCount']\na=s.setdefault('privateEvidencePendingSuccessfulBatches',[])\nif not any(x.get('batchId')==v['batchId'] for x in a):a.append(dict(v,run=d['run']))\np.write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\\n')\n";
await h.cmd("python3 -c "+h.q(code)+" "+h.q(statePath)+" "+h.q(JSON.stringify(data)),1200);
text({...summary,successfulSourceCount:r.successfulSourceCount,successfulCurrentJobCount:r.successfulCurrentJobCount});
