import { createHash } from "node:crypto";
import { JNJ_DOM_CAPTURE_TOOL, JNJ_DOM_COMPANY, JNJ_DOM_CONFIG_SHA256, JNJ_DOM_DETAIL_LOCATOR, JNJ_DOM_LIST_LOCATOR, JNJ_DOM_SOURCE } from "../crawler/jnjCareersDomContract";
import { verifyAGradeCompletenessCertificateReceipt } from "../crawler/completenessCertificate";
import type { AtomicEvidenceArtifactInput, AtomicSourceEvidenceCommit } from "./ingestionRepository";

/** Metadata admission follows the source's strict raw DOM replay. This cannot
 * promote a generic command output or a different company into official proof. */
export function hasBoundJnjDomOfficialArtifact(input: AtomicSourceEvidenceCommit, official: AtomicEvidenceArtifactInput): boolean {
  try {
    const r = input.sourceResult, p = input.observationProvenance, total = r.expectedJobCount, quarantined = input.lossLedger.length;
    if (r.sourceId !== JNJ_DOM_SOURCE || r.sourceConfigHash !== JNJ_DOM_CONFIG_SHA256 || r.atomicCommitState !== "COMMITTED" ||
        r.completenessState !== "VERIFIED" || r.expectedEvidenceKind !== "OFFICIAL_TOTAL_COUNT" || total === null || total <= 0 || total > 400 ||
        r.completenessCertificateSha256 === null || !r.finishedAt || official.logicalKey !== "jnj-dom-list-0000" ||
        official.extractorLocator !== JNJ_DOM_LIST_LOCATOR || input.priorTransportAttempts.length ||
        [r.parseDiscardCount,r.normalizationDiscardCount,r.dedupeDiscardCount,r.collisionCount].some(v => v !== 0) ||
        r.validationDiscardCount !== quarantined || r.discardCount !== quarantined ||
        [r.rawCount,r.parsedCount].some(v => v !== total) ||
        [r.validCount,r.normalizedCount,r.dedupeInputCount,r.dedupeOutputCount].some(v => v !== total-quarantined)) return false;
    verifyAGradeCompletenessCertificateReceipt({ certificate: r.completenessCertificate, certificateSha256: r.completenessCertificateSha256,
      expected: { releaseCandidateId:r.releaseCandidateId,batchId:r.batchId,sourceResultId:r.id,sourceId:JNJ_DOM_SOURCE,companyId:JNJ_DOM_COMPANY,
        sourceConfigSha256:JNJ_DOM_CONFIG_SHA256,surfaceIds:r.officialSurfaceIds,channelIds:r.officialChannelIds,
        officialArtifactLogicalKey:official.logicalKey,officialArtifactSha256:official.sha256,
        canonicalJobSetSha256:p.canonicalOutputSha256,adapterReconciliationSha256:r.adapterReconciliationSha256!,collisionLedgerSha256:r.collisionLedgerSha256! } });
    const ledger = (r.completenessCertificate as {jobQuarantineLedger?:Array<{rawLocatorSha256:string;pageSequence:number;recordIndex:number}>}).jobQuarantineLedger ?? [];
    if (ledger.length !== quarantined || input.lossLedger.some(loss => {
      const detail = loss.details as {code?:unknown;pageSequence?:unknown;recordIndex?:unknown}|null;
      return loss.stage !== "VALIDATION" || detail?.code !== "JOB_QUARANTINED" || !ledger.some(row =>
        row.rawLocatorSha256 === createHash("sha256").update(loss.rawLocator).digest("hex") &&
        row.pageSequence === detail.pageSequence && row.recordIndex === detail.recordIndex);
    })) return false;
    // A hashes the evaluated persistence trace; the observation separately
    // commits the raw-ID trace. Do not conflate these existing representations.
    const trace = input.pagination.map(page => ({ artifactLogicalKey:page.artifactLogicalKey,sequence:page.sequence,
      channelId:page.channelId??null,requestedCursor:page.requestedCursor??null,returnedCursor:page.returnedCursor??null,
      requestedOffset:page.requestedOffset??null,returnedOffset:page.returnedOffset??null,
      requestedPage:page.requestedPage??null,returnedPage:page.returnedPage??null,
      requestedPageSize:page.requestedPageSize??null,returnedPageSize:page.returnedPageSize??null,
      responseFingerprintSha256:page.responseFingerprintSha256,rawJobIdSetSha256:page.rawJobIdSetSha256,
      validJobIdSetSha256:page.validJobIdSetSha256,declaredTotal:page.declaredTotal??null,declaredCount:page.declaredCount??null,
      declaredPages:page.declaredPages??null,nextPageSignalBefore:page.nextPageSignalBefore??null,
      nextPageSignalAfter:page.nextPageSignalAfter??null,termination:page.termination,anomalyCodes:page.anomalyCodes,
      capturedAt:page.capturedAt.toISOString() }));
    const certificate = r.completenessCertificate as {pagination?:{paginationTraceSha256?:string};observedAt?:string};
    if (certificate.pagination?.paginationTraceSha256 !== createHash("sha256").update(JSON.stringify(trace)).digest("hex") ||
        certificate.observedAt !== official.capturedAt.toISOString()) return false;
    const details = input.artifacts.filter(a => /^jnj-dom-detail-(?:r-\d+|unidentified-\d+-\d+)$/u.test(a.logicalKey));
    if (details.length < total-quarantined || details.length > total || input.pagination.length !== Math.ceil(total / 20) || input.artifacts.length !== details.length + input.pagination.length) return false;
    for (const a of input.artifacts) {
      if (a.kind !== "COMMAND_OUTPUT" || a.captureToolName !== JNJ_DOM_CAPTURE_TOOL.name || a.captureToolVersion !== JNJ_DOM_CAPTURE_TOOL.version ||
          [a.requestedUrl,a.finalUrl,a.httpStatus,a.contentType,a.channelId].some(v => v != null) || a.redactionCommitmentSha256 !== a.sha256 ||
          a.capturedAt < r.startedAt || a.capturedAt > r.finishedAt ||
          a.extractorLocator !== (/^jnj-dom-detail-(?:r-\d+|unidentified-\d+-\d+)$/u.test(a.logicalKey) ? JNJ_DOM_DETAIL_LOCATOR : JNJ_DOM_LIST_LOCATOR)) return false;
    }
    for (let i=0;i<input.pagination.length;i++) {
      const page=input.pagination[i]!,key=`jnj-dom-list-${String(i).padStart(4,"0")}`,a=input.artifacts.find(a=>a.logicalKey===key);
      if (!a || page.artifactLogicalKey!==key || page.sequence!==i || page.requestedPage!==i+1 || page.returnedPage!==i+1 ||
          page.requestedOffset!==i*20 || page.returnedOffset!==i*20 || page.requestedPageSize!==20 || page.returnedPageSize!==20 ||
          page.declaredTotal!==total || page.declaredCount!==total || page.declaredPages!==input.pagination.length ||
          page.responseFingerprintSha256!==a.sha256 || page.capturedAt.getTime()!==a.capturedAt.getTime() || page.anomalyCodes.length ||
          page.termination!==(i+1===input.pagination.length?"DECLARED_TOTAL_REACHED":"CONTINUE") ||
          [page.requestedCursor,page.returnedCursor,page.channelId].some(v=>v!=null) ||
          (page.nextPageSignalBefore??null)!==(i===0?null:`https://www.careers.jnj.com/en/jobs/?page=${i+1}&country=China&origin=global#results`) ||
          (page.nextPageSignalAfter??null)!==(i+1===input.pagination.length?null:`https://www.careers.jnj.com/en/jobs/?page=${i+2}&country=China&origin=global#results`)) return false;
    }
    return true;
  } catch { return false; }
}
