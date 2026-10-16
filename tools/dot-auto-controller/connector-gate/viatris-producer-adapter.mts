/** Intended install location beside the reviewed gate; never reads disk approval.
 * The fixed local candidate wires this file; LIVE use still requires exact
 * gate/runtime qualification and the original activation lifecycle. */
import {createHash} from 'node:crypto';
import {consumeReviewedViatrisPublication,type ConnectorPublishRequest} from './viatris-publication-review.mts';
import {gateMessage} from './viatris-pipe-protocol.mjs';
let used=false;
export async function emitConsumedViatrisProducerReview(token:object,request:ConnectorPublishRequest,launchChallenge:string){
 if(used)throw Error('PIPE_PRODUCER_ALREADY_ATTEMPTED');used=true;
 if(!process.send||!process.connected)throw Error('PIPE_OWNED_CHILD_CHANNEL_REQUIRED');
 const reviewed=await consumeReviewedViatrisPublication(token,request);
 const fixed=reviewed.request;
 const binding={projectId:fixed.payload.projectId,candidateId:reviewed.tuple.releaseCandidateId,
  sourceId:reviewed.tuple.sourceId,batchId:reviewed.tuple.batchId,sourceResultId:reviewed.tuple.sourceResultId,
  buildSha256:reviewed.buildContentSha256,launchChallenge,requestId:fixed.requestId,requestSha256:fixed.requestSha256,
  sqlSha256:createHash('sha256').update(fixed.payload.sql).digest('hex'),
  dispatchBefore:reviewed.dispatchBefore,expiresAt:reviewed.expiresAt,outerDeadline:reviewed.outerDeadline};
 await new Promise<void>((resolve,reject)=>process.send!(gateMessage(binding),error=>error?reject(error):resolve()));
 return reviewed;
}
