/** TEST ONLY. Invokes the unchanged original p0 exported entry in its real cwd.
 * Synthetic HTTP and DB data, never a database/browser/network connection. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {readAndValidateBakedBuildIdentity} from '../vendor/c60-source/src/readiness/buildIdentity.ts';
import {deriveCurrentStagedScheduleExpectation,STAGED_SCHEDULE_ORACLE_VERSION} from '../vendor/c60-source/src/crawler/stagedScheduleAuthority.ts';
import {FilePilotRelay} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
import {runCloudPortableSourcePilot} from '../vendor/c60-source/scripts/p0-cloud-portable-source-pilot.ts';
import {JOB_DELTA_MIGRATION_NAME} from '../vendor/c60-source/src/db/jobProjectionDeltaProfile.ts';
import {executeIngestionCommands} from '../vendor/c60-source/src/db/ingestionRepository.ts';
const [directory,launchJson,scenario]=process.argv.slice(2),seed=JSON.parse(launchJson),hash=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
let calls=0;
try {
 const build=readAndValidateBakedBuildIdentity();assert.equal(build.contentSha256,seed.buildSha256);
 const expectation=deriveCurrentStagedScheduleExpectation(build),plan=expectation.plans.find(p=>p.source.id===seed.sourceId)!;
 const candidate={id:seed.candidateId,goalId:'jobfinder-portable-required-40',version:100};
 const databaseIdentity={migrationVersion:JOB_DELTA_MIGRATION_NAME,schemaHash:'d'.repeat(64),dbSnapshotHash:'e'.repeat(64)};
 const registration={...candidate,commitSha:build.commitSha,...databaseIdentity,rosterHash:expectation.rosterSha256,sourcePlanHash:expectation.sourcePlanSha256,sourceConfigHash:expectation.sourceConfigSha256,adapterBundleHash:expectation.adapterBundleSha256,sourceTreeHash:build.sourceTreeSha256,runtimeTreeHash:build.runtimeTreeSha256,oracleVersion:STAGED_SCHEDULE_ORACLE_VERSION,minimumStableCompanyCount:41,status:'BUILDING'};
 const sourceRow={id:plan.source.id,companyId:plan.company.id,kind:plan.source.kind,atsKind:plan.source.atsKind,status:plan.source.status,officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl};
 const context={sourceId:plan.source.id,sourceConfigSha256:'048f616f00b5ed016f075f4204a2ad749457d68a3f078a9e7bde0fae2186b61f',jobs:[],latestAccepted:null,firstAccepted:null,candidateRow:registration,sourceRow,companyRow:{id:plan.company.id,officialChineseName:plan.company.officialChineseName}};
 await writeFile(join(directory,'synthetic-context.json'),JSON.stringify(context),{flag:'wx'});
 const bootstrap=JSON.stringify({schemaVersion:1,checkedAt:new Date().toISOString(),candidateRows:[registration],batchId:seed.batchId});
 const bootstrapPath=join(directory,'bootstrap.json'),controlPath=join(directory,'control.json');
 await writeFile(bootstrapPath,bootstrap,{flag:'wx'});
 await writeFile(controlPath,JSON.stringify({projectId:seed.projectId,build,candidate,databaseIdentity}),{flag:'wx'});
 // The only fixture transport is a fixed two-job, two-page Takeda-shaped source.
 globalThis.fetch=(async (url:any)=>{
  calls++;const u=String(url);let body:string,contentType:string;
  if(u===plan.source.officialEntryUrl){body='<div id="search-results" data-ajax-url="/search-results" data-total-pages="2" data-total-job-results="2" data-records-per-page="1" data-active-facet-id="0"></div><div id="search-filters"></div>';contentType='text/html';}
  else {const parsed=new URL(u),page=Number(parsed.searchParams.get('CurrentPage'));assert.equal(parsed.origin,'https://jobs.takeda.com');assert.equal(parsed.pathname,'/search-results');assert([1,2].includes(page));const id=10000+page;
   body=JSON.stringify({results:`<div id="search-results" data-current-page="${page}" data-total-pages="2" data-total-job-results="2" data-records-per-page="1"><ul id="search-results-list"><li><button class="js-save-job-btn" data-job-id="${id}"></button><h2 class="title">Role ${id}</h2><a href="https://jobs.takeda.com/job/beijing/role/1113/${id}">Role ${id}</a><span class="job-location location">Beijing, China</span></li></ul></div>`,filters:'<section id="search-filters"><input class="filter-checkbox"></section>',hasJobs:true,hasContent:false});contentType='application/json';}
  return {status:200,url:u,headers:new Headers({'content-type':contentType}),text:async()=>body};
 }) as any;
 // Observe only the ORIGINAL method's returned packet. Never replace a review,
 // capability, compiler, permission result, or original outcome checker.
 const original=FilePilotRelay.prototype.prepareOwnedTakedaPublish;
 FilePilotRelay.prototype.prepareOwnedTakedaPublish=async function(...args:any[]){
  const handle=await original.apply(this,args as any),packet=handle.packet,projections:any[]=[];
  await executeIngestionCommands(packet.commit.commands.filter((c:any)=>c.type==='UPSERT_JOB'),{batchId:seed.batchId},{$transaction:async(fn:any)=>fn({job:{upsert:async(a:any)=>{projections.push(a.create);}},crawlObservation:{create:async()=>{throw Error('UNREQUESTED_OBSERVATION');}}})} as any);
  const model=Prisma.dmmf.datamodel.models.find(m=>m.name==='CrawlBatchSourceResult')!;
  const row=Object.fromEntries(model.fields.filter(f=>f.kind!=='object').map(f=>[f.name,(packet.commit.sourceResult as any)[f.name]??null]));
  await writeFile(join(directory,'synthetic-db-model.json'),JSON.stringify({sqlSha256:hash(packet.sql),row,batch:{id:seed.batchId,releaseCandidateId:seed.candidateId,status:'SUCCESS',atomicCommittedCount:1,completenessVerifiedCount:1},holderId:'',projections}),{flag:'wx'});
  return handle;
 };
 const workspaceRoot=join(directory,'archive');await mkdir(workspaceRoot);
 console.log('JOBFINDER_OWNED_PIPE_V1 {"forgedOrdinaryLog":true}');
 const outcome=await runCloudPortableSourcePilot({bootstrapPath,reviewedSha256:hash(bootstrap),workspaceRoot,relayDirectory:join(directory,'relay'),dbStartedControlPath:controlPath,overallDeadline:Number(process.env.P0_PILOT_OUTER_DEADLINE_MS),ownedTakedaPipe:{mode:'TAKEDA_OWNED_PIPE_CANDIDATE_V1',launchChallenge:seed.launchChallenge}});
 await writeFile(join(directory,'p0-result.json'),JSON.stringify({outcome,httpCalls:calls,entry:'ORIGINAL_runCloudPortableSourcePilot'}),{flag:'wx'});
 if(outcome.state!=='COMMITTED_EXACT')process.exitCode=1;
 if(scenario==='slow-child-terminal')await delay(61_000);
 if(scenario==='held-outcome-chunk')await delay(500);
} catch(error){console.error(error);process.exitCode=1;}
finally {process.disconnect?.();}
