// Read-only verification against the fixed producer dependency. No history/DB/HTTP inputs.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const file=resolve(import.meta.dirname,'static-source-routes.json');
const bytes=readFileSync(file),sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
assert.equal(sha(bytes),'b28dab245fef258bf73f44f816a459f304f148cf3c15b7221953b798e78edc3b','STATIC_INPUT_PIN');
const input=JSON.parse(bytes.toString()),repo=join(input.runtimeRoot,'producer');
const node=join(input.runtimeRoot,'runtime/node-v22.23.3-linux-x64/bin/node');
assert.equal(process.execPath,node);assert.equal(realpathSync(node),node);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),input.producerCommit);
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim(),'');
for(const row of input.sources)for(const impl of row.implementations)assert.equal(sha(readFileSync(join(repo,impl.path))),impl.sha256,'IMPLEMENTATION_PIN:'+impl.path);
globalThis.fetch=async()=>{throw Error('STATIC_VALIDATION_NETWORK_FORBIDDEN');};
const fromRepo=(path:string)=>import(pathToFileURL(join(repo,path)).href);
const [{buildStagedSourceCrawlPlans,sourcePlanConfigSha256},{candidateCompanies},{assertPortableRefreshPlan},{getSourceQualityPolicy,SOURCE_QUALITY_POLICY_ID},{REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES},{requiresBGradeTraversalCertificate},{verifyNodeRuntimeProfile}]=await Promise.all([
 fromRepo('src/crawler/sourcePlan.ts'),fromRepo('src/data/companyRegistry.ts'),fromRepo('scripts/p0-cloud-portable-source-pilot.ts'),fromRepo('src/crawler/sourceQualityAdmission.ts'),fromRepo('src/crawler/completenessCertificate.ts'),fromRepo('src/crawler/traversalCertificate.ts'),fromRepo('scripts/verify-node-runtime-profile.ts')
]);
await verifyNodeRuntimeProfile();
const {createBuildIdentity}=await fromRepo('src/readiness/buildIdentity.ts');
const build=createBuildIdentity(repo,input.producerCommit);
for(const row of input.sources)assert.deepEqual(JSON.parse(readFileSync(join(import.meta.dirname,'seed/hosts',row.sourceKey,'host/control-base.template.json'),'utf8')).build,build,'STATIC_FROZEN_BUILD_IDENTITY');
const plans=buildStagedSourceCrawlPlans(candidateCompanies);
for(const row of input.sources){
 const matches=plans.filter((p:any)=>p.source.id===row.sourceId);assert.equal(matches.length,1);
 const plan=matches[0];assert.deepEqual(plan,row.currentSourcePlan,'EXACT_FULL_SOURCE_PLAN');
 assert.equal(sourcePlanConfigSha256(plan),row.sourceConfigSha256);
 for(const [key,value]of Object.entries(row.source))assert.equal(plan.source[key],value);
 assert.equal(requiresBGradeTraversalCertificate(plan),false);
 if(row.route==='PORTABLE'){assertPortableRefreshPlan(plan);assert.equal(getSourceQualityPolicy(plan),SOURCE_QUALITY_POLICY_ID);}
 else{assert.equal(row.route,'TRUE_A');assert.equal(REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES[row.sourceId],plan.company.id);assert.throws(()=>assertPortableRefreshPlan(plan));}
}
console.log(JSON.stringify({staticConfigurationVerified:true,sourceCount:input.sources.length,noDatabase:true,noHttp:true}));
