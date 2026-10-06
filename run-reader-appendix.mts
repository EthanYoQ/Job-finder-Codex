import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { toPrismaJobCategory } from "../jnj-native-url-candidate-20261006T0713Z/src/db/prismaMappers";
import { syntheticJnjCommit } from "../jnj-native-url-candidate-20261006T0713Z/tests/helpers/jnjNativeSyntheticFixture";
import { accepted } from "../jnj-native-url-candidate-20261006T0713Z/tests/helpers/portablePublicSnapshotFixture";
import { JNJ_DOM_URL_PROFILES } from "../jnj-native-url-candidate-20261006T0713Z/src/crawler/jnjCareersDomUrlProfile";
import { readPortablePublicSnapshot as a775Read } from "./readers/a775/src/db/portablePublicSnapshotRepository";
import * as a775Domain from "./readers/a775/src/domain/portablePublicSnapshot";
import { readPortablePublicSnapshot as db56Read } from "./readers/db56/src/db/portablePublicSnapshotRepository";
import * as db56Domain from "./readers/db56/src/domain/portablePublicSnapshot";
async function readerFixture(profile: typeof JNJ_DOM_URL_PROFILES[number]) {
 const {plan,commit}=await syntheticJnjCommit(profile),r=commit.sourceResult;
 const result={...accepted(r.finishedAt!.toISOString(),[],[],plan).result,...r,
  _count:{transportAttempts:0,evidenceArtifacts:commit.artifacts.length,observations:1,paginationEvidence:commit.pagination.length,lossLedgerEntries:0,lifecycleSetMembers:r.dedupeOutputCount*2},
  batch:{id:r.batchId,releaseCandidateId:r.releaseCandidateId,kind:"SCHEDULED",status:"SUCCESS"}};
 const tuple={releaseCandidateId:r.releaseCandidateId,batchId:r.batchId,sourceId:r.sourceId,sourceResultId:r.id};
 const commands=commit.commands.filter(c=>c.type==="UPSERT_JOB");
 const members=commands.flatMap(c=>["CURRENT","VISIBLE"].map(setKind=>({...tuple,setKind,jobKey:c.dedupeKey,
  jobKeySha256:createHash("sha256").update(c.dedupeKey).digest("hex"),lifecycleStatus:"ACTIVE",missingCount:c.missingSuccessfulCrawlCount})));
 const jobs=commands.map(c=>({id:c.record.sourceJobId,companyId:plan.company.id,sourceId:plan.source.id,dedupeKey:c.dedupeKey,
  officialTitle:c.record.officialTitle,auxiliaryChineseTitle:null,humanCorrectedTitle:null,officialUrl:c.record.officialUrl,officialPublishedAt:null,
  city:c.record.cities[0],cities:c.record.cities,locationRaw:c.record.locationRaw,category:toPrismaJobCategory(c.record.category),humanCorrectedCategory:null,isNew:c.isNew,
  lastSeenAt:new Date(c.lastSeenAt),lifecycleStatus:"ACTIVE",visibleInFrontend:c.visibleInFrontend,missingSuccessCount:c.missingSuccessfulCrawlCount}));
 const options={currentTime:new Date(r.finishedAt!.getTime()+60_000)};
 return {plan,result,members,jobs,options,commit};
}

const results=[];
for(const [name,domain] of [["a775",a775Domain],["db56",db56Domain]] as const)for(const profile of JNJ_DOM_URL_PROFILES) {
 const f=await readerFixture(profile);
 const select=()=>domain.selectPortableSourceSnapshots([f.plan],[f.result] as any,f.options)[0]!;
 const project=()=>domain.projectPortableSourceJobs(select(),f.members as any,f.jobs as any,f.options);
 assert.equal(select().state,"PUBLISHING");assert.equal(project().visibleJobCount,21);
 f.result.completenessCertificateSha256="0".repeat(64);
 assert.equal(select().state,"HOLD");assert.equal(project().jobs.length,0);
 results.push({reader:name,profile,path:"UNCHANGED_DOMAIN_SELECTION_AND_PROJECTION",validState:"PUBLISHING",jobs:21,corruptState:"HOLD"});
}
for(const [name,read] of [["a775",a775Read],["db56",db56Read]] as const)for(const profile of JNJ_DOM_URL_PROFILES) {
 const f=await readerFixture(profile);
 const db={$transaction:async(work:any,options:any)=>{
  assert.equal(options.isolationLevel,"RepeatableRead");
  return work({crawlBatchSourceResult:{findMany:async()=>[f.result]},lifecycleSetEvidenceMember:{findMany:async()=>f.members},job:{findMany:async()=>f.jobs}});
 }};
 const good=await read(db as any,f.options,[f.plan]);
 assert.equal(good.totalJobs,21);assert.equal(good.sources.find(s=>s.sourceId===f.plan.source.id)!.state,"PUBLISHING");
 f.result.completenessCertificateSha256="0".repeat(64);
 const bad=await read(db as any,f.options,[f.plan]);
 assert.equal(bad.totalJobs,0);assert.equal(bad.sources.find(s=>s.sourceId===f.plan.source.id)!.state,"HOLD");
 results.push({reader:name,profile,path:"UNCHANGED_REPOSITORY_WITH_SYNTHETIC_REPEATABLE_READ",validState:"PUBLISHING",jobs:21,corruptState:"HOLD"});
}
const report={kind:"APPENDED_ARCHIVED_A775_DB56_READER_COMPATIBILITY_SYNTHETIC_ONLY",exactArchivedCommits:{a775:"a775d114668c466562660105ee52dc2306b6fdeb",db56:"db56d999d7068091303dafa7a788feb0af222c41"},results,actualRunningIdentityVerified:false,realDatabaseRead:false,cacheRefreshLifecycleTested:false,originalFourReaderReportUnchanged:true};
writeFileSync("READER_TEST_RESULTS.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
