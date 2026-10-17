// Functions runtime only. Existing source preparation owns fresh controls, locks and 12h dedup.
// shortcut: source launch/review/readback use existing callbacks; no standalone connector daemon.
async function runOriginalSerial(sources, prepareSource, afterSource) {
 const results = [];
 for (const sourceId of sources) {
  let job;
  try {
   job = await prepareSource(sourceId);
   if (job.skip) { results.push({sourceId, status: 'SKIPPED', reason: job.skip}); continue; }
   results.push({sourceId, ...await serviceOriginalRelay(job)});
  } catch (error) {
   results.push({sourceId, status: 'HELD', reason: String(error), ...(error?.producerStateUnconfirmed?{producerStateUnconfirmed:true}:{})});
  }
  if(typeof notify==='function')notify({sourceId,status:results.at(-1).status,reason:results.at(-1).reason});
  if (results.at(-1).producerStateUnconfirmed || ['UNKNOWN_PUBLICATION','EXPIRED_OR_UNKNOWN_DISPATCH','SOURCE_DEADLINE','PUBLICATION_EXPIRED'].includes(results.at(-1).reason)) break;
  if(afterSource && job){
   try { results.at(-1).jobVerification=await afterSource(sourceId,results.at(-1),job); }
   catch(error){results.at(-1).jobVerification={status:'HELD',reason:String(error)};break;}
   if(results.at(-1).jobVerification?.outcome==='UNKNOWN')break;
  }
 }
 return results;
}

async function serviceOriginalRelay(job) {
 const {stage, relayDirectory, sourceId, deadline, reviewPublication, readback, pollProducer} = job;
 const {h} = stage;
 if (h.cfg.project !== 'yiopvxysxrtrnvqxwgbx' || h.cfg.sourceId !== sourceId)
  throw Error('SOURCE_SCOPE_MISMATCH');
 if (!Number.isFinite(deadline) || deadline <= Date.now()) throw Error('SOURCE_DEADLINE');
 const handled = new Set();
 let publication, publicationRequestId, publicationContextRequestId, outcomeSeen = false, committedExact = false, producerTerminal = false;
 try {
 while (Date.now() < deadline) {
  const request = await h.next(relayDirectory);
  if (request) {
   // An uncertain dispatch belongs to reconciliation, never to the retry loop.
   if (request.expired || request.dispatchRecorded || handled.has(request.requestId))
    return {status: 'HELD', reason: 'EXPIRED_OR_UNKNOWN_DISPATCH', requestId: request.requestId};
   if (!['READ_CONTEXT', 'READ_PUBLICATION_CONTEXT', 'PUBLISH', 'READ_OUTCOME'].includes(request.kind))
    throw Error('UNSUPPORTED_RELAY_KIND');
   handled.add(request.requestId);
   const prepared = await stage.handle(request, relayDirectory);
   if (request.kind === 'READ_PUBLICATION_CONTEXT') publicationContextRequestId = prepared.status === 'SUCCEEDED' ? request.requestId : undefined;
   if (request.kind === 'PUBLISH') {
    if (publication || prepared.status !== 'AWAITING_PARENT_REVIEW') throw Error('PUBLICATION_STATE');
    // Reuse the actual source's packet/raw/reader checks, without model intervention.
    let reviewed;
    try { reviewed = await reviewPublication(request, prepared, publicationContextRequestId); }
    catch (error) {
     // Original relay outcome: this request has not reached sqlDispatch. Let the producer reconcile and exit.
     await h.respond(request, relayDirectory, {status:'FAILED', outcome:'NOT_DISPATCHED', code:'ORIGINAL_REVIEW_FAILED'});
     publication={status:'FAILED',outcome:'NOT_DISPATCHED',reviewFailure:String(error).slice(0,1800)};
     continue;
    }
    if (reviewed?.requestId !== request.requestId || reviewed?.requestSha256 !== request.requestSha256)
     throw Error('REVIEW_REQUEST_MISMATCH');
    if (Date.now() >= Date.parse(request.payload.dispatchBefore) || Date.now() >= Date.parse(request.expiresAt))
     return {status: 'HELD', reason: 'PUBLICATION_EXPIRED', requestId: request.requestId};
    publicationRequestId = request.requestId;
    publication = await h.sqlDispatch(request, relayDirectory, request.payload.sql);
    // UNKNOWN is never replayed; keep serving the original read-only outcome request.
   }
   if (request.kind === 'READ_OUTCOME') outcomeSeen = true;
  }
  // Poll the original process handle; no second launcher, PID discovery or supervisor.
  const producer = await pollProducer();
  if (producer.exitCode !== null) {
   producerTerminal = true;
   if (publication?.outcome === 'UNKNOWN' && !(outcomeSeen && producer.exitCode===0 && producer.outcomeState==='COMMITTED_EXACT')) return {status:'HELD',reason:'UNKNOWN_PUBLICATION',requestId:publicationRequestId,outcomeSeen,exitCode:producer.exitCode};
   if (producer.exitCode !== 0 || (publication?.status !== 'SUCCEEDED' && producer.outcomeState!=='COMMITTED_EXACT') || !outcomeSeen)
    return {status: 'HELD', reason: 'PRODUCER_OR_OUTCOME_INCOMPLETE', exitCode: producer.exitCode, diagnostic:publication?.reviewFailure??producer.diagnostic};
   committedExact = producer.outcomeState==='COMMITTED_EXACT';
   return await readback();
  }
  if (!request) await new Promise(resolve => setTimeout(resolve, 1000));
 }
 return {status: 'HELD', reason: publication?.outcome === 'UNKNOWN' ? 'UNKNOWN_PUBLICATION' : 'SOURCE_DEADLINE', requestId:publicationRequestId, outcomeSeen};
 } catch(error) {
  if(publicationRequestId&&!committedExact)return {status:'HELD',reason:'UNKNOWN_PUBLICATION',requestId:publicationRequestId,outcomeSeen,diagnostic:String(error)};
  if(!producerTerminal)error.producerStateUnconfirmed=true;
  throw error;
 }
}
return {runOriginalSerial, serviceOriginalRelay};
