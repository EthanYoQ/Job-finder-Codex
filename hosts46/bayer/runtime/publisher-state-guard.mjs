import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const statePath='/workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/PUBLISHER-ACTIVE-STATE.json';
export function requirePublisherState(state,phase,batchId){
 if(!state||state.schemaVersion!==1||!Object.hasOwn(state,'active'))throw Error('PUBLISHER_STATE_INVALID');
 if(state.publicationPause?.noDatabasePublicationUntilBridgeTerminal===true)throw Error('PUBLICATION_PAUSED_UNTIL_BRIDGE_TERMINAL');
 if(state.runtimeCandidate?.id!=='dot-cloud-restored-fb0b8e3-20261005T2028Z'||state.runtimeCandidate.version!==46||state.runtimeCandidate.commit!=='fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d')throw Error('PUBLISHER_CANDIDATE_CHANGED');
 for(const [key,value] of Object.entries({sourceTreeSha256:'b4af8a7af51de16f466b63e15b2fb1d08bab03995af682fc4ae65930a830497e',runtimeTreeSha256:'fed1104297227bd870188af0b2e6fcf11c1d43f306df3feb8458fbfc13d2290f',adapterBundleSha256:'ec8d7e21f174ec4a36e4cca050bd4c2cee184d94d9f3e99029d70b43c4341d7d'}))if(state.runtimeCandidate[key]!==value)throw Error('PUBLISHER_CANDIDATE_CHANGED');
 if(!Array.isArray(state.pendingReadOnlyTerminalSources))throw Error('PUBLISHER_UNKNOWN_PROCESS_LIST_REQUIRED');
 if(state.pendingReadOnlyTerminalSources.some(x=>(x.sourceId==='source-bayer-healthcare-social'||x.sourceKey==='bayer')&&x.noRestartWithoutOriginalExitOrHostDestructionProof===true))throw Error('BAYER_ORIGINAL_PROCESS_UNRESOLVED');
 if(!['idle','publish'].includes(phase))throw Error('PUBLISHER_GUARD_PHASE');
 if(state.active!==null && !(phase==='publish'&&state.active.sourceId==='source-bayer-healthcare-social'&&state.active.batchId===batchId))throw Error('ANOTHER_PUBLISHER_ACTIVE');
 return {checkedAt:new Date().toISOString(),phase,batchId:batchId??null,publicationPaused:false,active:state.active,statePath};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [phase,batchId,...extra]=process.argv.slice(2);if(extra.length)throw Error('PUBLISHER_GUARD_ARGS');
 console.log(JSON.stringify(requirePublisherState(JSON.parse(await readFile(statePath)),phase,batchId)));
}
