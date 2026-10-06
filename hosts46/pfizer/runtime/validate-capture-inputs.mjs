// Local-only replay of exact Pfizer main bytes and independently obtained native DOM.
import {readFile,lstat,realpath} from 'node:fs/promises';
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
 globalThis.fetch=async()=>{throw Error('LOCAL_INPUT_CHECK_NETWORK_FORBIDDEN');};
 const sha=b=>createHash('sha256').update(b).digest('hex');
 async function readScoped(path,hash){
  path=await noLinks(path);
  if(!path.startsWith(host+'/captures/')||await realpath(path)!==path||!(await lstat(path)).isFile())throw Error('CAPTURE_INPUT_SCOPE');
  const bytes=await readFile(path);if(hash!==undefined&&sha(bytes)!==hash)throw Error('CAPTURE_INPUT_HASH');return bytes;
 }
 const capture=JSON.parse(await readScoped(capturePath,captureHash)),rawValidation=JSON.parse(await readScoped(validationPath,validationHash));
 const plan=JSON.parse(await readFile(join(host,'source-plan.json'))),imp=p=>import(pathToFileURL(join(cfg.repo,p)).href);
 const {readCurrentWorkerCapture}=await imp('src/crawler/currentWorkerCapture.ts');
 const {parseBGradeIndependentTraversalValidation,createOfficialJsonRenderedTraversalValidation,evaluateBGradeValidationRequirement,B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS}=await imp('src/crawler/traversalCertificate.ts');
 const {pfizerDomPacketsToPages}=await imp('src/crawler/pfizerRenderedTraversal.ts');
 const {deriveDbStartedPublicationExpiry}=await imp('src/db/ingestionRepository.ts');
 await readScoped(capture.fetched.path,capture.fetched.sha256);
 await readCurrentWorkerCapture({path:resolve(capturePath),sha256:captureHash},plan,now);
 if(Date.parse(capture.startedAt)<Date.parse(nextEligibleAt))throw Error('CURRENT_CAPTURE_PRECEDES_ACTUAL_DUE');
 const validation=parseBGradeIndependentTraversalValidation(rawValidation);
 if(validation.sourceId!==cfg.sourceId||validation.companyId!==plan.company.id||validation.sourceConfigSha256!==cfg.sourceConfigSha256||validation.schemaVersion!=='official-json-browser-network-traversal-v1')throw Error('INDEPENDENT_SOURCE_BINDING');
 const originals=await readScoped(join(dirname(validationPath),'managed-browser-capture.json')),raw=JSON.parse(originals),rawHash=sha(originals);
 if(raw.captureKind!=='MANAGED_BROWSER_DOM_JSONLD'||raw.observedAt!==validation.observedAt)throw Error('INDEPENDENT_NATIVE_DOM_REQUIRED');
 const pages=pfizerDomPacketsToPages(raw.packets,rawHash);
 const reconstructed=createOfficialJsonRenderedTraversalValidation({sourceId:cfg.sourceId,companyId:plan.company.id,sourceConfigSha256:cfg.sourceConfigSha256,surfaceIds:[plan.source.surfaceId],channelIds:plan.expectedChannels.map(c=>c.channelId),pages,observedAt:raw.observedAt,expiresAt:validation.expiresAt});
 if(!isDeepStrictEqual(reconstructed,validation))throw Error('INDEPENDENT_NATIVE_DOM_REPLAY_MISMATCH');
 const requirement=evaluateBGradeValidationRequirement({trigger:'INITIAL_QUALIFICATION',validationExecution:'CURRENT_RUN',validation,now});
 if(!requirement.acceptable)throw Error('CURRENT_INDEPENDENT_TIME_WINDOW:'+requirement.reason);
 if(Date.parse(validation.observedAt)<Date.parse(nextEligibleAt))throw Error('CURRENT_INDEPENDENT_PRECEDES_ACTUAL_DUE');
 const observedAt=validation.observedAt,times=pages.flatMap(p=>p.rawRows.flatMap(r=>[r.rawPayload.capturedAt,...(r.rawPayload.listPage?[r.rawPayload.listPage.capturedAt]:[])]));
 const finishedAt=new Date(Math.max(...times.map(Date.parse))).toISOString();
 const expiry=deriveDbStartedPublicationExpiry({startedAt:new Date(capture.startedAt),completenessCertificate:{schemaVersion:'b-grade-independent-traversal-v2',validationPolicy:{execution:'CURRENT_RUN'},independentValidation:validation}});
 if(now.getTime()>=expiry)throw Error('CURRENT_EVIDENCE_EXPIRED');
 const rows=pages.flatMap(p=>p.rawRows),excluded=rows.filter(r=>r.scopeDecision==='EXCLUDED_AUDITED');
 return {checkedAt:now.toISOString(),sourceId:cfg.sourceId,mainStartedAt:capture.startedAt,mainFinishedAt:capture.finishedAt,independentObservedAt:observedAt,independentFinishedAt:finishedAt,rawCount:rows.length,excludedCount:excluded.length,includedCount:rows.length-excluded.length,rawManagedBrowserCaptureSha256:rawHash,publicationExpiresAt:new Date(expiry).toISOString(),contextDispatchBefore:new Date(expiry-190000).toISOString(),contextCompleteBefore:new Date(expiry-165000).toISOString(),mainFreshnessMs:1800000,independentCurrentRunMs:B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS,nonCertifying:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await validateCaptureInputs(process.argv.slice(2))));
