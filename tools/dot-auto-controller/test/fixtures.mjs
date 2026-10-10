// Entirely synthetic fixtures, no production jobs, SQL, IDs, credentials or raw logs.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Journal,sha,canonical} from '../src/journal.mjs';
import {AutomaticController} from '../src/controller.mjs';
import {createOriginalExecObserver} from '../src/original-exec.mjs';
const iso=t=>new Date(t).toISOString();
export function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jobfinder-auto-test-'));let now=Date.parse('2026-01-02T12:00:00Z');
 const route={enabled:true,sourceId:'synthetic-source',sourceConfigSha256:sha('config'),route:'PORTABLE',projectId:'synthetic-project',candidate:{id:'synthetic-candidate',version:1},build:{contentSha256:sha('build')},databaseIdentity:{schemaHash:sha('schema')},registration:{id:'synthetic-candidate'},budgets:{wrapperMs:1800000,sourceMs:1200000,httpMs:45000,heapMiB:384}};
 const registry={sources:{synthetic:route}};
 const originalIdentity={originalSessionId:76543,originalLaunchSha256:sha('actual launch'),bindingSha256:sha('actual binding')};
 const observer=createOriginalExecObserver({now:()=>now,pollOriginal:async()=>({exit_code:0,output:'actual tool terminal'}),validateNativeChain:async()=>({wrapper:{exitCode:0},childChain:[{state:'TERMINATED',exitCode:0,reaped:true,launchSha256:sha('original native process')}]})});
 let prepared,dispatches=0,reads=0;
 const archiveRoot=path.join(root,'archive');fs.mkdirSync(archiveRoot);const bytes=Buffer.from('retained synthetic official response');fs.writeFileSync(path.join(archiveRoot,'original.bin'),bytes);
 const manifest=[{path:'original.bin',byteCount:bytes.length,sha256:sha(bytes)}];
 const snapshot=()=>({sourceId:route.sourceId,sourceConfigSha256:route.sourceConfigSha256,route:route.route,candidate:structuredClone(route.candidate),build:structuredClone(route.build),databaseIdentity:structuredClone(route.databaseIdentity),registration:structuredClone(route.registration),checkedAt:iso(now),lastAcceptedObservation:{basis:'CrawlObservation.crawledAt',sourceId:route.sourceId,observationId:'synthetic-observation',sourceResultId:'synthetic-result',batchId:'synthetic-old-batch',crawledAt:iso(now-13*3600000)}});
 const ports={
  readPreflight:async()=>snapshot(),
  captureAndPrepareNative:async({route:r,run,onOriginalExec})=>{
   onOriginalExec(originalIdentity);
   const grace={id:'old-grace',inGrace:true,title:'preserved old title',lastSeenAt:'2025-12-20T00:00:00Z',lastConfirmedObservedAt:'2025-12-20T00:00:00Z'};
   const projection={jobs:[{id:'fresh',inGrace:false,title:'current',detail:'all fields compared'},grace],coverage:{companies:[{id:'synthetic-company',current:1,grace:1}],totalJobs:2}};
   const body={schemaVersion:1,requestId:'synthetic-request',kind:'PUBLISH',expiresAt:iso(now+600000),payload:{projectId:r.projectId,dispatchBefore:iso(now+435000),sql:'SYNTHETIC_NO_EXECUTABLE_SQL'}};
   const request={...body,requestSha256:sha(JSON.stringify(body))};
   const proof={schemaVersion:1,identity:{sourceId:r.sourceId,sourceConfigSha256:r.sourceConfigSha256,route:r.route,candidate:r.candidate,build:r.build,batchId:run.batchId},nativeReplay:{module:'runtimeAtomicEvidence.verifyAtomicRuntimeCommitForPersistence',route:r.route},atomicCompiler:'ingestionRepository.compileDbStartedCloudSourcePublication',databaseMutex:'CrawlCoordinatorLock:formal-crawl:SAME_ATOMIC_DO',lifecyclePolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',ageBasedHide:false,archiveRoot,manifest,archiveVerification:{manifestSha256:sha(canonical(manifest)),fileCount:1},sourceObservedAt:iso(now),originalEvidenceExpiresAt:iso(now+1200000),readerReplay:{schemaVersion:1,deployedIdentity:{main:'synthetic-main',fallback:'synthetic-fallback'},mainCodeSha256:sha('main'),fallbackCodeSha256:sha('fallback'),readerInputSha256:sha('reader input'),clockAt:iso(now),main:projection,fallback:structuredClone(projection),priorGrace:[grace]}};
   prepared={ticket:{},request,proof,exactReadbackBinding:{batchId:run.batchId,sourceId:r.sourceId,requestSha256:request.requestSha256,terminalSha256:sha('synthetic original native commit')}};return prepared;
  },
  dispatch:async(ticket,gates)=>{dispatches++;await gates.verifyPublicationReady();gates.assertScope();return {status:'SUCCEEDED',rows:[]};},
  readExactOutcome:async binding=>{reads++;return {state:'COMMITTED_EXACT',binding,batchStatus:'SUCCESS',atomicCommittedCount:1,completenessVerifiedCount:1,originalHolderStillOwned:false};},
  readCurrentPublic:async()=>({mode:'CURRENT',cache:'no-store',complete:true,hasMore:false,observedAt:iso(now),deployedIdentity:prepared.proof.readerReplay.deployedIdentity,projection:structuredClone(prepared.proof.readerReplay.main)})
 };
 const journal=new Journal(path.join(root,'journal'));
 return {root,route,registry,ports,observer,journal,snapshot,originalIdentity,manifest,archiveRoot,get prepared(){return prepared;},get now(){return now;},advance:ms=>{now+=ms;},get dispatches(){return dispatches;},get reads(){return reads;},controller:()=>new AutomaticController({registry,journal,ports,observer,now:()=>now})};
}
