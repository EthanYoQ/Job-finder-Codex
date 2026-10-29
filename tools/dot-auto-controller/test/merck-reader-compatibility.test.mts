// Offline fixtures only. This is not publication evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const load=(r:string,p:string)=>import(pathToFileURL(path.join(r,p)).href);
const {accepted,job}=await load(root,'vendor/c60-source/tests/helpers/portablePublicSnapshotFixture.ts');
const oldHash='3bce85185c99c4513a907f87fe3da9e8297392a8e0b9b1c52f57da09f2fe7d38', newHash='1f4b28ecba11e7fd299e51d7cd351529983d086ef18a2b5bd005e431812db212';
const source='source-merck-china-social', at='2026-10-29T17:00:00.000Z', now=new Date('2026-10-29T17:10:00.000Z');
const catalog=fs.readFileSync(path.join(root,'config/native-catalog.json'),'utf8');
assert.equal(JSON.parse(catalog).routingCatalogue.find((x:any)=>x.sourceId===source).sourceConfigSha256,newHash);
const catalogHash=createHash('sha256').update(catalog).digest('hex');
for(const p of ['connector-host-binding.mjs','connector-host-launch.py']) assert(fs.readFileSync(path.join(root,'vendor/c60-source/ops/cloud-pilot-host',p),'utf8').includes(catalogHash));
for(const role of ['main','fallback']) {
 const r=path.join(root,'vendor/reader-'+role), mod=await load(r,'src/domain/portablePublicSnapshot.ts'), repo=await load(r,'src/db/portablePublicSnapshotRepository.ts');
 const plans=await load(r,'src/crawler/sourcePlan.ts'), reg=await load(r,'src/data/companyRegistry.ts'), quality=await load(r,'src/crawler/sourceQualityAdmission.ts');
 const all=plans.buildStagedSourceCrawlPlans(reg.candidateCompanies), plan=all.find((x:any)=>x.source.id===source), old=structuredClone(plan);old.officialJsonFetch.pageSize=50;
 assert.equal(plans.sourcePlanConfigSha256(plan),newHash);assert.equal(plans.sourcePlanConfigSha256(old),oldHash);
 assert.equal(quality.getSourceQualityPolicy(plan),'PLAN_BOUND_SOURCE_QUALITY_V1');assert.equal(quality.getSourceQualityPolicy(old),null);
 assert.deepEqual(mod.portableCommittedConfigHashes(plan),[newHash,oldHash]);
 const drift=structuredClone(plan);drift.officialJsonFetch.maxPages++;assert.equal(mod.portableCommittedConfigHashes(drift).includes(oldHash),false);
 for(const p of all.filter((p:any)=>p.source.id!==source))assert.deepEqual(mod.portableCommittedConfigHashes(p),[plans.sourcePlanConfigSha256(p)]);
 const sql=repo.portableCommittedResultsSql([plan]);for(const h of [oldHash,newHash])assert.equal(sql.split(`r."sourceConfigHash"='${h}'`).length-1,2);
 const oldFixture=accepted('2026-10-29T16:00:00.000Z',['1','2'],[],old), fresh=accepted(at,['1','2','3'],[],plan);
 const jobs=(keys:string[],time:string)=>keys.map(k=>({...job(k,time),companyId:plan.company.id,sourceId:source,dedupeKey:source+':'+k,officialUrl:'https://careers.emdgroup.com/us/en/job/'+k}));
 const project=(rows:any[],members:any[],jobs:any[])=>{const selected=mod.selectPortableSourceSnapshots([plan],rows,{currentTime:now})[0];return mod.projectPortableSourceJobs(selected,members.filter(m=>m.sourceResultId===selected.selectedSourceResultId),jobs,{currentTime:now},members);};
 assert.equal(project([oldFixture.result],oldFixture.members,jobs(['1','2'],'2026-10-29T16:00:00.000Z')).visibleJobCount,2);
 assert.equal(project([oldFixture.result,fresh.result],[...oldFixture.members,...fresh.members],jobs(['1','2','3'],at)).visibleJobCount,3);
 const wrong=structuredClone(fresh.result);wrong.sourceConfigHash='0'.repeat(64);assert.equal(project([wrong],fresh.members,jobs(['1','2','3'],at)).state,'HOLD');
 const pending=structuredClone(fresh.result);pending.atomicCommitState='NOT_ATTEMPTED';assert.equal(project([pending],fresh.members,jobs(['1','2','3'],at)).state,'HOLD');
 assert.equal(project([fresh.result],fresh.members.slice(1),jobs(['1','2','3'],at)).state,'HOLD');
 // Keep the newly deployed Bayer certificate boundary, not the old pre-compact file.
 assert(fs.readFileSync(path.join(r,'src/domain/portablePublicSnapshot.ts'),'utf8').includes('receipt.schemaVersion === BAYER_COMPACT_CERTIFICATE_SCHEMA_VERSION && plan.source.id !== "source-bayer-healthcare-social"'));
 console.log(role+' old/new Merck snapshots, exact scope and Bayer boundary passed');
}
