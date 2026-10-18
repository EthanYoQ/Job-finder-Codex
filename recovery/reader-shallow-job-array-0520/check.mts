import fs from 'node:fs';import assert from 'node:assert/strict';
import ts from '../five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/node_modules/typescript/lib/typescript.js';
import {JOB_SOURCE_UPDATE_FIELDS} from '../five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/domain/jobProjectionDeltaReceipt.ts';
const dir=new URL('.',import.meta.url),SOURCE='source-test';
const row=(id:string,title:string)=>({id,dedupeKey:SOURCE+':'+id,sourceId:SOURCE,officialTitle:title,cities:['上海'],category:'SALES',humanCorrectedCategory:null,lastSeenAt:'2026-10-18T05:00:00Z',officialPublishedAt:null});
const before={jobs:[row('unchanged','原岗位'),row('updated','旧标题')]},saved=structuredClone(before);
const changes=[{...row('unchanged','原岗位'),__update:{}},{...row('updated','旧标题'),__update:{officialTitle:'新标题',cities:['上海','北京']}},{...row('new','新增岗位'),__update:{}}];
function run(file:string){
 const source=fs.readFileSync(new URL(file,dir),'utf8');const block=source.slice(source.indexOf('const afterJobs='),source.indexOf('\nfunction single('));
 const js=ts.transpileModule(block,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let cloneCalls=0;const result=new Function('before','get','SOURCE','sourceFields','assert','structuredClone',js+'return {afterJobs,newJobs,updatedJobs};')(before,()=>changes,SOURCE,JOB_SOURCE_UPDATE_FIELDS,assert,(x:any)=>{cloneCalls++;return structuredClone(x);});
 const reviveBlock=source.slice(source.indexOf('function revive('),source.indexOf('\nconst results:any[]=[];'));const reviveJs=ts.transpileModule(reviveBlock,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const revive=new Function('dt',reviveJs+'return revive;')((x:any)=>x==null?x:new Date(x));
 const revived=revive({jobs:result.afterJobs,results:[]},(x:any)=>x);
 assert.notStrictEqual(result.afterJobs,before.jobs);assert.deepEqual(before,saved);assert.equal(result.newJobs,1);assert.equal(result.updatedJobs,1);return {...result,revived,cloneCalls};
}
const old=run('original-portable-reader-replay.before.mts'),current=run('original-portable-reader-replay.mts');assert.deepEqual(current.afterJobs,old.afterJobs);assert.deepEqual(current.revived,old.revived);assert.equal(old.cloneCalls,1);assert.equal(current.cloneCalls,0);assert.deepEqual(before,saved);
const report={completeJobRowsAndRevivedRowsEqual:true,originalBeforeUnchanged:true,inserted:1,updated:1,unchanged:1,jobDeepCloneCallsBefore:1,jobDeepCloneCallsAfter:0,network:false,databaseWrites:false};fs.writeFileSync(new URL('verification.json',dir),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
