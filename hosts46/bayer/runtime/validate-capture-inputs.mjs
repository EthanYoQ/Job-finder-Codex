// Offline replay of both frozen Bayer routes and every independent original receipt.
import {readFile,lstat,realpath,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {noLinks} from './preflight/preflight-launch.mjs';
const host=dirname(dirname(fileURLToPath(import.meta.url))),cfg=JSON.parse(await readFile(join(host,'host-config.json')));
export async function validateCaptureInputs(args,now=new Date()){
 const [capturePath,captureHash,validationPath,validationHash,nextEligibleAt,...extra]=args;
 if(extra.length||![capturePath,validationPath].every(p=>typeof p==='string')||![captureHash,validationHash].every(h=>/^[a-f0-9]{64}$/.test(h??''))||!Number.isFinite(Date.parse(nextEligibleAt))||!Number.isFinite(now.getTime()))throw Error('CAPTURE_INPUT_ARGUMENTS');
 if(process.env.JOBFINDER_CLOUD_SOURCE_ID!==cfg.sourceId)throw Error('CAPTURE_INPUT_SOURCE_ENV');
 if(dirname(capturePath)===dirname(validationPath))throw Error('INDEPENDENT_SEPARATE_DIRECTORY_REQUIRED');
 globalThis.fetch=async()=>{throw Error('LOCAL_INPUT_CHECK_NETWORK_FORBIDDEN');};
 const sha=b=>createHash('sha256').update(b).digest('hex'),originals=[];
 async function readScoped(path,hash){
  path=await noLinks(path);
  if(!path.startsWith(host+'/captures/')||await realpath(path)!==path||!(await lstat(path)).isFile())throw Error('CAPTURE_INPUT_SCOPE');
  const bytes=await readFile(path);if(hash!==undefined&&sha(bytes)!==hash)throw Error('CAPTURE_INPUT_HASH');
  originals.push({path,sha256:sha(bytes),byteCount:bytes.length});return bytes;
 }
 const capture=JSON.parse(await readScoped(capturePath,captureHash)),rawValidation=JSON.parse(await readScoped(validationPath,validationHash));
 const plan=JSON.parse(await readFile(join(host,'source-plan.json'))),imp=p=>import(pathToFileURL(join(cfg.repo,p)).href);
 const {readCurrentWorkerCapture}=await imp('src/crawler/currentWorkerCapture.ts');
 const {runSourceCrawl}=await imp('src/crawler/runSourceCrawl.ts');
 const {replayBayerMedicalTraversal}=await imp('src/crawler/bayerMokaScope.ts');
 const {parseBGradeIndependentTraversalValidation,createOfficialJsonRenderedTraversalValidation,evaluateBGradeValidationRequirement,B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS}=await imp('src/crawler/traversalCertificate.ts');
 const {captureBayerIndependentDetails,replayBayerHybridTraversal,bayerHybridFinishedAt}=await imp('src/crawler/bayerMokaRenderedTraversal.ts');
 const {deriveDbStartedPublicationExpiry}=await imp('src/db/ingestionRepository.ts');
 await readScoped(capture.fetched.path,capture.fetched.sha256);
 const main=await readCurrentWorkerCapture({path:resolve(capturePath),sha256:captureHash},plan,now);
 if(Date.parse(capture.startedAt)<Date.parse(nextEligibleAt))throw Error('CURRENT_CAPTURE_PRECEDES_ACTUAL_DUE');
 const result=await runSourceCrawl(plan,{isBaseline:false,fetch:main.fetch});
 if(!result.truth.transportSuccess||!result.truth.adapterSuccess||!result.truth.completenessVerified||!replayBayerMedicalTraversal(plan,result.fetchEvidence,result.jobs))throw Error('MAIN_FROZEN_REPLAY_FAILED');
 const validation=parseBGradeIndependentTraversalValidation(rawValidation);
 if(validation.sourceId!==cfg.sourceId||validation.companyId!==plan.company.id||validation.sourceConfigSha256!==cfg.sourceConfigSha256||validation.schemaVersion!=='official-json-browser-network-traversal-v1')throw Error('INDEPENDENT_SOURCE_BINDING');
 const independent=dirname(validationPath),domBytes=await readScoped(join(independent,'dom-capture.json')),dom=JSON.parse(domBytes);
 if(!Array.isArray(dom.pages)||dom.pages.some(p=>Date.parse(p.capturedAt)>now.getTime()))throw Error('INDEPENDENT_FUTURE_DOM');
 const traversal=JSON.parse(await readScoped(join(independent,'ui-traversal.json')));
 const names=(await readdir(independent)).filter(n=>/^independent-http-.*\.json$/.test(n)).sort(),receipts=[];
 const required=1+dom.pages.reduce((n,p)=>n+p.rows.length,0);
 if(names.length!==required||names.some((name,i)=>name!==`independent-http-${String(i).padStart(4,'0')}.json`))throw Error('INDEPENDENT_ORIGINAL_RECEIPT_SET');
 for(const name of names){const r=JSON.parse(await readScoped(join(independent,name)));if(Date.parse(r.capturedAt)>now.getTime())throw Error('INDEPENDENT_FUTURE_RECEIPT');receipts.push(r);}
 let cursor=0;
 const rebuilt=await captureBayerIndependentDetails({dom,now:()=>now,http:async request=>{
  const receipt=receipts[cursor++];
  if(!receipt||request.method!==receipt.method||request.url!==receipt.url||!isDeepStrictEqual(request.body,receipt.requestBody))throw Error('INDEPENDENT_ORIGINAL_REQUEST_BINDING');
  return {status:receipt.status,body:receipt.body,finalUrl:receipt.finalUrl,capturedAt:receipt.capturedAt};
 }});
 if(cursor!==required||!isDeepStrictEqual(rebuilt,traversal))throw Error('INDEPENDENT_ORIGINAL_TRAVERSAL_MISMATCH');
 const reconstructed=createOfficialJsonRenderedTraversalValidation({sourceId:cfg.sourceId,companyId:plan.company.id,sourceConfigSha256:cfg.sourceConfigSha256,surfaceIds:[plan.source.surfaceId],channelIds:plan.expectedChannels.map(c=>c.channelId),pages:rebuilt.pages,observedAt:rebuilt.observedAt,expiresAt:validation.expiresAt});
 if(!isDeepStrictEqual(reconstructed,validation))throw Error('INDEPENDENT_ORIGINAL_VALIDATION_MISMATCH');
 const requirement=evaluateBGradeValidationRequirement({trigger:'INITIAL_QUALIFICATION',validationExecution:'CURRENT_RUN',validation,now});
 if(!requirement.acceptable)throw Error('CURRENT_INDEPENDENT_TIME_WINDOW:'+requirement.reason);
 if(Date.parse(validation.observedAt)<Date.parse(nextEligibleAt))throw Error('CURRENT_INDEPENDENT_PRECEDES_ACTUAL_DUE');
 const replay=replayBayerHybridTraversal(rebuilt.pages),sort=xs=>[...xs].sort(),mainRaw=result.fetchEvidence.pages.flatMap(p=>p.rawJobIds),mainIncluded=result.jobs.map(j=>j.sourceJobId),mainExcluded=mainRaw.filter(id=>!mainIncluded.includes(id));
 for(const [a,b] of [[mainRaw,replay.rawSourceJobIds],[mainIncluded,replay.matchKeys],[mainExcluded,replay.excludedSourceJobIds]])if(!isDeepStrictEqual(sort(a),sort(b)))throw Error('TWO_ROUTE_CURRENT_SET_MISMATCH');
 const expiry=deriveDbStartedPublicationExpiry({startedAt:new Date(capture.startedAt),completenessCertificate:{schemaVersion:'b-grade-independent-traversal-v2',validationPolicy:{execution:'CURRENT_RUN'},independentValidation:validation}});
 if(now.getTime()>=expiry)throw Error('CURRENT_EVIDENCE_EXPIRED');
 return {checkedAt:now.toISOString(),sourceId:cfg.sourceId,mainStartedAt:capture.startedAt,mainFinishedAt:capture.finishedAt,independentObservedAt:rebuilt.observedAt,independentFinishedAt:bayerHybridFinishedAt(rebuilt.pages),rawCount:replay.rawCount,excludedCount:replay.excludedCount,includedCount:replay.matchKeys.length,mainPageCount:result.fetchEvidence.pages.length,independentPageCount:rebuilt.pages.length,rawDomCaptureSha256:sha(domBytes),independentReceiptCount:receipts.length,originalCount:originals.length,originalsSha256:sha(JSON.stringify(originals)),auditedPausedLossesCount:result.fetchEvidence.fetchLosses.length,auditedPausedLossTuplesSha256:sha(JSON.stringify(result.fetchEvidence.fetchLosses.map(l=>[l.stage,l.reason,l.rawLocator,[l.details.code,l.details.pageSequence,l.details.recordIndex],l.recordedAt]).sort((a,b)=>Buffer.compare(Buffer.from(a[2]),Buffer.from(b[2]))))),publicationExpiresAt:new Date(expiry).toISOString(),contextDispatchBefore:new Date(expiry-190000).toISOString(),contextCompleteBefore:new Date(expiry-165000).toISOString(),mainFreshnessMs:1800000,independentCurrentRunMs:B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS,nonCertifying:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await validateCaptureInputs(process.argv.slice(2))));
