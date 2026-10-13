/** Intended install location beside the reviewed gate; never reads disk approval.
 * This file is source-only until the exact gate and real runtime are qualified. */
import {createHash} from 'node:crypto';
import {consumeReviewedTakedaPublication,type ConnectorPublishRequest} from './takeda-publication-review.mts';
import {gateMessage} from './pipe-protocol.mjs';
let used=false;
export async function emitConsumedProducerReview(token:object,request:ConnectorPublishRequest,launchChallenge:string){
 if(used)throw Error('PIPE_PRODUCER_ALREADY_ATTEMPTED');used=true;
 if(!process.send||!process.connected)throw Error('PIPE_OWNED_CHILD_CHANNEL_REQUIRED');
 const reviewed=await consumeReviewedTakedaPublication(token,request);
 const fixed=reviewed.request;
 const binding={projectId:fixed.payload.projectId,candidateId:reviewed.tuple.releaseCandidateId,
  sourceId:reviewed.tuple.sourceId,batchId:reviewed.tuple.batchId,sourceResultId:reviewed.tuple.sourceResultId,
  buildSha256:reviewed.buildContentSha256,launchChallenge,requestId:fixed.requestId,requestSha256:fixed.requestSha256,
  sqlSha256:createHash('sha256').update(fixed.payload.sql).digest('hex'),
  dispatchBefore:reviewed.dispatchBefore,expiresAt:reviewed.expiresAt,outerDeadline:reviewed.outerDeadline};
 await new Promise<void>((resolve,reject)=>process.send!(gateMessage(binding),error=>error?reject(error):resolve()));
 return reviewed;
}
