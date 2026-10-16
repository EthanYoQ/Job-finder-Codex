/** Read-only checks against original evidence and the owning worker's cutoffs.
 * Request timestamps and recompiled SQL cannot renew either authority. */
import {deriveDbStartedPublicationExpiry} from '../vendor/c60-source/src/db/ingestionRepository.ts';
import {PILOT_BUDGET} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
export interface TakedaPublicationWindow {outerDeadline:number;publicationDeadline:number}
export function verifyTakedaPublicationWindow(request:any,terminal:any,limits:TakedaPublicationWindow,now=Date.now()){
 const {outerDeadline,publicationDeadline}=limits;
 if(!Number.isSafeInteger(outerDeadline)||!Number.isSafeInteger(publicationDeadline)||publicationDeadline>outerDeadline-2*PILOT_BUDGET.controlMs)throw Error('TAKEDA_ORIGINAL_OUTER_DEADLINE_REQUIRED');
 const startedAt=new Date(terminal.startedAt),certificate=terminal.completenessCertificate?.legacyCertificate;
 if(!Number.isFinite(startedAt.getTime())||certificate?.schemaVersion!=='plan-bound-source-quality-v1')throw Error('TAKEDA_ORIGINAL_EVIDENCE_TIME_REQUIRED');
 const evidenceExpiry=deriveDbStartedPublicationExpiry({startedAt,completenessCertificate:certificate});
 const expiresAt=Date.parse(request.expiresAt),dispatchBefore=Date.parse(request.payload.dispatchBefore);
 if(!Number.isSafeInteger(expiresAt)||expiresAt>Math.min(evidenceExpiry,publicationDeadline))throw Error('TAKEDA_PUBLICATION_EXPIRY_EXTENDED');
 if(!Number.isSafeInteger(dispatchBefore)||dispatchBefore!==expiresAt-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs)throw Error('TAKEDA_ORIGINAL_DISPATCH_BUDGET_REQUIRED');
 if(!Number.isFinite(now)||now<startedAt.getTime()||now>=dispatchBefore||now>=expiresAt||now>=outerDeadline)throw Error('TAKEDA_ORIGINAL_PUBLICATION_WINDOW_EXPIRED');
 return {evidenceExpiry,publicationDeadline,outerDeadline,expiresAt,dispatchBefore};
}
