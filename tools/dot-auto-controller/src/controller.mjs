import {withinDeadline} from './deadline.mjs';
import {randomUUID} from 'node:crypto';
import {canonical,sha} from './journal.mjs';
import {verifyScope,dueFromObservation,verifyPublicationEvidence,verifyOriginalTerminal,requireTime,equal} from './gates.mjs';
import {verifyCurrentPublic} from './public-verifier.mjs';
/** Coordination only: production ports must be wired to the pinned original
 * producer/compiler/reader. There is no SQL executor, credential reader or live
 * default. Its local source claim never substitutes for the native DB mutex.
 */
export class AutomaticController {
  constructor({registry,journal,ports,observer,now=Date.now}) {
    this.registry=structuredClone(registry);this.journal=journal;this.ports=ports;this.observer=observer;this.now=now;
    for(const method of ['readPreflight','captureAndPrepareNative','dispatch','readExactOutcome'])if(typeof ports?.[method]!=='function')throw Error('PRODUCTION_ADAPTER_NOT_CONNECTED:'+method);
    if(!observer?.observe||!observer?.accept)throw Error('ORIGINAL_EXEC_OBSERVER_REQUIRED');
  }
  async run(sourceKey) {
    const route=this.registry.sources[sourceKey];if(!route || !['PORTABLE','TRUE_A','TRUE_B'].includes(route.route))throw Error('FIXED_ROUTE_REQUIRED');
    if(route.enabled!==true)throw Error('SOURCE_NOT_ACTIVATED');
    const startedAt=this.now(),run={schemaVersion:1,batchId:`auto-${sourceKey}-${randomUUID()}`,sourceKey,sourceId:route.sourceId,startedAt,outerDeadline:startedAt+route.budgets.wrapperMs,routeIdentitySha256:sha(canonical(route))};
    if(route.budgets.wrapperMs!==1800000||route.budgets.sourceMs!==1200000||route.budgets.httpMs!==45000||route.budgets.heapMiB!==384)throw Error('NATIVE_RUNTIME_LIMITS_CHANGED');
    this.journal.put(run.batchId,'00-run',run);this.journal.claimSource(route.sourceId,run.batchId);
    let prepared,originalIdentity,terminalTask,terminalError;
    const startOriginalMonitor=identity=>{
      if(terminalTask)throw Error('ORIGINAL_EXEC_ALREADY_ATTACHED');
      originalIdentity=structuredClone(identity);this.journal.put(run.batchId,'20-original-exec',originalIdentity);
      // Attach before capture/publication and keep it independent of transport
      // waits. Expired transport or approval waits cannot prevent real polling.
      terminalTask=this.observer.observe(originalIdentity,{stopAt:run.outerDeadline}).then(token=>{
        const receipt=this.observer.accept(token,originalIdentity);this.journal.put(run.batchId,'60-original-terminal',receipt);return receipt;
      }).catch(e=>{terminalError=String(e);this.journal.put(run.batchId,'61-original-unresolved',{error:terminalError});return undefined;});
    };
    try {
      const snapshot=await withinDeadline(()=>this.ports.readPreflight(route),run.outerDeadline,{now:this.now});verifyScope(route,snapshot,this.now());
      const due=dueFromObservation(route,snapshot,this.now());this.journal.put(run.batchId,'10-preflight',{snapshot,due});
      if(!due.due){return this.journal.recordClosure(run.batchId,route.sourceId,{status:'NOT_DUE',releaseEligible:true,nextEligibleAt:due.nextEligibleAt});}
      prepared=await withinDeadline(()=>this.ports.captureAndPrepareNative({route:structuredClone(route),run:structuredClone(run),onOriginalExec:startOriginalMonitor}),run.outerDeadline,{now:this.now});
      if(!terminalTask||!originalIdentity)throw Error('ORIGINAL_EXEC_MONITOR_NOT_ATTACHED');
      prepared={ticket:prepared.ticket,request:structuredClone(prepared.request),proof:structuredClone(prepared.proof),exactReadbackBinding:structuredClone(prepared.exactReadbackBinding)};
      this.verifyPrepared(route,run,prepared);
      this.journal.put(run.batchId,'30-prepared',{request:prepared.request,proof:prepared.proof,exactReadbackBinding:prepared.exactReadbackBinding});
      const assertScope=()=>{this.verifyPrepared(route,run,prepared);if(sha(canonical(this.registry.sources[sourceKey]))!==run.routeIdentitySha256)throw Error('CONTROLLER_ROUTE_CHANGED');return true;};
      const verifyPublicationReady=async()=>{
        const fresh=await withinDeadline(()=>this.ports.readPreflight(route),run.outerDeadline,{now:this.now});verifyScope(route,fresh,this.now());
        const latest=dueFromObservation(route,fresh,this.now());if(!latest.due||latest.observationId!==due.observationId)throw Error('OBSERVATION_CHANGED_DURING_CAPTURE');
        verifyPublicationEvidence(route,run,prepared.proof,this.now());assertScope();return true;
      };
      // Persist intent BEFORE invoking any possibly-writing port. A filesystem
      // uncertainty keeps this record/source held and forces read-only recovery.
      this.journal.put(run.batchId,'40-dispatch-intent',{requestId:prepared.request.requestId,requestSha256:prepared.request.requestSha256,sqlSha256:sha(prepared.request.payload.sql),outcome:'UNKNOWN',retryAuthorized:false});
      let result;
      try {result=await this.ports.dispatch(prepared.ticket,{assertScope,verifyPublicationReady});}
      catch(error){result={status:'FAILED',outcome:'UNKNOWN',code:'TRANSPORT_EXCEPTION',error:String(error)};}
      this.journal.put(run.batchId,'50-transport',{result,responseExpired:this.now()>=requireTime(prepared.request.expiresAt,'REQUEST_EXPIRY'),receivedAt:this.now()});
      const terminal=await terminalTask;
      return await this.finishReadOnly(route,run,prepared,terminal,terminalError);
    }catch(error){
      // A failure before intent still does not prove what an original process
      // did. Keep the claim, original evidence and absolute budget for inspection.
      if(terminalTask)await terminalTask;
      this.journal.put(run.batchId,'85-exception',{error:String(error),recordedAt:this.now(),retryAuthorized:false});
      return {status:'HELD_EXCEPTION',batchId:run.batchId,error:String(error),retryAuthorized:false,releaseEligible:false};
    }
  }
  verifyPrepared(route,run,p) {
    const r=p.request,{requestSha256,...body}=r;
    if(r.schemaVersion!==1||r.kind!=='PUBLISH'||!r.requestId||requestSha256!==sha(JSON.stringify(body))||typeof r.payload?.sql!=='string'||r.payload.projectId!==route.projectId)throw Error('NATIVE_ORIGINAL_REQUEST_BINDING');
    const expiry=requireTime(r.expiresAt,'REQUEST_EXPIRY'),dispatchBefore=requireTime(r.payload.dispatchBefore,'REQUEST_DISPATCH_TIME');
    if(expiry>run.outerDeadline||dispatchBefore>=expiry||this.now()>=expiry||this.now()>=dispatchBefore)throw Error('ORIGINAL_REQUEST_EXPIRED_NO_REPLAY');
    const nativeExpiry=requireTime(p.proof.originalEvidenceExpiresAt,'ORIGINAL_PROOF_EXPIRY');if(expiry>nativeExpiry)throw Error('ORIGINAL_PROOF_DEADLINE_EXTENDED');
    if(p.exactReadbackBinding.batchId!==run.batchId||p.exactReadbackBinding.sourceId!==route.sourceId||p.exactReadbackBinding.requestSha256!==r.requestSha256)throw Error('EXACT_READBACK_BINDING');
    verifyPublicationEvidence(route,run,p.proof,this.now());
  }
  async finishReadOnly(route,run,p,terminal,terminalError) {
    let db;
    try {db=await this.ports.readExactOutcome(structuredClone(p.exactReadbackBinding));}
    catch(error){db={state:'UNKNOWN',error:String(error)};}
    const observationKey='62-db-outcome-'+randomUUID();this.journal.put(run.batchId,observationKey,{checkedAt:this.now(),result:db});
    const terminalCheck=terminal?verifyOriginalTerminal(this.journal.get(run.batchId,'20-original-exec'),terminal):null;
    if(db.state!=='COMMITTED_EXACT')return {status:'HELD_READONLY_RECONCILIATION',batchId:run.batchId,databaseState:db.state,originalExec:terminalCheck,terminalError,retryAuthorized:false,releaseEligible:false};
    equal(db.binding,p.exactReadbackBinding,'DB_EXACT_READBACK_IDENTITY');
    if(db.batchStatus!=='SUCCESS'||db.atomicCommittedCount!==1||db.completenessVerifiedCount!==1||db.originalHolderStillOwned!==false)throw Error('DB_EXACT_TERMINAL_REQUIRED');
    if(!terminalCheck?.successful)return {status:'HELD_ORIGINAL_EXEC',batchId:run.batchId,databaseState:'COMMITTED_EXACT',originalExec:terminalCheck,retryAuthorized:false,releaseEligible:false};
    if(typeof this.ports.readCurrentPublic!=='function')throw Error('PUBLIC_READER_NOT_CONNECTED');
    const proof=p.proof;
    const publicVerification=await verifyCurrentPublic({deployedIdentity:proof.readerReplay.deployedIdentity,projection:proof.readerReplay.main},this.ports.readCurrentPublic,{now:this.now});
    this.journal.put(run.batchId,'70-public-'+randomUUID(),publicVerification);
    const verification=verifyPublicationEvidence(route,run,proof,this.now());
    this.journal.put(run.batchId,'80-recovery-'+randomUUID(),{schemaVersion:1,verification,requestSha256:p.request.requestSha256,sqlSha256:sha(p.request.payload.sql),originalDeadline:run.outerDeadline});
    return this.journal.recordClosure(run.batchId,route.sourceId,{status:'VERIFIED_COMPLETE',batchId:run.batchId,releaseEligible:true,requestId:p.request.requestId,databaseState:db.state,publicVerification,retryAuthorized:false});
  }
  /** Restart entry has no route to capture, prepare, dispatch or mutate DB.
   * A genuine renewed poll token must be supplied; disk receipts are only audit.
   */
  async reconcile(batchId,terminalToken) {
    const run=this.journal.get(batchId,'00-run'),p=this.journal.get(batchId,'30-prepared');if(!run||!p)throw Error('ORIGINAL_RECOVERY_RECORD_REQUIRED');
    const route=this.registry.sources[run.sourceKey];if(sha(canonical(route))!==run.routeIdentitySha256)throw Error('RECOVERY_ROUTE_CHANGED');
    const identity=this.journal.get(batchId,'20-original-exec');
    const terminal=terminalToken?this.observer.accept(terminalToken,identity):null;
    return this.finishReadOnly(route,run,p,terminal,'Fresh actual original-exec poll required after restart');
  }
}
