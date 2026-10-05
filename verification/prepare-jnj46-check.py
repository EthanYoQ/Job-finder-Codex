#!/usr/bin/env python3
"""Adapt the archived JNJ-only synthetic host check to its restored binding."""
from pathlib import Path
base=Path(__file__).resolve().parent.parent
host=base/'hosts46/jnj'
t=(host/'originals/check-host.mjs').read_text()
old='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z'
t=t.replace(old,str(base)).replace("root=join(base,'hosts')","root=join(base,'hosts46')").replace("const key='jnj42'","const key='jnj'")
t=t.replace("join(base,'hosts/portable42-following/runtime/start-monitor-portable42.js')","join(host,'originals/runtime/start-monitor-true-a42.js')")
start=t.index('const prior=spec.queueHint,')
end=t.index("\nif(requireDue(dueRow,cfg)",start)
fixture="""// Synthetic in-memory due-gate fixture. Never DB/bootstrap authority.
const dueAt=Date.parse('2026-10-05T12:00:00.000Z');
const fixtureSource={sourceResultId:'NONQUAL-SOURCE-RESULT',sourceId:cfg.sourceId,batchId:'NONQUAL-BATCH',releaseCandidateId:'NONQUAL-CANDIDATE',sourceConfigHash:cfg.sourceConfigSha256,startedAt:'2026-10-04T23:59:00.000Z',finishedAt:'2026-10-05T00:01:00.000Z'};
const o={id:'NONQUAL-OBSERVATION',sourceResultId:fixtureSource.sourceResultId,sourceId:cfg.sourceId,batchId:fixtureSource.batchId,releaseCandidateId:fixtureSource.releaseCandidateId,sourceConfigSha256:cfg.sourceConfigSha256,crawledAt:'2026-10-05T00:00:00.000Z',observedFrom:fixtureSource.startedAt,observedTo:fixtureSource.finishedAt,successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true};
const dueRow={checkedAt:new Date(dueAt).toISOString(),candidateRows:[],holderId:'',latestSuccessfulSource:{...fixtureSource,observations:[o]}};"""
t=t[:start]+fixture+t[end:]
t=t.replace("const {preflight}=await import", "const {preflight,validateBootstrapShape}=await import")
needle="const localPreflight=join(host,'_local-preflight-'+testId);"
t=t.replace(needle,"for(const batchId of [null,undefined,123])await rejects(()=>validateBootstrapShape({...bootstrap,batchId}),'PREFLIGHT_BOOTSTRAP_SCHEMA');\nvalidateBootstrapShape(bootstrap);ok('preflight rejects null, undefined and number batch IDs; accepts explicit normal ID');\n"+needle)
needle="await new A(loader)();"
t=t.replace(needle,needle+"\nconst loadState=await readFile(join(host,'runtime/load-host-state.js'),'utf8');\nfor(const candidateId of ['dot-cloud-restored-fb0b8e3-20261004',control.candidate.id.toLowerCase(),control.candidate.id+'-extra'])await rejects(()=>new A('root','sourceId','candidateId','commit',loadState)(host,cfg.sourceId,candidateId,control.build.commitSha),'HOST_LOAD_ARGUMENT');\nfor(const root of [host+'-similar',join(base,'hosts46/gsk')])await rejects(()=>new A('root','sourceId','candidateId','commit',loadState)(root,cfg.sourceId,control.candidate.id,control.build.commitSha),'HOST_LOAD_ARGUMENT');\nok('uppercase T/Z exact registered candidate accepted; old, lowercased and extended identities and wrong host roots rejected');")
needle=" state.set(prefix+'currentCaptureInput',captureDescriptor);\n await new A(starter)();"
t=t.replace(needle,""" state.set(prefix+'currentCaptureInput',captureDescriptor);
 for(const batchId of [null,undefined,123]){state.set(prefix+'nextBatchId',batchId);await rejects(()=>new A(starter)(),'BATCH_ID');}
 if(launchStubCalls||preflightStubCalls)throw Error('INVALID_BATCH_STARTED_OR_PREFLIGHTED');
 ok('starter rejects null, undefined and number batch IDs before save/preflight/launch');
 state.set(prefix+'nextBatchId',startBatch);
 state.set(prefix+'currentCaptureInput',{...captureDescriptor,sha256:'0'.repeat(64)});
 await rejects(()=>new A(starter)(),'JNJ_CURRENT_CAPTURE_HASH');
 state.set(prefix+'currentCaptureInput',captureDescriptor);
 const originalCheckedAt=dueRow.checkedAt;dueRow.checkedAt=new Date(dueAt-1).toISOString();
 await rejects(()=>new A(starter)(),'SOURCE_NOT_DUE');dueRow.checkedAt=originalCheckedAt;
 const originalCrawledAt=o.crawledAt;o.crawledAt='2026-10-05T00:00:00.500Z';
 await rejects(()=>new A(starter)(),'JNJ_CURRENT_CAPTURE_DUE_BINDING');o.crawledAt=originalCrawledAt;
 ok('starter rejects changed current-capture bytes, capture before actual due time and early actual observation gate');
 await new A(starter)();""")
needle="ok('original local command helper follows same session to terminal and preserves all output');"
t=t.replace(needle,needle+"\nlet unresolvedDispatches=0;globalThis.tools={exec_command:async()=>{unresolvedDispatches++;return {session_id:903,output:'first'};},write_stdin:async()=>{throw Error('LOCAL_TERMINAL_UNKNOWN');}};\nawait rejects(()=>h.cmd('LOCAL_TERMINAL_UNKNOWN_FIXTURE'),'LOCAL_TERMINAL_UNKNOWN');if(unresolvedDispatches!==1||state.get(prefix+'cloudHostLocalCommandOutcome').status!=='POLL_UNRESOLVED_NO_RETRY')throw Error('UNKNOWN_COMMAND_REPLAYED');\nok('unknown original-session terminal poll remains unresolved and never launches a replacement command');")
t=t.replace("{flag:'w',mode:0o600}","{flag:'wx',mode:0o600}")
t=t.replace("if(!dest.includes('review-publication.py')", "if(dest!=='check-host.mjs'&&!dest.includes('review-publication.py')")
with (host/'check-host.mjs').open('x') as f:f.write(t)
print('JNJ-only check restored; source and DB tools remain local stubs')
