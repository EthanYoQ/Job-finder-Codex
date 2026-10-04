import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const statePath='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/PUBLISHER-ACTIVE-STATE.json';
export function requirePublisherState(state,phase,batchId){
 if(!state||state.schemaVersion!==1||!Object.hasOwn(state,'active'))throw Error('PUBLISHER_STATE_INVALID');
 if(state.publicationPause?.noDatabasePublicationUntilBridgeTerminal===true)throw Error('PUBLICATION_PAUSED_UNTIL_BRIDGE_TERMINAL');
 if(state.runtimeCandidate?.id!=='dot-cloud-restored-fb0b8e3-20261004'||state.runtimeCandidate.version!==42||state.runtimeCandidate.commit!=='fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d')throw Error('PUBLISHER_CANDIDATE_CHANGED');
 if(!['idle','publish'].includes(phase))throw Error('PUBLISHER_GUARD_PHASE');
 if(state.active!==null && !(phase==='publish'&&state.active.sourceId==='source-servier-china-social'&&state.active.batchId===batchId))throw Error('ANOTHER_PUBLISHER_ACTIVE');
 return {checkedAt:new Date().toISOString(),phase,batchId:batchId??null,publicationPaused:false,active:state.active,statePath};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [phase,batchId,...extra]=process.argv.slice(2);if(extra.length)throw Error('PUBLISHER_GUARD_ARGS');
 console.log(JSON.stringify(requirePublisherState(JSON.parse(await readFile(statePath)),phase,batchId)));
}
