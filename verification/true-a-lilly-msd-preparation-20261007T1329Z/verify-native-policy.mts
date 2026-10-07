// Synthetic issuer evidence and static SQL48 contract inspection; executes no SQL.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {captureSyntheticLillyAGrade} from '../../producer/tests/helpers/lillyAGradeFixture.ts';
import {issueAGradeOfficialTotalCertificate} from '../../producer/src/crawler/completenessCertificate.ts';
import {sourcePlanConfigSha256} from '../../producer/src/crawler/sourcePlan.ts';
import {supportsStrictOfficialTotalCertificate} from '../../producer/src/crawler/runSourceCrawl.ts';
const R=resolve(import.meta.dirname,'../..'),repo=join(R,'producer'),tests:any[]=[];
globalThis.fetch=async()=>{throw Error('NO_NETWORK');};
const {plan,result}=await captureSyntheticLillyAGrade();
assert.equal(result.status,'SUCCESS');assert.equal(result.truth.completenessVerified,true);assert.equal(supportsStrictOfficialTotalCertificate(plan),true);
assert.equal(sourcePlanConfigSha256(plan),'34ac4d47a1b69389e567b53df64062f10ed50a1d34cb0b4876d3c9af85e68c97');
assert.equal(result.jobs[0].officialPublishedAt,'2025-11-12T00:00:00.000Z');
const evidence=result.fetchEvidence!,artifact=evidence.artifacts.find(a=>a.logicalKey===evidence.declaredCompleteness!.artifactLogicalKey)!;
const input={binding:{releaseCandidateId:'synthetic-lilly-native-a',batchId:'synthetic-native',sourceResultId:'synthetic-native-result',sourceConfigSha256:sourcePlanConfigSha256(plan)},plan,transportSuccess:result.truth.transportSuccess,adapterSuccess:result.truth.adapterSuccess,evidence,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,officialArtifactSha256:createHash('sha256').update(artifact.body).digest('hex')};
const issued=issueAGradeOfficialTotalCertificate(input);assert.equal(issued.status,'CERTIFIED',JSON.stringify(issued));
if(issued.status!=='CERTIFIED')throw Error('LILLY_NATIVE_A_REQUIRED');
assert.equal(issued.certificate.schemaVersion,'a-grade-official-total-v2');assert.equal(issued.certificate.grade,'A');
tests.push({name:'Lilly-current-config-real-native-A-issuer-preserves-old-official-date',passed:true});
for(const name of ['invented-date','missing-detail','false-total','wrong-url','foreign-city']){
 const x=structuredClone(input);
 if(name==='invented-date')x.jobs[0].officialPublishedAt='2026-10-07T00:00:00.000Z';
 if(name==='missing-detail')x.evidence.artifacts=x.evidence.artifacts.filter(a=>!a.logicalKey.startsWith('lilly-detail-'));
 if(name==='false-total')x.evidence.declaredCompleteness!.value++;
 if(name==='wrong-url')x.plan.source.officialEntryUrl+='&old-config=1';
 if(name==='foreign-city')x.jobs[0].cities=['纽约'];
 assert.equal(issueAGradeOfficialTotalCertificate(x).status,'REJECTED',name);tests.push({name:'Lilly-rejects-'+name,passed:true});
}
const sql=readFileSync(join(repo,'prisma/migrations/20261006172300_job_projection_delta_contract/migration.sql'),'utf8');
const prior=readFileSync(join(repo,'prisma/migrations/20261003055000_jnj_dom_evidence_admission/migration.sql'),'utf8');
const body=(s:string)=>s.split('AS $function$')[1].split('$function$;')[0];
let restored=body(sql);
for(const name of ['DECLARATIONS','RECEIPT GATE','RECEIPT RESTORE']){
 const a='    -- BEGIN JOB DELTA '+name+'\n',b='    -- END JOB DELTA '+name+'\n';
 const start=restored.indexOf(a),end=restored.indexOf(b);assert(start>=0&&end>start);restored=restored.slice(0,start)+restored.slice(end+b.length);
}
assert.equal(restored,body(prior));assert(!sql.includes("('source-lilly-china-social','company-lilly-china'"));
tests.push({name:'C51-delta-retains-SQL48-original-gates-without-Lilly-retired-migration',passed:true});
const compiler=readFileSync(join(repo,'src/db/cloudPilotSqlControl.ts'),'utf8');
assert(compiler.includes('SET CONSTRAINTS "CrawlBatchSourceResult_verified_lifecycle_projection", "LifecycleSetEvidenceMember_exact_projection", "TransportAttemptEvidence_nonempty_refs" IMMEDIATE;'));
tests.push({name:'C51-native-publication-retains-three-SQL48-deferred-gates',passed:true});
const report={classification:'PURE_SYNTHETIC_ISSUER_AND_STATIC_SQL48_INSPECTION',passed:tests.length,tests,producerCommit:'28402a299bb04cbf5873da66c2fe8ca76827c0d1',lillyCertificateSchema:issued.certificate.schemaVersion,lillyPostedDatePreserved:true,retiredLillyMigrationRestored:false,sqlExecuted:false,http:false,actualRegistrationOrCapture:false};
writeFileSync(join(import.meta.dirname,'NATIVE_POLICY_RESULTS.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
