// The only public entry. The source factories and their opaque close authorities
// remain private; source JSON/status never authorizes advancing this sequence.
let cycleInFlight=false;
const sequenceCheck=(ok,code)=>{if(!ok)throw Error(code);};
async function runLiveRound(){
 sequenceCheck(arguments.length===0,'SEQUENCE_ENTRY_NO_ARGUMENTS');
 if(!ACTIVATION.enabled)return {status:'DISABLED',reason:'CLOSED_RELEASE_NOT_ACTIVATED',realToolCalls:0,productionQualified:false};
 sequenceCheck(!cycleInFlight,'SEQUENCE_CYCLE_IN_FLIGHT');cycleInFlight=true;
 const cycle=Object.freeze({}),results=[];
 let closed=false;
 try{
  sequenceCheck(SEQUENCE_RELEASE&&typeof lifecycleScope!=='undefined'&&typeof lifecycleScope.assertOriginal==='function'&&typeof lifecycleScope.sourceStarted==='function'&&typeof lifecycleScope.sourceSettled==='function'&&typeof lifecycleScope.closeCycle==='function','SEQUENCE_ORIGINAL_LIFECYCLE_REQUIRED');
  lifecycleScope.assertOriginal();
  // Deliberately five compile-fixed steps. Never enumerate caller/config/env.
  for(const [name,create] of [['takeda',create_takeda],['biogen',create_biogen],['hengrui',create_hengrui],['ucb',create_ucb],['viatris',create_viatris]]){
   lifecycleScope.assertOriginal();
   const deployment=SEQUENCE_RELEASE.profiles[name];
   await lifecycleScope.sourceStarted(name,ACTIVATION.deploymentSha256);
   lifecycleScope.assertOriginal();
   const factory=create(cycle),original=factory.run();
   sequenceCheck(original instanceof Promise,'SEQUENCE_ORIGINAL_SOURCE_PROMISE');
   const result=await original;results.push({sourceId:deployment.sourceId,result});
   // This requires same in-memory result/cycle and consumes the one-shot key.
   let fact;
   try{fact=factory.consume(result,cycle);}catch(error){return {status:'GLOBAL_HOLD',releaseSha256:ACTIVATION.deploymentSha256,results,stoppedAt:deployment.sourceId,reason:'ORIGINAL_SOURCE_CLOSE_CAPABILITY_MISSING',productionQualified:false};}
   sequenceCheck(fact.sourceId===deployment.sourceId&&fact.releaseSha256===responseDigest(JSON.stringify(deployment)).sha256&&fact.seed?.candidateId===deployment.candidate.id&&fact.seed?.buildSha256===deployment.build.contentSha256,'SEQUENCE_SOURCE_CLOSE_BINDING');
   lifecycleScope.assertOriginal();
   // Durable acknowledgement is awaited before even constructing the next one.
   await lifecycleScope.sourceSettled(name,ACTIVATION.deploymentSha256,fact);
   lifecycleScope.assertOriginal();
  }
  const result=Object.freeze({status:'SEQUENCE_SAFELY_CLOSED',releaseSha256:ACTIVATION.deploymentSha256,results,productionQualified:false});
  lifecycleScope.closeCycle(result);closed=true;return result;
 }finally{
  // No pointer deletion, retry, deadline extension, or recovered capability.
  cycleInFlight=false;
 }
}
return Object.freeze({runLiveRound});
