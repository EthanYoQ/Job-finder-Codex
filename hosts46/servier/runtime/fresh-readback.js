// functions.exec fragment. Read-only database/state gate, callable before capture and again at launch.
const A=Object.getPrototypeOf(async function(){}).constructor,h=await new A(load('restored46:servier:cloudPilotHostHelpers'))();
await h.cmd('node '+h.q(h.cfg.root+'/runtime/publisher-state-guard.mjs')+' idle',2000);
const expected=JSON.parse((await h.readFile(h.cfg.root+'/runtime/expected-database.json')).text);
const query=(await h.readFile(h.cfg.root+'/runtime/fresh-readback.sql')).text;
const raw=await tools.mcp__codex_apps__supabase_execute_sql({project_id:h.cfg.project,query}),rows=h.rows(raw);
if(rows.length!==1)throw Error('FRESH_READBACK_ROW_COUNT');
const row=rows[0],age=Date.now()-Date.parse(row.checkedAt);
if(!Number.isFinite(age)||age< -1000||age>60000)throw Error('FRESH_READBACK_TIME');
if(row.holderId!==''||!Array.isArray(row.sameSourceRunning))throw Error('FRESH_HOLDER_OR_SAME_SOURCE_OVERLAP');
if(row.candidateRows?.length!==1||Object.entries(expected.candidate).some(([k,v])=>row.candidateRows[0][k]!==v))throw Error('FRESH_CANDIDATE_PRECONDITION');
if(!Array.isArray(row.migrationRows)||row.migrationRows.length!==expected.migrations.length||new Set(row.migrationRows.map(m=>m.migrationName)).size!==expected.migrations.length||row.sourceResultGuardMd5!==expected.sourceResultGuardMd5)throw Error('FRESH_DB48_SCHEMA');
for(const m of expected.migrations){const found=row.migrationRows.find(r=>r.migrationName===m.migrationName);if(!found||found.checksum!==m.checksum||!found.finishedAt||found.rolledBackAt!==null)throw Error('FRESH_DB48_MIGRATION');}
const requireDue=await new A((await h.readFile(h.cfg.root+'/runtime/observation-due-gate.js')).text)();
const due=requireDue(row,h.cfg);
// BEGIN STRICT_HISTORICAL_OVERLAP_GATE
function classifySameSourceOverlap(row,cfg,currentCandidateId){
 const parseUtc=value=>{if(typeof value!=='string')return NaN;let s=value.replace(' ','T');if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/.test(s))return NaN;if(!/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(s))s+='Z';else if(/[+-]\d{2}$/.test(s))s+=':00';return Date.parse(s);};
 const success=row.latestSuccessfulSource,observation=success?.observations?.[0],checkedAt=parseUtc(row.checkedAt);
 const successTimes=[success?.startedAt,success?.finishedAt,observation?.observedFrom,observation?.observedTo,observation?.crawledAt].map(parseUtc);
 const ignoredHistoricalRows=[],blockingRows=[];
 if(row.holderId!==''||!Array.isArray(row.sameSourceRunning)||!Number.isFinite(checkedAt)||successTimes.some(t=>!Number.isFinite(t)))throw Error('FRESH_HOLDER_OR_SAME_SOURCE_OVERLAP');
 for(const original of row.sameSourceRunning){
  const reasons=[],batchStartedAt=parseUtc(original.batchStartedAt),sourceStartedAt=parseUtc(original.sourceStartedAt);
  // Explicitly reviewed legacy tuple only. This is not candidate invalidation.
  // Evidence: LEGACY_CANDIDATE_DATABASE_GUARDS_20261004T2048Z.json and current
  // frozen candidate/history/config/existing-batch/expiry guards, not 8b source.
  const exactLegacyFormalWriteIneligible=original.batchId==='75fcd504-ccd0-45b4-af2e-a2f81ca76fe1'&&original.sourceResultId==='75fcd504-ccd0-45b4-af2e-a2f81ca76fe1--source-servier-china-social'&&original.candidateId==='portable-8b86456-20261001'&&original.candidateStatus==='BUILDING'&&original.candidateVersion===1&&original.sourceConfigHash==='430a1d525d28c30eb8f42d2e5c8f4c421df37378cdcfed2f1b8a594a1f4c02d0'&&batchStartedAt===Date.parse('2026-10-01T14:52:58.369Z')&&sourceStartedAt===Date.parse('2026-10-01T14:52:58.369Z')&&original.candidateMigrationVersion==='20261001120000_portable_source_quality_policy'&&original.candidateSchemaHash==='a13b88e616c69495bb88a8a7cff17a229cd672a648d76c90ce2908de3dfbd282'&&original.atomicCommitState==='PENDING'&&row.sourceResultGuardMd5==='8fd00ed15932e3101eec3908ac3f33f3';
  if(original.sourceId!==cfg.sourceId||!original.sourceResultId||!original.batchId||!original.candidateId||original.batchCandidateId!==original.candidateId||original.batchStatus!=='RUNNING')reasons.push('HISTORICAL_TUPLE_UNPROVEN');
  if(original.candidateId===currentCandidateId)reasons.push('CURRENT_CANDIDATE');
  if(original.candidateStatus!=='INVALIDATED'&&!exactLegacyFormalWriteIneligible)reasons.push('CANDIDATE_NOT_INVALIDATED_OR_EXACT_REVIEWED_LEGACY');
  if(!/^[a-f0-9]{64}$/.test(original.sourceConfigHash??'')||original.sourceConfigHash===cfg.sourceConfigSha256)reasons.push('OTHER_SOURCE_CONFIG_UNPROVEN');
  if(!Number.isFinite(batchStartedAt)||!Number.isFinite(sourceStartedAt))reasons.push('START_TIME_UNKNOWN');
  else {
   if(![batchStartedAt,sourceStartedAt].every(t=>successTimes.every(successAt=>t<successAt)))reasons.push('NOT_SUPERSEDED_BY_LATER_EXACT_SUCCESS');
   if(![batchStartedAt,sourceStartedAt].every(t=>checkedAt-t>3600000))reasons.push('WITHIN_MAXIMUM_60_MINUTE_EVIDENCE_CLOCK');
  }
  const diagnostic={...original,classification:reasons.length?'BLOCKING_RUNNING_SOURCE':exactLegacyFormalWriteIneligible?'IGNORED_EXACT_LEGACY_TUPLE_NO_CURRENT_FORMAL_WRITE_AUTHORITY':'IGNORED_INVALIDATED_EXPIRED_SUPERSEDED_HISTORY',reasons:reasons.length?reasons:[exactLegacyFormalWriteIneligible?'EXACT_REVIEWED_LEGACY_CURRENT_FORMAL_WRITE_AUTHORITY_REJECTED':'CANDIDATE_INVALIDATED','MAXIMUM_EVIDENCE_CLOCK_EXPIRED','SUPERSEDED_BY_LATER_EXACT_SUCCESS'],...(exactLegacyFormalWriteIneligible?{legacyReviewEvidence:'LEGACY_CANDIDATE_DATABASE_GUARDS_20261004T2048Z.json',verifiedSourceResultGuardMd5:row.sourceResultGuardMd5}:{})};
  (reasons.length?blockingRows:ignoredHistoricalRows).push(diagnostic);
 }
 return {checkedAt:row.checkedAt,sourceId:cfg.sourceId,supersedingSourceResultId:success.sourceResultId,supersedingObservationId:observation.id,maximumEvidenceClockMs:3600000,ignoredHistoricalRows,blockingRows};
}
// END STRICT_HISTORICAL_OVERLAP_GATE
const overlap=classifySameSourceOverlap(row,h.cfg,expected.candidate.id);
store('restored46:servier:lastOverlapReadback',overlap);store('restored46:servier:lastFreshReadbackRaw',raw);
if(overlap.ignoredHistoricalRows.length||overlap.blockingRows.length)notify({phase:'SAME_SOURCE_OVERLAP_RECONCILIATION',...overlap});
if(overlap.blockingRows.length)throw Error('FRESH_HOLDER_OR_SAME_SOURCE_OVERLAP:'+overlap.blockingRows.length);
return {raw,row,due,overlap};
