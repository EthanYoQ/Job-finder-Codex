/** Read-only Pfizer proof review. Native Workday main + independent official UI/JSON-LD contract. */
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNodeRuntimeProfile} from '../../../../producer/scripts/verify-node-runtime-profile.ts';
import {parseBGradeIndependentTraversalValidation,verifyBGradeTraversalCertificateReceipt} from '../../../../producer/src/crawler/traversalCertificate.ts';
import {replayOfficialJsonRenderedTraversal} from '../../../../producer/src/crawler/officialJsonRenderedTraversalValidator.ts';
import {canonicalStringSetSha256} from '../../../../producer/src/crawler/sourceFetchEvidence.ts';
import {deriveDbStartedPublicationExpiry} from '../../../../producer/src/db/ingestionRepository.ts';
import {unwrapJobProjectionSourceRow} from '../../../../producer/src/db/jobProjectionDeltaCompiler.ts';
import {parseJobProjectionDeltaReceipt,canonicalProjectionJson} from '../../../../producer/src/domain/jobProjectionDeltaReceipt.ts';
import {inspectRequest,loadBoundPublicationContext} from './review-packet-envelope.mts';
import {verifyIndependentValidationInput} from './verify-independent-validation.mts';
const SOURCE='source-pfizer-china-social',CONFIG='84aaab8bad3579630eec1b12d3f09236755b3a25d0b7751ca8584a9a53a83413';
const equal=(a:unknown,b:unknown)=>canonicalProjectionJson(a)===canonicalProjectionJson(b);
function check(ok:unknown,code:string):asserts ok{if(!ok)throw Error(code);}
function instant(value:unknown):number{check(typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value),'PFIZER_B_TIMESTAMP');const at=Date.parse(value);check(Number.isFinite(at)&&new Date(at).toISOString()===value,'PFIZER_B_TIMESTAMP');return at;}
export function verifyPfizerBProof(terminal:any,independentValidation:any,now:Date){
 check(now instanceof Date&&Number.isFinite(now.getTime()),'PFIZER_B_NOW');
 check(terminal?.sourceId===SOURCE&&terminal.sourceConfigHash===CONFIG,'PFIZER_B_SOURCE_CONFIG');
 check(typeof terminal.batchId==='string'&&terminal.batchId.length>0&&typeof terminal.releaseCandidateId==='string'&&terminal.releaseCandidateId.length>0&&terminal.id===terminal.batchId+'--'+SOURCE,'PFIZER_B_SOURCE_TUPLE');
 check(equal([terminal.transportState,terminal.adapterState,terminal.completenessState,terminal.atomicCommitState],['SUCCEEDED','SUCCEEDED','VERIFIED','COMMITTED']),'PFIZER_B_TERMINAL_STATE');
 const delta=parseJobProjectionDeltaReceipt(terminal.completenessCertificate,terminal.completenessCertificateSha256),row=unwrapJobProjectionSourceRow(terminal) as any,cert=row.completenessCertificate;
 check(cert?.schemaVersion==='b-grade-independent-traversal-v2'&&cert.grade==='B'&&cert.validationPolicy?.execution==='CURRENT_RUN','PFIZER_B_CURRENT_CERTIFICATE_REQUIRED');
 const validation=parseBGradeIndependentTraversalValidation(independentValidation);
 check(validation.schemaVersion==='official-json-browser-network-traversal-v1'&&validation.sourceId===SOURCE&&validation.companyId==='company-pfizer-china'&&validation.sourceConfigSha256===CONFIG,'PFIZER_B_INDEPENDENT_SCOPE');
 check(cert.mainTraversal?.retrievalPath==='HTTP_WORKDAY_COUNTRY_LIST_PLUS_NATIVE_DETAILS'&&validation.retrievalPath==='PLAYWRIGHT_OFFICIAL_UI_JSONLD_TRAVERSAL','PFIZER_B_NATIVE_PATHS');
 check(equal(cert.independentValidation,validation),'PFIZER_B_BOOTSTRAP_VALIDATION_MISMATCH');
 check(equal(validation.surfaceIds,row.officialSurfaceIds)&&equal(validation.channelIds,row.officialChannelIds),'PFIZER_B_INDEPENDENT_SURFACE_CHANNEL');
 const inputBytes=Buffer.from(JSON.stringify(validation)),inputProof=verifyIndependentValidationInput(inputBytes,createHash('sha256').update(inputBytes).digest('hex'),now);
 const replay=replayOfficialJsonRenderedTraversal(SOURCE,validation.pages);
 const start=instant(row.startedAt),finish=instant(row.finishedAt);
 check(start<=finish&&finish<=now.getTime(),'PFIZER_B_ORIGINAL_TIME_ORDER');check(instant(delta.observedAt)>=start,'PFIZER_B_DELTA_OBSERVATION_ORDER');
 const verified=verifyBGradeTraversalCertificateReceipt({certificate:cert,certificateSha256:row.completenessCertificateSha256,expected:{releaseCandidateId:row.releaseCandidateId,batchId:row.batchId,sourceResultId:row.id,sourceId:SOURCE,sourceConfigSha256:CONFIG,companyId:'company-pfizer-china',surfaceIds:row.officialSurfaceIds,channelIds:row.officialChannelIds,canonicalJobSetSha256:row.canonicalCurrentJobSetSha256,adapterReconciliationSha256:row.adapterReconciliationSha256,collisionLedgerSha256:row.collisionLedgerSha256,canonicalRawEvidenceIdSetSha256:canonicalStringSetSha256(replay.rawEvidenceIds)},now});
 for(const key of ['rawCount','parsedCount','validCount','dedupeOutputCount','parseDiscardCount','validationDiscardCount','normalizationDiscardCount','dedupeDiscardCount'])check(Number.isSafeInteger(row[key])&&row[key]>=0,'PFIZER_B_ROW_COUNT_TYPE');
 const included=replay.matchKeys.length,excluded=replay.excludedCount;
 check(row.rawCount===replay.rawCount&&row.parsedCount===replay.rawCount&&row.validCount===included&&row.dedupeOutputCount===included&&row.validationDiscardCount===excluded&&row.rawCount===included+excluded&&cert.counts.mainUniqueJobCount===included&&cert.counts.independentUniqueJobCount===included&&cert.counts.finalUniqueJobCount===included&&cert.counts.validationDiscardCount===excluded,'PFIZER_B_RAW_INCLUDED_EXCLUDED_COUNTS');
 check(row.parseDiscardCount===0&&row.normalizationDiscardCount===0&&row.dedupeDiscardCount===0,'PFIZER_B_UNEXPECTED_PIPELINE_LOSS');
 check(row.expectedJobCount===null&&row.expectedEvidenceKind==='COMPLETE_PAGE_TRAVERSAL','PFIZER_B_TRAVERSAL_DECLARATION');
 check(row.canonicalOutputSetSha256===row.canonicalCurrentJobSetSha256&&cert.output.canonicalJobSetSha256===row.canonicalCurrentJobSetSha256,'PFIZER_B_OUTPUT_SET');
 const current=delta.members.filter(m=>m.setKind==='CURRENT');
 check(current.length===included&&new Set(current.map(m=>m.jobKey)).size===included&&canonicalStringSetSha256(current.map(m=>m.jobKey))===row.canonicalCurrentJobSetSha256,'PFIZER_B_DELTA_CURRENT_SET');
 const expiry=deriveDbStartedPublicationExpiry({startedAt:new Date(start),completenessCertificate:cert});check(now.getTime()<expiry,'PFIZER_B_PUBLICATION_EXPIRED');
 return {status:verified.status,grade:verified.grade,sourceId:SOURCE,sourceResultId:row.id,sourceConfigSha256:CONFIG,certificateSha256:row.completenessCertificateSha256,independentArtifactSha256:validation.artifactSha256,rawCount:replay.rawCount,includedMainlandCount:included,auditedIndiaExcludedCount:excluded,finalUniqueJobCount:verified.finalUniqueJobCount,currentMemberCount:current.length,mainStartedAt:row.startedAt,mainFinishedAt:row.finishedAt,independentObservedAt:validation.observedAt,independentFinishedAt:inputProof.independentFinishedAt,deltaObservedAt:delta.observedAt,deltaVerifiedAt:delta.verifiedAt,publicationExpiresAt:new Date(expiry).toISOString()};
}
export function reviewPfizerBRequest(request:any,bootstrap:any,independentBytes:Uint8Array,now:Date,origin?:any){
 const ref=bootstrap?.independentValidation;
 check(bootstrap?.schemaVersion===1&&typeof bootstrap.batchId==='string'&&ref&&Object.keys(ref).sort().join(',')==='path,sha256'&&typeof ref.path==='string'&&isAbsolute(ref.path)&&/^[a-f0-9]{64}$/.test(ref.sha256??''),'PFIZER_B_BOOTSTRAP_INPUT');
 check(createHash('sha256').update(independentBytes).digest('hex')===ref.sha256,'PFIZER_B_INDEPENDENT_FILE_HASH');
 const packet=inspectRequest(request,origin);check(packet.terminal.batchId===bootstrap.batchId,'PFIZER_B_BOOTSTRAP_BATCH');
 const proof=verifyPfizerBProof(packet.terminal,JSON.parse(Buffer.from(independentBytes).toString('utf8')),now);
 const expiry=instant(request.expiresAt);check(expiry>now.getTime()&&expiry<=instant(proof.publicationExpiresAt),'PFIZER_B_REQUEST_EXPIRY');
 return {requestId:packet.requestId,requestSha256:packet.requestSha256,sqlSha256:packet.sqlSha256,independentValidationSha256:ref.sha256,bProof:proof};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await verifyNodeRuntimeProfile();const [requestPath,bootstrapPath,...extra]=process.argv.slice(2);check(requestPath&&bootstrapPath&&extra.length===0,'PFIZER_B_REVIEW_ARGUMENTS');
 const bootstrap=JSON.parse(readFileSync(bootstrapPath,'utf8')),path=bootstrap?.independentValidation?.path;
 check(typeof path==='string'&&isAbsolute(path)&&lstatSync(path).isFile()&&realpathSync(path)===path,'PFIZER_B_INDEPENDENT_FILE');
 const request=JSON.parse(readFileSync(requestPath,'utf8'));
 console.log(JSON.stringify(reviewPfizerBRequest(request,bootstrap,readFileSync(path),new Date(),loadBoundPublicationContext(requestPath,request))));
}
