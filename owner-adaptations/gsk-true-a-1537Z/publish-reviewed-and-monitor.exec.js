// functions.exec AsyncFunction body. Required parameters: sourceKey, ownerMode.
// ownerMode='publish' only for a new, parent-reviewed original PUBLISH request.
// ownerMode='resume' only after this owner's prior cell returned UNRESOLVED.
// A yielded/running cell must be continued with functions.wait, never duplicated.
if(typeof sourceKey !== 'string' || sourceKey.length > 64 || sourceKey !== sourceKey.trim() || !/^(?:[a-z][a-z0-9]*|boehringer-ingelheim)$/.test(sourceKey)||!['publish','resume'].includes(ownerMode))throw Error('OWNER_ENTRY_ARGUMENT');
const ns='proxyNode22:'+sourceKey+':',p=load(ns+'publishMonitorPrepared');
if(p?.ownerSha256!=='f50afb91e8006b14a1336e09fc917606d834220aec5e8980d9c71697ae8bf344'||
 p.helperCode!==load(ns+'cloudPilotHostHelpers')||p.stageCode!==load(ns+'cloudPilotHostStages')||
 p.monitorCode!==load(ns+'continuousPortableRelayCodeWithPoll')||p.hostRoot!==load(ns+'cloudPilotHostConfig')?.root)throw Error('OWNER_ENTRY_NOT_PINNED');
const A=Object.getPrototypeOf(async function(){}).constructor;
const stages=await new A(p.stageCode)();
const owner=await new A('env',p.ownerCode)({tools,load,store,notify,text});
const request=load(ns+'cloudPilotPublishRequest');
// The complete lifetime is awaited in THIS cell. No promise is dropped at return.
await owner({sourceKey,stages,monitorCode:p.monitorCode,request,sql:request?.payload?.sql,mode:ownerMode});
