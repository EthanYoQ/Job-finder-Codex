import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const A=Object.getPrototypeOf(async function(){}).constructor;
const {runOriginalSerial}=await new A(readFileSync(new URL('./automatic-relay-functions.js',import.meta.url),'utf8'))();
function terminal(){return {sourceId:'source-novo',deadline:Date.now()+60000,stage:{h:{cfg:{project:'yiopvxysxrtrnvqxwgbx',sourceId:'source-novo'},next:async()=>null}},pollProducer:async()=>({exitCode:1})};}
let calls=[];
const result=await runOriginalSerial(['held','recent','prelaunch'],async id=>{if(id==='held')return terminal();if(id==='prelaunch')throw Error('KNOWN_PRELAUNCH_REJECTION');return {skip:'REAL_OBSERVATION_WITHIN_12H'};},async(id,r)=>{calls.push(id);assert.equal(r.status,'HELD');return {outcome:'COMMITTED_EXACT',verifiedClosedCount:4};});
assert.deepEqual(calls,['held']);assert.equal(result[0].status,'HELD');assert.equal(result[0].jobVerification.verifiedClosedCount,4);assert.equal(result.length,3);
calls=[];let prepared=0;
await runOriginalSerial(['unknown','next'],async()=>{prepared++;const e=Error('SESSION_LOST');e.producerStateUnconfirmed=true;throw e;},async id=>calls.push(id));
assert.equal(prepared,1);assert.deepEqual(calls,[]);
prepared=0;const uncertain=await runOriginalSerial(['one','two'],async()=>{prepared++;return terminal();},async()=>({outcome:'UNKNOWN'}));
assert.equal(prepared,1);assert.equal(uncertain[0].jobVerification.outcome,'UNKNOWN');
prepared=0;await runOriginalSerial(['one','two'],async()=>{prepared++;return terminal();},async()=>{throw Error('verification response lost');});assert.equal(prepared,1);
console.log('PASS: confirmed producer terminal hook; recent/prelaunch/uncertain producer skip; closure UNKNOWN/throw stop; source outcome retained');
