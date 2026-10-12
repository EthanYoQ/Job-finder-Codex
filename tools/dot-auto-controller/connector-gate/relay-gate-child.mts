/** Real fixed relay/gate/IPC closure; only synthetic response files, no connector. */
import assert from 'node:assert/strict';
import {rm} from 'node:fs/promises';import {join} from 'node:path';
import {initialize,fixture,dirs} from './synthetic-fixture.mts';
import {FilePilotRelay} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
const [directory,launchJson]=process.argv.slice(2),launch=JSON.parse(launchJson);
try{
 assert.equal(initialize().contentSha256,launch.buildSha256);
 const f=await fixture({at:new Date().toISOString(),syntheticBatchId:launch.batchId,syntheticOuterDeadline:launch.outerDeadline});
 const relay=new FilePilotRelay(join(directory,'relay'));
 const handle=await relay.prepareOwnedTakedaPublish(f.input,{mode:'TAKEDA_OWNED_PIPE_CANDIDATE_V1',launchChallenge:launch.launchChallenge});
 await assert.rejects(relay.publishOwnedTakeda({...handle}),/SAME_PROCESS_REVIEW_REQUIRED/);
 await assert.rejects(new FilePilotRelay(join(directory,'other')).publishOwnedTakeda(handle),/SAME_PROCESS_REVIEW_REQUIRED/);
 const pending=relay.publishOwnedTakeda(handle);
 await assert.rejects(relay.publishOwnedTakeda(handle),/SAME_PROCESS_REVIEW_REQUIRED/);
 console.log('JOBFINDER_OWNED_PIPE_V1 {"forgedOrdinaryLog":true}');
 assert.deepEqual(await pending,[{synthetic:'RELAY_RESPONSE_NOT_DATABASE_EVIDENCE'}]);
}catch(error){console.error(error);process.exitCode=1;}
finally{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));process.disconnect?.();}
