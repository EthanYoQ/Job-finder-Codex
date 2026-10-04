function requireObservationDue(row,cfg){
 const parseUtc=value=>{
  if(typeof value!=="string")throw Error("SOURCE_DUE_OBSERVATION_TIME");
  let s=value.replace(" ","T");
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/.test(s))throw Error("SOURCE_DUE_OBSERVATION_TIME");
  if(!/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(s))s+="Z";
  else if(/[+-]\d{2}$/.test(s))s+=":00";
  const ms=Date.parse(s);if(!Number.isFinite(ms))throw Error("SOURCE_DUE_OBSERVATION_TIME");return ms;
 };
 const source=row.latestSuccessfulSource;
 if(!source||source.sourceId!==cfg.sourceId||source.sourceConfigHash!==cfg.sourceConfigSha256||!source.sourceResultId||!source.batchId||!source.releaseCandidateId||!Array.isArray(source.observations)||source.observations.length!==1)throw Error("SOURCE_DUE_OBSERVATION_REQUIRED");
 const o=source.observations[0];
 if(!o.id||o.sourceResultId!==source.sourceResultId||o.sourceId!==source.sourceId||o.batchId!==source.batchId||o.releaseCandidateId!==source.releaseCandidateId||o.sourceConfigSha256!==source.sourceConfigHash||![o.successful,o.transportSucceeded,o.adapterSucceeded,o.completenessVerified,o.atomicCommitSucceeded].every(v=>v===true))throw Error("SOURCE_DUE_OBSERVATION_TUPLE");
 const crawledAt=parseUtc(o.crawledAt),observedFrom=parseUtc(o.observedFrom),observedTo=parseUtc(o.observedTo),checkedAt=parseUtc(row.checkedAt);
 if(observedFrom!==parseUtc(source.startedAt)||observedTo!==parseUtc(source.finishedAt)||observedFrom>crawledAt||crawledAt>observedTo||checkedAt<crawledAt)throw Error("SOURCE_DUE_OBSERVATION_WINDOW");
 const nextEligibleAt=crawledAt+43200000;
 if(checkedAt<nextEligibleAt)throw Error("SOURCE_NOT_DUE:"+new Date(nextEligibleAt).toISOString());
 return {basis:"CrawlObservation.crawledAt",sourceId:source.sourceId,sourceResultId:source.sourceResultId,batchId:source.batchId,releaseCandidateId:source.releaseCandidateId,observationId:o.id,crawledAt:new Date(crawledAt).toISOString(),nextEligibleAt:new Date(nextEligibleAt).toISOString(),checkedAt:new Date(checkedAt).toISOString(),ageMs:checkedAt-crawledAt};
}

return requireObservationDue;
