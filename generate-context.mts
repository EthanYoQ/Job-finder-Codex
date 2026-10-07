// Offline source-plan validation and placeholder context compilation only.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {compileCloudPilotPublicationContextSql,CLOUD_PILOT_SOURCE} from '../../producer/src/db/cloudPilotSqlControl.ts';
import {deriveCurrentStagedScheduleExpectation} from '../../producer/src/crawler/stagedScheduleAuthority.ts';
import {sourcePlanConfigSha256} from '../../producer/src/crawler/sourcePlan.ts';
import {REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES} from '../../producer/src/crawler/completenessCertificate.ts';
import {requiresBGradeTraversalCertificate} from '../../producer/src/crawler/traversalCertificate.ts';
import {supportsStrictOfficialTotalCertificate} from '../../producer/src/crawler/runSourceCrawl.ts';
import {assertPortableRefreshPlan} from '../../producer/scripts/p0-cloud-portable-source-pilot.ts';
import {getSourceQualityPolicy,SOURCE_QUALITY_POLICY_ID} from '../../producer/src/crawler/sourceQualityAdmission.ts';
const R=resolve(import.meta.dirname,'../..'),key=process.argv[2];assert(['hansoh','fosun'].includes(key));
const T=process.argv[3]?resolve(process.argv[3]):R,host=join(T,'hosts',key,'host');
const cfg=JSON.parse(readFileSync(join(host,'host-config.template.json'),'utf8'));
const template=JSON.parse(readFileSync(join(host,'control-base.template.json'),'utf8'));
assert.equal(template.candidate,null);assert.equal(template.databaseIdentity,null);
assert.equal(cfg.sourceId,CLOUD_PILOT_SOURCE.id);assert.equal(cfg.sourceConfigSha256,CLOUD_PILOT_SOURCE.sourceConfigSha256);
const plan=deriveCurrentStagedScheduleExpectation(template.build).plans.find(p=>p.source.id===cfg.sourceId)!;
assert.equal(sourcePlanConfigSha256(plan),cfg.sourceConfigSha256);
const reference=JSON.parse(readFileSync(join(host,'source-config-reference.json'),'utf8'));
const portable=true,route=portable?'PORTABLE':'TRUE_A';
assert.equal(reference.route,route);
for(const[k,v]of Object.entries(reference.source))assert.equal((plan.source as any)[k],v);
// Historical traversal registration does not select the current PORTABLE route.
assert.equal(requiresBGradeTraversalCertificate(plan),true);
if(portable){assertPortableRefreshPlan(plan);assert.equal(getSourceQualityPolicy(plan),SOURCE_QUALITY_POLICY_ID);}
else{assert.equal(supportsStrictOfficialTotalCertificate(plan),true);assert.equal(REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES[plan.source.id],plan.company.id);assert.throws(()=>assertPortableRefreshPlan(plan));}
const control={...template,candidate:{id:'OWNER_REGISTERED_C51_CANDIDATE_ID',goalId:'jobfinder-portable-required-40',version:51},databaseIdentity:{migrationVersion:'20261006172300_job_projection_delta_contract',schemaHash:'0'.repeat(64),dbSnapshotHash:'0'.repeat(64)}};
const sql=portable?compileCloudPilotPublicationContextSql(control,'PLAN_BOUND_SOURCE_QUALITY_V1'):compileCloudPilotPublicationContextSql(control);
assert(sql.includes("'legacyCertificate'"));assert(sql.includes('j."visibleInFrontend",j."isNew"'));
assert.equal(sql.includes('PLAN_BOUND_SOURCE_QUALITY_V1'),portable);
assert(sql.includes(portable?'plan-bound-source-quality-v1':'a-grade-official-total-v2'));
const digest=(x:Buffer|string)=>createHash('sha256').update(x).digest('hex');
const entrypoint='scripts/'+(portable?'p0-cloud-portable-source-pilot.ts':'p0-cloud-source-pilot.ts');
writeFileSync(join(host,'context-read.sql.template'),sql,{flag:'wx',mode:0o600});
const proof={schemaVersion:1,sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256,route,entrypoint,entrypointSha256:digest(readFileSync(join(R,'producer',entrypoint))),sourceAdmissionPolicy:portable?'PLAN_BOUND_SOURCE_QUALITY_V1':null,certificateSchema:portable?'plan-bound-source-quality-v1':'a-grade-official-total-v2',publicationMode:'DB_STARTED_JOB_PROJECTION_DELTA_V1',candidate:null,databaseIdentity:null,templatePlaceholderOnly:true,contextSha256:digest(sql),expiryBasis:portable?'original acquisition startedAt plus at most 30m capture and 30m evidence expiry':'source.startedAt+1800000',originalSourcePlan:plan,network:false,database:false,launch:false};
writeFileSync(join(host,'context-template-proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({key,sourceId:cfg.sourceId,route,sourceConfigSha256:cfg.sourceConfigSha256,contextSha256:proof.contextSha256,ownerBindingRequired:true}));
