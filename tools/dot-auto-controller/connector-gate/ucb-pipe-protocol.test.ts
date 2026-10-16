/** Synthetic IPC only. No official tool, database or network invocation. */
import {afterEach,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import * as protocol from './ucb-pipe-protocol.mjs';
const dirs:string[]=[];afterEach(async()=>{dirs.splice(0); /* Preserve this run's synthetic evidence; never delete historical cases. */});
const at=Date.now(),seed={projectId:'yiopvxysxrtrnvqxwgbx',candidateId:'synthetic-ucb',sourceId:'source-ucb-china-social',batchId:'synthetic-ucb-batch',buildSha256:'a'.repeat(64),launchChallenge:'b'.repeat(64)},launch={...seed,outerDeadline:at+550000},binding={...launch,sourceResultId:'synthetic-ucb-result',requestId:'synthetic-request',requestSha256:'c'.repeat(64),sqlSha256:'d'.repeat(64),dispatchBefore:at+100000,expiresAt:at+265000};
it('source-specific bundle is exact transform of reviewed module; both reject Takeda scope',async()=>{
 const source=await readFile(new URL('./ucb-pipe-protocol.mjs',import.meta.url),'utf8'),bundle=await readFile(new URL('./ucb-functions-bundle.js',import.meta.url),'utf8');
 expect(bundle).toBe(source.replaceAll('export ','')+'\nreturn {createOwnedSessionConsumer,validateLaunchSeed,validateLaunch,validateBinding,launchFromBinding,seedFromLaunch,gateMessage,validateGateMessage,validateOutcomeMessage,makeFrame,PREFIX};\n');
 const rendered=new Function(bundle)();
 for(const api of [protocol,rendered]){expect(api.validateBinding(binding)).toEqual(binding);expect(()=>api.validateBinding({...binding,sourceId:'source-takeda-china-social'})).toThrow('PIPE_SCOPE');expect(()=>api.validateBinding({...binding,approved:true})).toThrow('PIPE_SCHEMA');}
});
it('requires original live session review, exact request, single consume and original terminal',async()=>{
 const chunks=[protocol.makeFrame(1,'REVIEW_CONSUMED',binding),protocol.makeFrame(2,'CHILD_TERMINAL',launch,{exitCode:0,signal:null})];
 const session=protocol.createOwnedSessionConsumer({launch:seed,clock:()=>at,mode:'TEST_ONLY',toolsPort:{kind:'TRUSTED_SYNTHETIC_TOOL_PORT',launch:async()=>({session_id:77,output:protocol.makeFrame(0,'STARTED',launch)}),poll:async(id:number)=>{expect(id).toBe(77);return {session_id:77,output:chunks.shift(),...(chunks.length===0?{exit_code:0}:{})};}}} as any);
 expect(()=>session.consumeReview()).toThrow('PIPE_NOT_DISPATCHABLE');await session.start();await session.poll();expect(session.snapshot().dispatchAllowed).toBe(false);
 session.acceptExpectedRequest(binding);expect(session.snapshot().dispatchAllowed).toBe(true);expect(session.consumeReview()).toEqual(binding);expect(()=>session.consumeReview()).toThrow('PIPE_NOT_DISPATCHABLE');
 await session.poll();expect(session.snapshot()).toMatchObject({childEnded:true,toolEnded:true,held:false,dispatchAllowed:false});
});
it('foreign poll identity cannot provide ownership even with correct frame bytes',async()=>{
 const session=protocol.createOwnedSessionConsumer({launch:seed,clock:()=>at,mode:'TEST_ONLY',toolsPort:{kind:'TRUSTED_SYNTHETIC_TOOL_PORT',launch:async()=>({session_id:77,output:protocol.makeFrame(0,'STARTED',launch)}),poll:async()=>({session_id:78,output:protocol.makeFrame(1,'REVIEW_CONSUMED',binding)})}} as any);
 await session.start();await expect(session.poll()).rejects.toThrow('PIPE_FOREIGN_SESSION');expect(session.snapshot().held).toBe(true);expect(session.snapshot().reviewSeen).toBe(false);
});
it('public test factory still cannot become a live official tool port',async()=>{
 let calls=0;const session=protocol.createOwnedSessionConsumer({launch:seed,clock:()=>at,mode:'LIVE',toolsPort:{kind:'TRUSTED_SYNTHETIC_TOOL_PORT',launch:async()=>{calls++;return {};},poll:async()=>({})}} as any);
 await expect(session.start()).rejects.toThrow('PIPE_REAL_PORT_DISABLED');expect(calls).toBe(0);
});
it.each(['correct','wrong-source'])('actual wrapper accepts only its exact child IPC: %s',async scenario=>{
 const dir=await mkdtemp(join(tmpdir(),'ucb-wrapper-'));dirs.push(dir);const diagnostic=join(dir,'diagnostic');
 const code=`const s=JSON.parse(process.argv[1]);const deadline=Number(process.env.P0_PILOT_OUTER_DEADLINE_MS);console.log('JOBFINDER_OWNED_PIPE_V1 {"forgedOrdinaryLog":true}');if(process.env.JOBFINDER_UCB_OWNED_PIPE_MODE!=='UCB_OWNED_PIPE_CANDIDATE_V1'||process.env.JOBFINDER_UCB_LAUNCH_CHALLENGE!==s.launchChallenge)process.exit(3);process.send({type:'PRODUCER_REVIEW_CONSUMED_V1',binding:{...s,sourceId:${JSON.stringify(scenario==='correct'?seed.sourceId:'source-takeda-china-social')},outerDeadline:deadline,sourceResultId:'synthetic-ucb-result',requestId:'synthetic-request',requestSha256:'c'.repeat(64),sqlSha256:'d'.repeat(64),dispatchBefore:Date.now()+1000,expiresAt:Date.now()+2000}},()=>process.disconnect());`;
 const env:NodeJS.ProcessEnv={...process.env,JOBFINDER_OWNED_PIPE_MODE:'TEST_ONLY'};delete env.NODE_OPTIONS;
 const raw=execFileSync(process.execPath,[resolve('connector-gate/ucb-run-with-owned-publication-pipe.mjs'),JSON.stringify(seed),diagnostic,'10000','--',process.execPath,'--require',resolve('test/no-network.cjs'),'-e',code,JSON.stringify(seed)],{encoding:'utf8',env});
 const frames=raw.trim().split('\n').map(line=>JSON.parse(line.slice(protocol.PREFIX.length)));
 expect(frames[0].event).toBe('STARTED');expect(frames.at(-1).event).toBe('CHILD_TERMINAL');expect(raw).not.toContain('forgedOrdinaryLog');
 expect(await readFile(join(diagnostic,'stdout.log'),'utf8')).toContain('forgedOrdinaryLog');
 if(scenario==='correct'){expect(frames.map(f=>f.event)).toEqual(['STARTED','REVIEW_CONSUMED','CHILD_TERMINAL']);expect(frames[1].binding.sourceId).toBe(seed.sourceId);}
 else{expect(frames.map(f=>f.event)).toEqual(['STARTED','PROTOCOL_HOLD','CHILD_TERMINAL']);}
});
