import assert from 'node:assert/strict';
import {readPortablePublicSnapshot as oldRead} from '../inactive-reader-three-clones-20261018T0620Z/candidate/src/db/portablePublicSnapshotRepository.ts';
import {readPortablePublicSnapshot as newRead} from './candidate/src/db/portablePublicSnapshotRepository.ts';
import {accepted,job,plan,NOW} from '../five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/tests/helpers/portablePublicSnapshotFixture.ts';
const originalClone=globalThis.structuredClone;
async function run(read){
 const f=accepted(), data={results:[f.result],members:f.members,jobs:[job()]};
 const before=originalClone(data),queries=[],events=[];let clones=0;
 const tx={};for(const [name,key] of [['crawlBatchSourceResult','results'],['lifecycleSetEvidenceMember','members'],['job','jobs']]) tx[name]={findMany:async q=>{queries.push([name,q]);return data[key];}};
 const db={$transaction:async(fn,options)=>{events.push(options);return fn(tx);}};
 globalThis.structuredClone=(...a)=>{clones++;return originalClone(...a);};
 let result;try{result=await read(db,{currentTime:NOW},[plan],undefined,undefined,async()=>events.push('yield'));}finally{globalThis.structuredClone=originalClone;}
 assert.deepEqual(data,before);assert.equal(result.totalJobs,1);assert.equal(result.sources[0].state,'PUBLISHING');return{result,queries,events,clones};
}
const old=await run(oldRead),fresh=await run(newRead);
assert.deepEqual(fresh.result,old.result);assert.deepEqual(fresh.queries,old.queries);assert.equal(old.events[0].timeout,10000);assert.deepEqual(fresh.events[0],{isolationLevel:"RepeatableRead",maxWait:5000,timeout:30000});assert.deepEqual(fresh.events.slice(1),old.events.slice(1));assert.equal(old.clones,fresh.clones);
console.log(JSON.stringify({pass:true,totalJobs:fresh.result.totalJobs,oldCloneCalls:old.clones,newCloneCalls:fresh.clones,outputQueriesYieldEqual:true,oldTimeout:old.events[0].timeout,newTimeout:fresh.events[0].timeout,fixtureInputUnchanged:true}));
