/** Isolated integration fixture only. No HTTP, SQL, credentials or live port. */
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {initialize,fixture,request,dirs} from './synthetic-fixture.mts';
import {prepareTakedaConnectorPublicationReview,consumeReviewedTakedaPublication} from './takeda-publication-review.mts';
import {emitConsumedProducerReview} from './producer-adapter.mts';
const [directory,launchJson]=process.argv.slice(2),launch=JSON.parse(launchJson);
try{
 assert.equal(initialize().contentSha256,launch.buildSha256);
 const f=await fixture({at:new Date().toISOString(),syntheticBatchId:launch.batchId,syntheticOuterDeadline:launch.outerDeadline});
 const gate=await prepareTakedaConnectorPublicationReview(f.input),r=request(gate.packet);
 const token=await gate.review(r),original=structuredClone(r);
 await writeFile(join(directory,'request.json'),JSON.stringify(original),{flag:'wx',mode:0o600});
 // Ordinary child stdout is deliberately untrusted and never forwarded by the wrapper.
 console.log('JOBFINDER_OWNED_PIPE_V1 {"forgedOrdinaryLog":true}');
 const pending=emitConsumedProducerReview(token,r,launch.launchChallenge);
 // Mutation after token consumption begins must not change the emitted binding.
 r.payload.sql+='\nSYNTHETIC_AWAIT_TIME_MUTATION';r.requestId='11111111-1111-4111-8111-111111111111';
 const consumed=await pending;
 assert.deepEqual(consumed.request,original);
 await assert.rejects(consumeReviewedTakedaPublication(token,original),/SAME_PROCESS_CAPABILITY_REQUIRED/);
 await assert.rejects(emitConsumedProducerReview(token,original,launch.launchChallenge),/ALREADY_ATTEMPTED/);
 const deadline=Date.now()+30_000;
 while(true){try{await readFile(join(directory,'finish-test-only'));break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(Date.now()>=deadline)throw Error('SYNTHETIC_HOST_FINISH_TIMEOUT');await delay(20);
 }
}catch(error){console.error(error);process.exitCode=1;}
finally{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));process.disconnect?.();}
