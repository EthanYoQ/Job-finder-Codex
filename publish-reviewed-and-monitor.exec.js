// functions.exec AsyncFunction body. Required parameters: sourceKey, ownerMode.
// ownerMode='publish' only for a new, parent-reviewed original PUBLISH request.
// ownerMode='resume' only after this owner's prior cell returned UNRESOLVED.
// A yielded/running cell must be continued with functions.wait, never duplicated.
if(typeof sourceKey !== 'string' || sourceKey.length > 64 || sourceKey !== sourceKey.trim() || !/^(?:[a-z][a-z0-9]*|boehringer-ingelheim)$/.test(sourceKey)||!['publish','resume'].includes(ownerMode))throw Error('OWNER_ENTRY_ARGUMENT');
const ns='proxyNode22:'+sourceKey+':',p=load(ns+'publishMonitorPrepared');
if(p?.ownerSha256!=='78a716a79d905dc7bb02715967c43b74566d496bea5b6c24a2d6139dbb1f1894'||
 p.helperCode!==load(ns+'cloudPilotHostHelpers')||p.stageCode!==load(ns+'cloudPilotHostStages')||
 p.monitorCode!==load(ns+'continuousPortableRelayCodeWithPoll')||p.hostRoot!==load(ns+'cloudPilotHostConfig')?.root)throw Error('OWNER_ENTRY_NOT_PINNED');
const A=Object.getPrototypeOf(async function(){}).constructor;
const stages=await new A(p.stageCode)();
const owner=await new A('env',p.ownerCode)({tools,load,store,notify,text});
const request=load(ns+'cloudPilotPublishRequest');
// The complete lifetime is awaited in THIS cell. No promise is dropped at return.
await owner({sourceKey,stages,monitorCode:p.monitorCode,request,sql:request?.payload?.sql,mode:ownerMode});
