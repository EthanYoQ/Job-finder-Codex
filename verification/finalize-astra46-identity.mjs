import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const base='/workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z',host=join(base,'hosts46/astra'),repo=join(base,'producer42');
if(process.env.TSX_DISABLE_CACHE!=='1'||process.env.NODE_DISABLE_COMPILE_CACHE!=='1'||process.env.PYTHONDONTWRITEBYTECODE!=='1'||process.env.JOBFINDER_CLOUD_SOURCE_ID!=='source-astrazeneca-social')throw Error('AUDIT_ENV');
globalThis.fetch=async()=>{throw Error('AUDIT_NETWORK_FORBIDDEN');};
const imp=p=>import(pathToFileURL(join(repo,p)).href),sha=b=>createHash('sha256').update(b).digest('hex');
const spec=JSON.parse(await readFile(join(host,'SPEC.json'))),checks=JSON.parse(await readFile(join(host,'CHECK_RESULTS.json'))),sourceChecks=JSON.parse(await readFile(join(host,'SOURCE_CHECK_RESULTS.json')));
if(!checks.passed||!sourceChecks.passed)throw Error('CHECKS_REQUIRED');
const {createBuildIdentity}=await imp('src/readiness/buildIdentity.ts');
const {deriveCurrentStagedScheduleExpectation}=await imp('src/crawler/stagedScheduleAuthority.ts');
const {sourcePlanConfigSha256}=await imp('src/crawler/sourcePlan.ts');
const git=a=>execFileSync('git',a,{cwd:repo,encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim();
if(git(['rev-parse','HEAD'])!==spec.build.commitSha||git(['status','--porcelain']))throw Error('FROZEN_SOURCE_CHANGED');
const after=createBuildIdentity(repo,spec.build.commitSha);
if(JSON.stringify(after)!==JSON.stringify(spec.build))throw Error('SOURCE_OR_RUNTIME_DEPENDENCY_CHANGED');
const plan=deriveCurrentStagedScheduleExpectation(after).plans.find(p=>p.source.id===spec.sourceId);
if(JSON.stringify(plan,null,2)+'\n'!==await readFile(join(host,'source-plan.json'),'utf8')||sourcePlanConfigSha256(plan)!==spec.sourceConfigSha256)throw Error('PLAN_BYTES_CHANGED');
const preservedFiles={};
for(const path of ['scripts/p0-cloud-source-pilot.ts','scripts/run-with-http-diagnostics.mjs','src/db/cloudPilotSqlControl.ts','src/crawler/cloudDbStartedPilot.ts','src/db/ingestionRepository.ts','src/crawler/companyRecruitmentProfiles/profiles/astrazeneca.ts','src/crawler/astraZenecaDetailContract.ts','src/crawler/astraZenecaDetailAcquisition.ts','src/crawler/astraZenecaDetails.ts','src/crawler/sourceQualityAdmission.ts','src/crawler/completenessCertificate.ts','src/crawler/httpHtmlSourceFetch.ts','src/crawler/strictHtmlCompletenessProof.ts','package.json','package-lock.json'])preservedFiles[path]={sha256:sha(await readFile(join(repo,path)))};
const proof={schemaVersion:1,checkedAt:new Date().toISOString(),before:spec.build,after,allIdentityFieldsEqual:true,frozenGitClean:true,fullRuntimeTreeIncludesNodeModules:true,producerModified:false,dependenciesModified:false,otherHostTemplatesChanged:false,actualSourcePlanBytesEqual:true,sourceConfigSha256:spec.sourceConfigSha256,preservedFiles};
for(const [path,v]of Object.entries(spec.templateFiles)){
 if(sha(await readFile(v.template))!==v.templateSha256||sha(await readFile(join(host,path)))!==v.sha256)throw Error('TEMPLATE_OR_HOST_CHANGED:'+path);
}
await writeFile(join(host,'IDENTITY_PROOF.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({identityUnchanged:true,build:after,hostChecks:checks.checks.length,sourceChecks:sourceChecks.checks.length,sourceNetworkAccessed:false,databaseAccessed:false}));
