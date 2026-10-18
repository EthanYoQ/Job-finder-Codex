import assert from 'node:assert/strict';

// Reconstruct retained attempts; only the archived successful response enters the
// original fetch. The original strict Novo reader owns retry order/time validation.
export async function restoreOriginalNovo(V:string,plan:any,archived:any[],bodies:Map<string,string>,capturedAt:string,requests:any[]){
 assert.equal(plan.source.id,'source-novo-nordisk-china-social');
 const {createOfficialJsonSourceFetch}=await import(V+'/src/crawler/officialJsonSourceFetch.ts');
 const {safeOfficialJsonEvidenceUrl}=await import(V+'/src/crawler/officialJsonEvidence.ts');
 const {novoNativeGatewayFailureArtifact,novoNativeGatewayRetryArtifact,novoNativeGatewayReplayFinalUrl}=await import(V+'/src/crawler/novoNativeGatewayRetry.ts');
 const {parseNovoTimeoutReceipt,novoNativeTimeoutArtifact,novoNativeTimeoutRetryArtifact}=await import(V+'/src/crawler/novoNativeTimeout.ts');
 const {parsePersistentSourceFetchEvidence}=await import(V+'/src/crawler/sourceFetchEvidence.ts');
 const prefixes=new Map<string,any[]>();let cursor=0,replayNow=Date.parse(capturedAt);
 const draft=(saved:any)=>{
  assert(saved,'NOVO_ARCHIVED_ATTEMPT_MISSING');
  const {id,releaseCandidateId,batchId,sourceId,sourceResultId,sha256,byteCount,path,captureToolName,captureToolVersion,...metadata}=saved;
  const body=bodies.get(path);assert.equal(typeof body,'string','NOVO_ARCHIVED_BODY_MISSING');
  return {id:saved.logicalKey,...metadata,body};
 };
 const replay=await createOfficialJsonSourceFetch({allowBrowserFallback:false,now:()=>new Date(replayNow),
  nativeHttpRetryDelay:async()=>{throw Error('NOVO_REPLAY_CANNOT_CREATE_RETRY');},http:async(req:any)=>{
   let saved=archived[cursor++];assert(saved,'NOVO_EXTRA_REQUEST');
   assert.equal(req.method,'GET');assert.equal(req.body,undefined);
   const match=/^(novo-(?:detail|application)-[1-9][0-9]{5}\.en_GB)-(http|request)-error-1$/.exec(saved.logicalKey);
   if(match){
    const key=match[1],application=key.startsWith('novo-application-'),failed=draft(saved),retry=draft(archived[cursor++]);
    let regeneratedFailure:any,regeneratedStart:any;
    if(match[2]==='http'){
     regeneratedFailure=novoNativeGatewayFailureArtifact({status:failed.httpStatus,body:failed.body,
      finalUrl:novoNativeGatewayReplayFinalUrl(failed.finalUrl,req.url,application),
      contentType:failed.contentType,capturedAt:failed.capturedAt},req.url,key);
     regeneratedStart=novoNativeGatewayRetryArtifact(JSON.parse(retry.body),failed,req.url,key,application);
    }else{
     const receipt=parseNovoTimeoutReceipt(JSON.parse(failed.body),req.url);
     regeneratedFailure=novoNativeTimeoutArtifact(receipt,req.url,key,1);
     regeneratedStart=novoNativeTimeoutRetryArtifact(JSON.parse(retry.body),receipt,req.url,key);
    }
    assert.deepEqual(failed,regeneratedFailure,'NOVO_EXACT_FAILURE_PROOF');
    assert.deepEqual(retry,regeneratedStart,'NOVO_EXACT_RETRY_START_PROOF');
    assert(!prefixes.has(key),'NOVO_DUPLICATE_RETRY_SLOT');prefixes.set(key,[regeneratedFailure,regeneratedStart]);
    requests.push({url:req.url,method:'GET',body:null,capturedAt:failed.capturedAt,...(match[2]==='http'?{httpStatus:failed.httpStatus}:{noResponse:true})});
    saved=archived[cursor++];assert(saved,'NOVO_ARCHIVED_SUCCESS_MISSING');assert.equal(saved.logicalKey,key,'NOVO_RETRY_SUCCESS_SLOT');
   }
   assert.equal(saved.httpStatus,200,'NOVO_ARCHIVED_SUCCESS_REQUIRED');
   assert.equal(safeOfficialJsonEvidenceUrl(req.url),saved.requestedUrl,'NOVO_ARCHIVED_REQUEST_IDENTITY');
   replayNow=Date.parse(saved.capturedAt);requests.push({url:req.url,method:'GET',body:null,capturedAt:saved.capturedAt});
   return {status:saved.httpStatus,body:bodies.get(saved.path),contentType:saved.contentType,capturedAt:saved.capturedAt,
    finalUrl:saved.logicalKey.startsWith('novo-application-')?saved.finalUrl:req.url};
  }})(plan);
 assert(replay.ok,replay.failureReason);assert.equal(cursor,archived.length,'NOVO_UNCONSUMED_ARCHIVED_ATTEMPT');
 assert(replay.fetchEvidence,'NOVO_REPLAY_EVIDENCE_REQUIRED');
 replay.fetchEvidence=parsePersistentSourceFetchEvidence({...replay.fetchEvidence,artifacts:replay.fetchEvidence.artifacts.flatMap((artifact:any)=>[
  ...(prefixes.get(artifact.logicalKey)??[]),artifact])});
 assert.deepEqual(replay.fetchEvidence.artifacts,archived.map(draft),'NOVO_EXACT_ARCHIVED_ARTIFACT_ORDER_AND_BYTES');
 return replay;
}
