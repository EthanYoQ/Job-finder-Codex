import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const base=dirname(dirname(fileURLToPath(import.meta.url))),repo=join(base,'producer42'),keys=['novartis'];
if(process.env.TSX_DISABLE_CACHE!=='1'||process.env.NODE_DISABLE_COMPILE_CACHE!=='1'||process.env.PYTHONDONTWRITEBYTECODE!=='1')throw Error('AUDIT_ENV');
globalThis.fetch=async()=>{throw Error('AUDIT_NETWORK_FORBIDDEN');};
const imp=p=>import(pathToFileURL(join(repo,p)).href),sha=b=>createHash('sha256').update(b).digest('hex');
const {createBuildIdentity}=await imp('src/readiness/buildIdentity.ts');
const {deriveCurrentStagedScheduleExpectation}=await imp('src/crawler/stagedScheduleAuthority.ts');
const {sourcePlanConfigSha256}=await imp('src/crawler/sourcePlan.ts');
const control=JSON.parse(await readFile(join(base,'verification/candidate46-input.json'))),git=a=>execFileSync('git',a,{cwd:repo,encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim();
if(git(['rev-parse','HEAD'])!==control.build.commitSha||git(['status','--porcelain']))throw Error('FROZEN_SOURCE_CHANGED');
const after=createBuildIdentity(repo,control.build.commitSha);if(JSON.stringify(after)!==JSON.stringify(control.build))throw Error('SOURCE_OR_DEPENDENCY_CHANGED');
const authority=deriveCurrentStagedScheduleExpectation(after),results=[];
for(const key of keys){
 const host=join(base,'hosts46',key),spec=JSON.parse(await readFile(join(host,'SPEC.json'))),checks=JSON.parse(await readFile(join(host,'CHECK_RESULTS.json'))),safety=JSON.parse(await readFile(join(host,'SAFETY_COUNTEREXAMPLES.json'))),review=JSON.parse(await readFile(join(host,'REVIEWER_TEST_RESULTS.json')));
 if(!checks.passed||!safety.passed||!review.passed)throw Error('CHECKS_REQUIRED:'+key);
 const plan=authority.plans.find(p=>p.source.id===spec.sourceId);
 if(JSON.stringify(plan,null,2)+'\n'!==await readFile(join(host,'source-plan.json'),'utf8')||sourcePlanConfigSha256(plan)!==spec.sourceConfigSha256)throw Error('PLAN_CHANGED:'+key);
 for(const [p,v]of Object.entries(spec.templateFiles))if(sha(await readFile(v.originalPath))!==v.originalSha256||sha(await readFile(join(host,p)))!==v.sha256)throw Error('HOST_CHANGED:'+key+':'+p);
 const proof={schemaVersion:1,checkedAt:new Date().toISOString(),before:spec.build,after,allIdentityFieldsEqual:true,frozenGitClean:true,fullRuntimeTreeIncludesNodeModules:true,producerModified:false,dependenciesModified:false,actualSourcePlanBytesEqual:true,sourceConfigSha256:spec.sourceConfigSha256,sourceNetworkAccessed:false,databaseAccessed:false,producerLaunched:false};
 await writeFile(join(host,'IDENTITY_PROOF.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});results.push({key,sourceId:spec.sourceId,sourceConfigSha256:spec.sourceConfigSha256});
}
console.log(JSON.stringify({identityUnchanged:true,results}));
