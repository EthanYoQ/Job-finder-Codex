/** No renewal: derive all limits from original native evidence and owning run. */
import {deriveDbStartedPublicationExpiry} from '../vendor/c60-source/src/db/ingestionRepository.ts';
import {PILOT_BUDGET} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
export function assertHengruiPacketDeadline({terminal,legacyCertificate,request,originalOuterDeadline,now=Date.now()}:any){
 const startedAt=Date.parse(terminal.startedAt);if(!Number.isFinite(now)||!Number.isFinite(startedAt)||now<startedAt)throw Error('HENGRUI_ORIGINAL_EVIDENCE_TIME_REQUIRED');
 const expiry=Date.parse(request.expiresAt),dispatch=Date.parse(request.payload.dispatchBefore);
 const evidenceExpiry=deriveDbStartedPublicationExpiry({startedAt:new Date(terminal.startedAt),completenessCertificate:legacyCertificate});
 if(!Number.isSafeInteger(evidenceExpiry)||!Number.isSafeInteger(expiry)||expiry>evidenceExpiry)throw Error('HENGRUI_ORIGINAL_EVIDENCE_EXPIRY_EXTENDED');
 if(now>=evidenceExpiry)throw Error('HENGRUI_ORIGINAL_EVIDENCE_EXPIRED');
 if(!Number.isSafeInteger(originalOuterDeadline))throw Error('HENGRUI_ORIGINAL_OUTER_DEADLINE_REQUIRED');
 const originalPublicationDeadline=Math.min(evidenceExpiry,originalOuterDeadline-2*PILOT_BUDGET.controlMs);
 if(expiry!==originalPublicationDeadline)throw Error('HENGRUI_ORIGINAL_PUBLICATION_DEADLINE_CHANGED');
 if(dispatch!==expiry-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs)throw Error('HENGRUI_ORIGINAL_DISPATCH_MARGIN_CHANGED');
 if(now>=dispatch||now>=expiry||now>=originalOuterDeadline)throw Error('HENGRUI_ORIGINAL_DEADLINE_EXHAUSTED');
 return {evidenceExpiry,originalPublicationDeadline,dispatchBefore:dispatch,originalOuterDeadline};
}
