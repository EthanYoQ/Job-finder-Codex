/** Classifier unit tests only. All data below are synthetic; NO DB is opened. */
import assert from 'node:assert/strict';
import {classifyFull49,FULL49_CASES} from './nativeFull49Acceptance.cli';
const ok=(command:string)=>({ok:true,results:[{command,rowCount:null,rows:[]}]});
const fail=(message:string,code='P0001')=>({ok:false,code,message});
function sample(caseId:string){
 const retired=!['retire_rollback','lock_timeout'].includes(caseId),published=['publish_commit','retire_rollback'].includes(caseId);
 const oldLedger=[{migration_name:'old',checksum:'old',finished_at:'2026-01-01',rolled_back_at:null,logs:'test'}];
 const added={migration_name:'20261014141000_v75_retired_candidate_fence',checksum:'b7c868b224ce1f13789f6f2cdcebafe95f1b2d83da1ac037d9a298cff79e3284',finished_at:'2026-01-01',rolled_back_at:null,logs:JSON.stringify({synthetic:true,appliedBy:'native-full49-test-runner'})};
 const before={oldSource:{id:'old'},oldObservations:[{id:'old-observation'}],jobs:[{id:'job',officialTitle:'old'}],ledger:oldLedger};
 const newSource={id:'new',atomicCommitState:'COMMITTED'},newJobs=[{id:'job',officialTitle:'new'}];
 const e:any={mode:'FULL49_NATIVE_REAL_PUBLISHER',case:caseId,nativeReplay:true,realBaselineCommitted:true,productionQualified:false,
  AIdentity:{pid:100,txid:'1000',started:'2026-01-01T00:00:00Z'},BIdentity:{pid:101,txid:'1001',started:'2026-01-01T00:00:01Z'},
  edge:{blockedPid:101,blockers:[100],aActive:true,bActive:true,observedAt:'2026-01-01T00:00:02Z'},AFinished:'2026-01-01T00:00:03Z',BFinished:'2026-01-01T00:00:04Z',before,
  after:{...before,observedAt:'2026-01-01T00:00:05Z',candidateStatus:retired?'INVALIDATED':'BUILDING',ledgerCount:retired?50:49,ledger:retired?[...oldLedger,added]:oldLedger,fenceFunction:retired,fenceTrigger:retired,formalHolder:'',lateCloneCount:0,newSource:published?newSource:null,newCounts:{CrawlBatch:published?1:0,CrawlBatchSourceResult:published?1:0,CrawlObservation:published?1:0},jobs:published?newJobs:before.jobs},
  expectedPublishedJobs:newJobs,expectedPublishedSource:newSource,fenceProfileVerified:retired,ARelease:ok('COMMIT'),BOperation:ok('DO'),BRelease:ok('COMMIT')};
 if(caseId==='publish_rollback')e.ARelease=ok('ROLLBACK');
 if(caseId==='retire_commit')e.BOperation=fail('PILOT_MIGRATION_HISTORY');
 if(caseId==='retire_rollback')e.ARelease=fail('TEST_RETIREMENT_INJECTED_FAILURE');
 if(caseId==='deferred_commit_failure')e.ARelease=fail('JOB_DELTA_COMMIT_PROJECTION_MISMATCH');
 if(caseId==='lock_timeout'){e.ARelease=ok('ROLLBACK');e.BOperation=fail('canceling statement due to lock timeout','55P03');}
 if(caseId==='post_retire_trigger_atomicity')e.BOperation=fail('V75_FENCE_CANDIDATE_RETIRED');
 return e;
}
let passed=0;
for(const c of FULL49_CASES){assert.equal(classifyFull49(sample(c)).status,'PASS_FULL49_NATIVE_CASE');passed++;}
const negatives:Array<[string,(e:any)=>void]>=[
 ['client overlap only',e=>{e.edge=null;e.clientOverlap=true;}],['same PID',e=>e.BIdentity.pid=100],['same txid',e=>e.BIdentity.txid='1000'],
 ['wrong DB time',e=>e.BIdentity.started='2026-01-01T00:00:10Z'],['missing commit ack',e=>e.ARelease=ok('ROLLBACK')],
 ['reduced masquerading',e=>e.mode='REDUCED_SCHEMA_LOCK_AND_ATOMICITY_ONLY'],['baseline not committed',e=>e.realBaselineCommitted=false],
 ['history changed',e=>e.after.oldSource={id:'changed'}],['old ledger modified',e=>e.after.ledger[0]={migration_name:'changed'}],
 ['wrong new checksum',e=>e.after.ledger[1].checksum='0'.repeat(64)],['not exact source',e=>e.after.newSource={...e.after.newSource,id:'other'}],
 ['clone residue',e=>e.after.lateCloneCount=1],['no fence profile',e=>e.fenceProfileVerified=false]
];
for(const [name,mutate] of negatives){const e=sample('publish_commit');mutate(e);assert.throws(()=>classifyFull49(e),name);passed++;}
const wrongGuard=sample('retire_commit');wrongGuard.BOperation=fail('V75_FENCE_CANDIDATE_RETIRED');assert.throws(()=>classifyFull49(wrongGuard));passed++;
const parentGuard=sample('post_retire_trigger_atomicity');parentGuard.BOperation=fail('source result parent batch is terminal');assert.throws(()=>classifyFull49(parentGuard));passed++;
console.log(JSON.stringify({scope:'OFFLINE_CLASSIFIER_UNIT_ONLY',passed,databaseExecutions:0,nativeConcurrencyPassed:false}));
