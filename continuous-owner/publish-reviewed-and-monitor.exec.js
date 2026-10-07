// functions.exec AsyncFunction body. Required: sourceKey === 'kelunNext', ownerMode.
// publish: one new parent-reviewed original PUBLISH. resume: only after returned UNRESOLVED.
// A yielded/running cell continues with functions.wait; never duplicate its owner.
if(sourceKey!=='kelunNext'||!['publish','resume'].includes(ownerMode))throw Error('OWNER_ENTRY_ARGUMENT');
const ns='proxyNode22:kelunNext:',p=load(ns+'publishMonitorPrepared');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
if(p?.ownerSha256!=='98cf86837bc9280e2a2cc39df9e26fcf99fbc04feb526fc5f4b41e926db1759a'||
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
