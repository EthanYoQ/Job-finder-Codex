/** Original file relay remains data transport; only the owned live pipe is evidence. */
export const PREFIX='JOBFINDER_OWNED_PIPE_V1 ';
const HASH=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
const L=['projectId','candidateId','sourceId','batchId','buildSha256','launchChallenge','outerDeadline'];
const K=L.filter(k=>k!=='outerDeadline');
const B=[...L,'sourceResultId','requestId','requestSha256','sqlSha256','dispatchBefore','expiresAt'];
function require(ok,code){if(!ok)throw Error(code);}
function keys(o,expected){require(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...expected].sort().join(','),'PIPE_SCHEMA');}
function fields(o){
 require(o.projectId==='yiopvxysxrtrnvqxwgbx'&&o.sourceId==='source-takeda-china-social','PIPE_SCOPE');
 for(const k of ['candidateId','sourceId','batchId',...(o.sourceResultId!==undefined?['sourceResultId','requestId']:[])])require(typeof o[k]==='string'&&ID.test(o[k]),'PIPE_ID');
 for(const k of ['buildSha256','launchChallenge',...(o.sqlSha256!==undefined?['requestSha256','sqlSha256']:[])])require(typeof o[k]==='string'&&HASH.test(o[k]),'PIPE_HASH');
 for(const k of ['outerDeadline',...(o.expiresAt!==undefined?['dispatchBefore','expiresAt']:[])])require(Number.isSafeInteger(o[k])&&o[k]>0,'PIPE_TIME');
}
const same=(a,b)=>Object.keys(b).every(k=>a[k]===b[k]);
export function validateLaunchSeed(x){keys(x,K);const temp={...x,outerDeadline:1};fields(temp);return Object.freeze({...x});}
export function seedFromLaunch(x){validateLaunch(x);return validateLaunchSeed(Object.fromEntries(K.map(k=>[k,x[k]])));}
export function validateLaunch(x){keys(x,L);fields(x);return Object.freeze({...x});}
export function launchFromBinding(b){validateBinding(b);return validateLaunch(Object.fromEntries(L.map(k=>[k,b[k]])));}
export function validateBinding(x){keys(x,B);fields(x);require(x.dispatchBefore<x.expiresAt&&x.expiresAt<x.outerDeadline,'PIPE_DEADLINE_ORDER');return Object.freeze({...x});}
export function gateMessage(binding){return Object.freeze({type:'PRODUCER_REVIEW_CONSUMED_V1',binding:validateBinding(binding)});}
export function validateGateMessage(m,launch,now){keys(m,['type','binding']);require(m.type==='PRODUCER_REVIEW_CONSUMED_V1','PIPE_TYPE');const b=validateBinding(m.binding);require(same(b,launch),'PIPE_LAUNCH_BINDING');require(Number.isSafeInteger(now)&&now<b.dispatchBefore,'PIPE_DISPATCH_EXPIRED');return b;}
export function validateOutcomeMessage(m,review){
 keys(m,['type','tuple','readRequestSha256','responseSha256']);require(m.type==='PRODUCER_OUTCOME_VERIFIED_V1','PIPE_OUTCOME_TYPE');
 keys(m.tuple,['releaseCandidateId','batchId','sourceId','sourceResultId']);
 require(review&&m.tuple.releaseCandidateId===review.candidateId&&m.tuple.batchId===review.batchId&&m.tuple.sourceId===review.sourceId&&m.tuple.sourceResultId===review.sourceResultId,'PIPE_OUTCOME_TUPLE');
 require(HASH.test(m.readRequestSha256)&&HASH.test(m.responseSha256),'PIPE_OUTCOME_HASH');
 return Object.freeze({type:m.type,tuple:Object.freeze({...m.tuple}),readRequestSha256:m.readRequestSha256,responseSha256:m.responseSha256});
}
export function makeFrame(sequence,event,binding,detail={}){require(Number.isSafeInteger(sequence)&&sequence>=0,'PIPE_SEQUENCE');const text=JSON.stringify({schemaVersion:1,sequence,event,binding,...detail});require(text.length<=2048,'PIPE_FRAME_SIZE');return PREFIX+text+'\n';}
/** Default disabled. launch/poll are trusted composition dependencies, never config.
 * acceptExpectedRequest receives independently read original relay data, not authority.
 * No disk/log ingestion, resume-from-JSON or caller-fed frame method is exposed. */
export function createOwnedSessionConsumer({launch,toolsPort,mode='DISABLED',clock=Date.now}){
 const seed=validateLaunchSeed(launch),launchTool=toolsPort?.launch,pollTool=toolsPort?.poll;let l=null,status='DISABLED',session,started=false,sequence=0,buffer='',review=null,expected=null,outcome=null,expectedOutcome=null,outcomeConsumed=false,consumed=false,childEnded=false,toolEnded=false,childExit=null,childSignal=null,toolExit=null,held=false,last=-Infinity;
 const now=()=>{const n=clock();require(Number.isSafeInteger(n)&&n>=last,'PIPE_CLOCK');last=n;return n;};
 const fail=code=>{held=true;status='HOLD';throw Error(code);};
 const ready=()=>!!review&&!!expected&&buffer.length===0&&!consumed&&!held&&!childEnded&&!toolEnded&&now()<review.dispatchBefore;
 const snapshot=()=>Object.freeze({status,outerDeadline:l?.outerDeadline??null,reviewSeen:!!review,requestMatched:!!expected,outcomeSeen:!!outcome,outcomeMatched:!!expectedOutcome,outcomeConsumed,consumed,childEnded,toolEnded,childExit,childSignal,toolExit,held,sequence,dispatchAllowed:ready()});
 function chunk(r){
  require(r&&typeof r==='object','PIPE_TOOL_SHAPE');
  if(r.session_id!==undefined&&r.session_id!==session)fail('PIPE_FOREIGN_SESSION');
  if(r.exit_code!==undefined)require(Number.isInteger(r.exit_code),'PIPE_TOOL_EXIT');
  try {
  require(typeof r.output==='string'&&r.output.length<=65536,'PIPE_TOOL_SHAPE');
  if(r.output.includes('\r'))fail('PIPE_NOT_RAW_STREAM');buffer+=r.output;if(buffer.length>65536)fail('PIPE_BUFFER_SIZE');
  while(buffer.includes('\n')){
   const i=buffer.indexOf('\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+1);
   if(!line.startsWith(PREFIX)||line.length>PREFIX.length+2048)fail('PIPE_UNTRUSTED_OUTPUT');
   let f;try{f=JSON.parse(line.slice(PREFIX.length));}catch{fail('PIPE_FRAME_JSON');}
   keys(f,['schemaVersion','sequence','event','binding',...(f.event==='CHILD_TERMINAL'?['exitCode','signal']:[]),...(f.event==='OUTCOME_VERIFIED'?['outcome']:[])]);
   require(f.schemaVersion===1&&f.sequence===sequence++,'PIPE_SEQUENCE');
   if(f.event==='REVIEW_CONSUMED'){
    require(sequence>1&&l&&!review&&!childEnded,'PIPE_REVIEW_ORDER');review=validateGateMessage({type:'PRODUCER_REVIEW_CONSUMED_V1',binding:f.binding},l,now());status='REVIEW_OBSERVED';
   }else{
    validateLaunch(f.binding);require(same(f.binding,seed),'PIPE_LAUNCH_BINDING');
    if(f.event==='STARTED'){require(sequence===1&&!l&&!review&&!childEnded,'PIPE_START_ORDER');l=validateLaunch(f.binding);require(now()<l.outerDeadline,'PIPE_OUTER_EXPIRED');}
    else if(f.event==='OUTCOME_VERIFIED'){require(l&&same(f.binding,l)&&review&&!outcome&&!childEnded&&consumed,'PIPE_OUTCOME_ORDER');outcome=validateOutcomeMessage(f.outcome,review);}
    else if(f.event==='PROTOCOL_HOLD'){require(l&&same(f.binding,l),'PIPE_LAUNCH_BINDING');held=true;status='HOLD';}
    else if(f.event==='CHILD_TERMINAL'){
     require(l&&same(f.binding,l),'PIPE_LAUNCH_BINDING');require(sequence>1&&!childEnded&&(f.exitCode===null||Number.isInteger(f.exitCode))&&(f.signal===null||typeof f.signal==='string'),'PIPE_TERMINAL');
     childEnded=true;childExit=f.exitCode;childSignal=f.signal;status='CHILD_CLOSED_AWAIT_TOOL';if(childExit!==0||childSignal!==null)held=true;
    }else fail('PIPE_UNKNOWN_EVENT');
   }
  }
  } finally {
   // Transport termination survives malformed protocol output; foreign sessions do not.
   if(r.exit_code!==undefined){toolEnded=true;toolExit=r.exit_code;status='TOOL_ENDED';if(!childEnded||buffer.length||toolExit!==0)held=true;}
   if(l&&now()>=l.outerDeadline){held=true;status='HOLD';}
  }
 }
 return Object.freeze({snapshot,
  acceptExpectedRequest(value){try{require(review&&!held&&!childEnded&&!toolEnded&&!consumed,'PIPE_NO_LIVE_REVIEW');const v=validateBinding(value);require(same(v,review)&&same(review,v),'PIPE_RELAY_REQUEST_MISMATCH');expected=v;require(now()<review.dispatchBefore,'PIPE_DISPATCH_EXPIRED');status='REVIEW_READY';return snapshot();}catch(e){held=true;status='HOLD';throw e;}},
  acceptExpectedOutcome(value){try{require(outcome&&!held&&!outcomeConsumed,'PIPE_NO_LIVE_OUTCOME');const v=validateOutcomeMessage(value,review);require(v.readRequestSha256===outcome.readRequestSha256&&v.responseSha256===outcome.responseSha256,'PIPE_OUTCOME_TOOL_MISMATCH');expectedOutcome=v;return snapshot();}catch(e){held=true;status='HOLD';throw e;}},
  consumeOutcome(){require(outcome&&expectedOutcome&&!held&&!outcomeConsumed&&buffer.length===0,'PIPE_OUTCOME_NOT_VERIFIED');outcomeConsumed=true;return outcome;},
  consumeReview(){require(ready(),'PIPE_NOT_DISPATCHABLE');consumed=true;status='CONSUMED';return Object.freeze({...review});},
  async start(){require(!started,'PIPE_ALREADY_STARTED');started=true;require(mode==='TEST_ONLY'&&toolsPort?.kind==='TRUSTED_SYNTHETIC_TOOL_PORT','PIPE_REAL_PORT_DISABLED');require(typeof launchTool==='function'&&typeof pollTool==='function','PIPE_TOOL_PORT');status='STARTING';try{const r=await launchTool();require(r&&Number.isSafeInteger(r.session_id),'PIPE_LIVE_SESSION_REQUIRED');session=r.session_id;chunk(r);return snapshot();}catch(e){held=true;status='HOLD';throw e;}},
  async poll(){require(started&&session!==undefined&&!toolEnded,'PIPE_POLL_STATE');try{chunk(await pollTool(session));return snapshot();}catch(e){held=true;status='HOLD';throw e;}}
 });
}
