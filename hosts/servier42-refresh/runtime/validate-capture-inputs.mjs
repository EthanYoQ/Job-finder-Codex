// Read/replay existing local evidence only; imports never execute either capture entrypoint.
import {readFile,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {noLinks} from './preflight/preflight-launch.mjs';
const host=dirname(dirname(fileURLToPath(import.meta.url))),cfg=JSON.parse(await readFile(join(host,'host-config.json')));
const [capturePath,captureHash,validationPath,validationHash,nextEligibleAt,...extra]=process.argv.slice(2);
if(extra.length||![captureHash,validationHash].every(h=>/^[a-f0-9]{64}$/.test(h??''))||!Number.isFinite(Date.parse(nextEligibleAt)))throw Error('CAPTURE_INPUT_ARGUMENTS');
if(process.env.JOBFINDER_CLOUD_SOURCE_ID!==cfg.sourceId)throw Error('CAPTURE_INPUT_SOURCE_ENV');
globalThis.fetch=async()=>{throw Error('LOCAL_INPUT_CHECK_NETWORK_FORBIDDEN');};
async function readScoped(path,hash,parse=true){path=await noLinks(path);if(!path.startsWith(host+'/')||await realpath(path)!==path||!(await lstat(path)).isFile())throw Error('CAPTURE_INPUT_SCOPE');const bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('CAPTURE_INPUT_HASH');return parse?JSON.parse(bytes):bytes;}
const capture=await readScoped(capturePath,captureHash),rawValidation=await readScoped(validationPath,validationHash);
const plan=JSON.parse(await readFile(join(host,'source-plan.json'))),imp=p=>import(pathToFileURL(join(cfg.repo,p)).href);
const {readCurrentWorkerCapture}=await imp('src/crawler/currentWorkerCapture.ts');
const {parseBGradeIndependentTraversalValidation,B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS}=await imp('src/crawler/traversalCertificate.ts');
const {replayServierHybridTraversal,servierHybridObservedAt,servierHybridFinishedAt}=await imp('src/crawler/servierMokaRenderedTraversal.ts');
const {deriveDbStartedPublicationExpiry}=await imp('src/db/ingestionRepository.ts');
await readScoped(capture.fetched.path,capture.fetched.sha256,false);
await readCurrentWorkerCapture({path:resolve(capturePath),sha256:captureHash},plan);
if(Date.parse(capture.startedAt)<Date.parse(nextEligibleAt))throw Error('CURRENT_CAPTURE_PRECEDES_ACTUAL_DUE');
const validation=parseBGradeIndependentTraversalValidation(rawValidation);
if(validation.sourceId!==cfg.sourceId||validation.companyId!==plan.company.id||validation.sourceConfigSha256!==cfg.sourceConfigSha256)throw Error('INDEPENDENT_SOURCE_BINDING');
const replay=replayServierHybridTraversal(validation.pages),observedAt=servierHybridObservedAt(validation.pages),finishedAt=servierHybridFinishedAt(validation.pages);
if(observedAt!==validation.observedAt||Date.now()<Date.parse(finishedAt)||Date.now()-Date.parse(observedAt)>B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS)throw Error('CURRENT_INDEPENDENT_TIME_WINDOW');
const expiry=deriveDbStartedPublicationExpiry({startedAt:new Date(capture.startedAt),completenessCertificate:{schemaVersion:'b-grade-independent-traversal-v2',validationPolicy:{execution:'CURRENT_RUN'},independentValidation:validation}});
console.log(JSON.stringify({checkedAt:new Date().toISOString(),sourceId:cfg.sourceId,mainStartedAt:capture.startedAt,mainFinishedAt:capture.finishedAt,independentObservedAt:observedAt,independentFinishedAt:finishedAt,rawCount:replay.rawCount,excludedCount:replay.excludedCount,includedCount:replay.matchKeys.length,publicationExpiresAt:new Date(expiry).toISOString(),contextDispatchBefore:new Date(expiry-190000).toISOString(),contextCompleteBefore:new Date(expiry-165000).toISOString(),mainFreshnessMs:1800000,independentCurrentRunMs:B_GRADE_CURRENT_RUN_MAXIMUM_SKEW_MS,nonCertifying:true}));
