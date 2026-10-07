// functions.exec AsyncFunction body. Required: sourceKey === 'gileadNext', ownerMode.
// publish: one new parent-reviewed original PUBLISH. resume: only after returned UNRESOLVED.
// A yielded/running cell continues with functions.wait; never duplicate its owner.
if(sourceKey!=='gileadNext'||!['publish','resume'].includes(ownerMode))throw Error('OWNER_ENTRY_ARGUMENT');
const ns='proxyNode22:gileadNext:',p=load(ns+'publishMonitorPrepared');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
if(p?.ownerSha256!=='b5d8e549f9165bd7122526c799cf8a2c6e4585104cb2078059586dc65113da70'||
 p.helperCode!==load(ns+'cloudPilotHostHelpers')||p.stageCode!==load(ns+'cloudPilotHostStages')||
 p.monitorCode!==load(ns+'continuousPortableRelayCodeWithPoll')||p.hostRoot!==load(ns+'cloudPilotHostConfig')?.root||
 !p.registeredBinding||!same(p.registeredBinding,load(ns+'registeredCandidateBinding'))||
 !same(p.hostConfig,load(ns+'cloudPilotHostConfig')))throw Error('OWNER_ENTRY_NOT_PINNED');
const A=Object.getPrototypeOf(async function(){}).constructor;
const stages=await new A(p.stageCode)();
const owner=await new A('env',p.ownerCode)({tools,load,store,notify,text});
const request=load(ns+'cloudPilotPublishRequest');
// Await the complete lifetime in THIS cell, without a reporting gap after PUBLISH.
await owner({sourceKey,stages,monitorCode:p.monitorCode,request,sql:request?.payload?.sql,mode:ownerMode});
