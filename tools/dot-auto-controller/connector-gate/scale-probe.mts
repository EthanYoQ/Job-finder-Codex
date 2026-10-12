/** One bounded synthetic measurement. No original raw captures, SQL execution,
 * database, credentials, artificial freshness, fake clock, or live transport. */
import {performance} from 'node:perf_hooks';
import {getHeapStatistics} from 'node:v8';
import {rm} from 'node:fs/promises';
import {initialize,configureSyntheticFixtureRuntime,fixture,request,dirs} from './synthetic-fixture.mts';
import {prepareTakedaConnectorPublicationReview,consumeReviewedTakedaPublication} from './takeda-publication-review.mts';
const start=performance.now();let phase='INITIALIZE';
function checkpoint(label:string,extra:Record<string,unknown>={}){console.log(JSON.stringify({label,elapsedMs:Math.round(performance.now()-start),maxRssKiB:process.resourceUsage().maxRSS,memory:process.memoryUsage(),...extra}));}
try{
 checkpoint('SYNTHETIC_SCALE_START',{node:process.version,execArgv:process.execArgv,heapLimitBytes:getHeapStatistics().heap_size_limit,network:false,database:false,mode:'UNPUBLISHED'});
 initialize();checkpoint('INITIALIZED');phase='OWNED_SYNTHETIC_CAPTURE';
 configureSyntheticFixtureRuntime({setClock:at=>{if(Math.abs(Date.now()-Date.parse(at))>1000)throw Error('TEST_ONLY_REAL_CLOCK_REQUIRED');},installFetch:fn=>{globalThis.fetch=fn as typeof fetch;},phase:label=>{phase=label;checkpoint(label);}});
 const f=await fixture({at:new Date().toISOString(),ids:Array.from({length:116},(_,i)=>String(20000+i)),pageSize:5,paddingBytes:348000});
 checkpoint('OWNED_SYNTHETIC_CAPTURE',{artifacts:f.input.publication.source.artifacts.length,artifactBytes:f.input.publication.source.artifacts.reduce((n,a)=>n+a.byteCount,0),archiveBytes:f.input.archive.bundleByteCount,jobs:f.input.publication.source.result.jobs.length,httpCalls:f.httpCalls()});
 phase='PREPARE';const prepared=await prepareTakedaConnectorPublicationReview(f.input);checkpoint('PREPARED',{sqlBytes:Buffer.byteLength(prepared.packet.sql)});
 phase='REVIEW';const r=request(prepared.packet),token=await prepared.review(r);checkpoint('REVIEWED');
 phase='CONSUME';await consumeReviewedTakedaPublication(token,r);checkpoint('SYNTHETIC_SCALE_PASS',{status:'OFFLINE_COMPONENT_MEASUREMENT_ONLY',liveQualification:false,activation:false});
}catch(error){checkpoint('SYNTHETIC_SCALE_FAIL',{phase,error:String(error),liveQualification:false,activation:false});process.exitCode=1;}
finally{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));}
