// This source is inserted in the SAME fixed functions closure as the shared
// cores and actual tool capture. Nothing below is exported or caller-configured.
const PRIVATE_LIVE_CORE_KEY=Symbol('FIXED_LIVE_CORE');
const liveLaunchPermits=new WeakMap(),livePublicationPermits=new WeakMap();
const ObserverCoreScope=new Function('PRIVATE_LIVE_CORE_KEY',OBSERVER_CORE_SOURCE)(PRIVATE_LIVE_CORE_KEY);
const PipeCoreScope=new Function('PRIVATE_LIVE_CORE_KEY',PIPE_CORE_SOURCE)(PRIVATE_LIVE_CORE_KEY);
function createLiveConsumer(permit){
 const grant=liveLaunchPermits.get(permit);liveLaunchPermits.delete(permit);
 check(grant&&grant.kind==='ACTUAL_FRESH_BOOTSTRAP_LAUNCH'&&grant.port?.kind==='CAPTURED_OFFICIAL_TOOL_PORT','PRIVATE_LAUNCH_PERMIT_REQUIRED');
 check(Date.now()>=grant.checkedAt&&Date.now()-grant.checkedAt<60000,'PRIVATE_LAUNCH_PERMIT_EXPIRED');
 // The closure-only port already captures the one fixed launch expectation,
 // original tools and round. No arguments can substitute any of them.
 return PipeCoreScope.core({launch:grant.seed,mode:'LIVE',clock:Date.now},{key:PRIVATE_LIVE_CORE_KEY,port:grant.port});
}
function createLiveObserver(permit){
 const grant=livePublicationPermits.get(permit);livePublicationPermits.delete(permit);
 check(grant&&grant.kind==='ACTUAL_CONSUMED_SAME_SESSION_REVIEW'&&grant.port?.kind==='CAPTURED_OFFICIAL_PORT','PRIVATE_PUBLICATION_PERMIT_REQUIRED');
 check(Number.isSafeInteger(grant.sessionId)&&grant.sessionId===grant.currentSession()&&Date.now()<grant.binding.dispatchBefore,'PRIVATE_PUBLICATION_SESSION_OR_EXPIRY');
 const r=grant.options.request;
 check(r.requestId===grant.binding.requestId&&r.requestSha256===grant.binding.requestSha256&&sha(r.payload.sql)===grant.binding.sqlSha256&&Date.parse(r.expiresAt)===grant.binding.expiresAt&&Date.parse(r.payload.dispatchBefore)===grant.binding.dispatchBefore,'PRIVATE_PUBLICATION_EXACT_REQUEST');
 return ObserverCoreScope.core({...grant.options,mode:'LIVE',testOnlyPort:undefined},{key:PRIVATE_LIVE_CORE_KEY,port:grant.port});
}
