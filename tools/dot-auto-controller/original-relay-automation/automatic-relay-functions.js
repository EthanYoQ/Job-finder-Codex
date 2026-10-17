// Functions runtime only. Existing source preparation owns fresh controls, locks and 12h dedup.
// shortcut: source launch/review/readback use existing callbacks; no standalone connector daemon.
async function runOriginalSerial(sources, prepareSource) {
 const results = [];
 for (const sourceId of sources) {
  let job;
  try {
   job = await prepareSource(sourceId);
   if (job.skip) { results.push({sourceId, status: 'SKIPPED', reason: job.skip}); continue; }
   results.push({sourceId, ...await serviceOriginalRelay(job)});
  } catch (error) {
   results.push({sourceId, status: 'HELD', reason: String(error)});
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
 let publication, outcomeSeen = false;
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
   if (request.kind === 'PUBLISH') {
    if (publication || prepared.status !== 'AWAITING_PARENT_REVIEW') throw Error('PUBLICATION_STATE');
    // Reuse the actual source's packet/raw/reader checks, without model intervention.
    const reviewed = await reviewPublication(request, prepared);
    if (reviewed?.requestId !== request.requestId || reviewed?.requestSha256 !== request.requestSha256)
     throw Error('REVIEW_REQUEST_MISMATCH');
    if (Date.now() >= Date.parse(request.payload.dispatchBefore) || Date.now() >= Date.parse(request.expiresAt))
     return {status: 'HELD', reason: 'PUBLICATION_EXPIRED', requestId: request.requestId};
    publication = await h.sqlDispatch(request, relayDirectory, request.payload.sql);
    if (publication?.outcome === 'UNKNOWN') return {status: 'HELD', reason: 'UNKNOWN_PUBLICATION', requestId: request.requestId};
   }
   if (request.kind === 'READ_OUTCOME') outcomeSeen = true;
  }
  // Poll the original process handle; no second launcher, PID discovery or supervisor.
  const producer = await pollProducer();
  if (producer.exitCode !== null) {
   if (producer.exitCode !== 0 || publication?.status !== 'SUCCEEDED' || !outcomeSeen)
    return {status: 'HELD', reason: 'PRODUCER_OR_OUTCOME_INCOMPLETE', exitCode: producer.exitCode, diagnostic:producer.diagnostic};
   return await readback();
  }
  if (!request) await new Promise(resolve => setTimeout(resolve, 1000));
 }
 return {status: 'HELD', reason: 'SOURCE_DEADLINE'};
}
return {runOriginalSerial, serviceOriginalRelay};
