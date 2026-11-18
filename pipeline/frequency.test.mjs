import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {slotAt,timerBelongsToSlot} from './frequency.mjs';
import {runRefresh} from './refresh.ts';
import {SOURCE_QUALITY_POLICY_ID} from '../web-candidate/src/crawler/sourceQualityAdmission.ts';
import {PORTABLE_COVERAGE_POLICY_ID} from '../web-candidate/src/release/portableCoveragePolicy.ts';
import {searchPortableSnapshot,coverageFromPortableSnapshot} from '../web-candidate/src/server/portablePublicationApi.ts';
import {createRefreshStatusReader} from '../web-candidate/src/server/savedRefreshStatus.ts';
import {installSavedSnapshot} from '../web-candidate/src/server/savedPublicSnapshot.ts';

const midnight = Date.parse('2026-11-14T00:01:00+08:00');
const next = Date.parse('2026-11-15T00:01:00+08:00');
const catalog=JSON.parse(readFileSync(new URL('../runner-candidate/sources.json',import.meta.url),'utf8')).rows;
const fullCoverage=catalog.map(row=>({sourceId:row.sourceId,batchId:'test-'+row.sourceId}));

test('the timer and retry slots both use Beijing 00:01', () => {
  const timer = readFileSync(new URL('./jobfinder-refresh.timer', import.meta.url), 'utf8');
  assert.deepEqual(timer.match(/^OnCalendar=.*$/gm), ['OnCalendar=*-*-* 16:01:00 UTC','OnCalendar=*-*-* *:00/5:00 UTC']);
  assert.equal(slotAt(midnight-1), Date.parse('2026-11-13T00:01:00+08:00'));
  assert.equal(slotAt(midnight), midnight);
  assert.equal(slotAt(Date.parse('2026-11-14T12:01:00+08:00')), midnight);
  assert.equal(slotAt(next-1), midnight);
  assert.equal(slotAt(next), next);
});

test('a delayed retry retains the same timer provenance until the next daily slot', () => {
  const triggered = midnight + 1_000;
  assert.equal(timerBelongsToSlot(triggered, midnight, next-1), true);
  assert.equal(timerBelongsToSlot(triggered, next, next), false);
  assert.equal(timerBelongsToSlot(triggered, midnight, midnight), false);
  assert.equal(timerBelongsToSlot(NaN, midnight, midnight), false);
});

async function refreshFixture(t,{complete=false,retryAt=midnight+120*60_000}={}) {
  const cache=fileURLToPath(new URL('../.runtime/.cache/',import.meta.url));
  await mkdir(cache,{recursive:true});
  const directory=await mkdtemp(join(cache,'daily-refresh-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const target=join(directory,'public.json'),stateFile=target+'.schedule.json';
  const legacy={timerSlots:[String(midnight)],records:[],dailySince:'2026-11-14T00:01:00+08:00',qualifyingDays:[]};
  await writeFile(stateFile,JSON.stringify(legacy));
  const snapshot={schemaVersion:'portable-public-snapshot-v1',policyId:SOURCE_QUALITY_POLICY_ID,
    coveragePolicyId:PORTABLE_COVERAGE_POLICY_ID,generatedAt:new Date(midnight).toISOString(),lastUpdatedAt:null,totalJobs:0,
    companies:[],sources:[],coverage:{companyCount:0,requiredCompanyCount:0,excludedCompanyCount:0,
      requiredSourceCount:0,excludedSourceCount:0,expectedSourceCount:0,sourceCount:0,unplannedSourceCount:0,
      publishingSourceCount:0,unsupportedSourceCount:0,heldSourceCount:0}};
  const bytes=JSON.stringify(snapshot),sha256=createHash('sha256').update(bytes).digest('hex');
  const receipt={slot:String(midnight),complete,snapshotFile:`/data/job-finder/snapshots/public-${sha256}.json`,sha256,
    generatedAt:snapshot.generatedAt,lastUpdatedAt:null,totalJobs:0,
    capturedSources:complete?fullCoverage:fullCoverage.slice(1),unresolvedCoverage:!complete,
    retrySources:complete?[]:[{sourceId:fullCoverage[0].sourceId,retryAt}],
    nextRetryAt:complete?undefined:retryAt};
  const calls=[],reports=[],snapshotPulls=[],jobs=new Map(),receipts=new Map();
  t.mock.method(console,'log',value=>reports.push(JSON.parse(value)));
  t.mock.method(console,'error',value=>reports.push(JSON.parse(value)));
  const readState=async()=>JSON.parse(await readFile(stateFile,'utf8'));
  const options={now:midnight+1000,env:{INSTABOX_API_KEY:'SYNTHETIC_TEST_KEY',JOBFINDER_PUBLIC_SNAPSHOT_FILE:target,
    JOBFINDER_VERIFY_BASE_URL:'https://synthetic.invalid'},
    installSnapshot:async(...args)=>{
      try {await installSavedSnapshot(...args);}
      catch(error){
        // Windows cannot fsync a directory. Linux CI uses the unmodified durability check.
        if(process.platform!=='win32'||error.message!=='PUBLIC_SNAPSHOT_DURABILITY_UNCONFIRMED')throw error;
        assert.equal(await readFile(target,'utf8'),bytes);
      }
    },
    execute:async(_cli,args)=>{
      calls.push(args[0]);
      const state=await readState();
      assert.match(state.active.roundId,/^[a-f0-9]{32}$/);
      if(args[0]==='pull'){
        const round=args[2].match(/\/round-([a-f0-9]{32})\.json$/)?.[1];
        if(round) {
          const result=receipts.get(round);
          if(!result)throw Error('SYNTHETIC_NOT_FOUND');
          await writeFile(args[3],JSON.stringify(result));
        } else {
          assert.equal(args[2],receipt.snapshotFile);
          snapshotPulls.push(args[2]);
          await writeFile(args[3],bytes);
        }
      } else if(args[0]==='exec'){
        assert.equal(args.at(-1),state.active.roundId);
        const jobId=`synthetic-job-${jobs.size+1}`;
        jobs.set(jobId,{...receipt,slot:args.at(-2),roundId:args.at(-1)});
        return {stdout:JSON.stringify({jobId}),stderr:''};
      } else if(args[0]==='jobs'){
        assert.equal(state.active.jobId,args[3]);
        const result=jobs.get(args[3]);
        receipts.set(result.roundId,result);
      } else {
        assert.ok(['wake','resume'].includes(args[0]));
      }
      return {stdout:'',stderr:''};
    },
    acquireActivityLease:async()=>{calls.push('lease');return async()=>{calls.push('release');};},
    request:async url=>{
      calls.push('readback');
      const query=Object.fromEntries(url.searchParams);
      let expected;
      if(url.pathname==='/api/search'){
        assert.deepEqual(query,{city:'全部城市',sort:'COMPANY_PINYIN_ASC',limit:'50',offset:'0',province:'全部地区'});
        expected=searchPortableSnapshot(query,snapshot);
      }else{
        assert.equal(url.pathname,'/api/coverage');
        assert.deepEqual(query,{keyword:'',offset:'0',limit:'60'});
        expected=coverageFromPortableSnapshot({keyword:query.keyword,offset:Number(query.offset),limit:Number(query.limit)},snapshot);
      }
      return Response.json({...expected,snapshotStorage:'SAVED'});
    }};
  const setComplete=()=>Object.assign(receipt,{complete:true,capturedSources:fullCoverage,unresolvedCoverage:false,
    retrySources:[],nextRetryAt:undefined});
  return {target,stateFile,legacy,options,calls,reports,readState,snapshotPulls,jobs,receipts,receipt,setComplete};
}

test('a two-hour cooldown causes no collector wakes before its persisted deadline',async t=>{
  const fixture=await refreshFixture(t);
  assert.equal(await runRefresh(fixture.options),0,JSON.stringify(fixture.reports));
  const state=await fixture.readState();
  assert.deepEqual(state.progress,{slot:String(midnight),nextRetryAt:fixture.receipt.nextRetryAt});
  assert.equal(state.records.length,1);
  assert.equal(state.records[0].complete,false);
  assert.equal(state.records[0].webReadback,true);
  assert.equal(state.records[0].unresolvedCoverage,true);
  assert.equal(state.dailySince,fixture.legacy.dailySince);
  const before=fixture.calls.length;
  for(const minutes of [5,40,80,119]){
    assert.equal(await runRefresh({...fixture.options,now:midnight+minutes*60_000}),0);
  }
  assert.equal(fixture.calls.length,before);
  assert.deepEqual(await fixture.readState(),state);
  fixture.setComplete();
  assert.equal(await runRefresh({...fixture.options,now:state.progress.nextRetryAt}),0);
  assert.equal(fixture.calls.filter(call=>call==='exec').length,2);
  assert.equal(fixture.snapshotPulls.length,1);
  const publicStatus=await createRefreshStatusReader(fixture.target)();
  assert.equal(publicStatus.status,'AVAILABLE');
  assert.equal(publicStatus.records[0].complete,true);
  assert.equal('active' in publicStatus,false);
});

test('three missed wakes keep one reserved round and do not exhaust source retry',async t=>{
  const fixture=await refreshFixture(t);
  let wakes=0,resumes=0;
  const roundIds=new Set();
  const execute=async(_cli,args)=>{
    roundIds.add((await fixture.readState()).active.roundId);
    if(args[0]==='wake'){
      wakes++;
      throw Error('SYNTHETIC_WAKE_FAILED');
    }
    assert.equal(args[0],'resume');
    resumes++;
    throw Error('SYNTHETIC_RESUME_FAILED');
  };
  for(const minutes of [0,5,10]){
    assert.equal(await runRefresh({...fixture.options,now:midnight+minutes*60_000,execute}),75);
  }
  assert.equal(await runRefresh({...fixture.options,now:midnight+11*60_000,execute}),0);
  assert.equal(wakes,3);assert.equal(resumes,3);
  assert.equal(roundIds.size,1);
  assert.equal(await runRefresh({...fixture.options,now:midnight+15*60_000}),0);
  assert.equal(fixture.jobs.size,1);
  assert.equal(fixture.jobs.values().next().value.roundId,[...roundIds][0]);
});

test('when wake fails for a manually suspended machine, refresh falls back to resume and succeeds',async t=>{
  const fixture=await refreshFixture(t);
  let woke=0,resumed=0;
  const execute=async(cli,args)=>{
    if(args[0]==='wake'){woke++;throw Error('MACHINE_MANUALLY_SUSPENDED');}
    if(args[0]==='resume'){resumed++;}
    return fixture.options.execute(cli,args);
  };
  assert.equal(await runRefresh({...fixture.options,execute}),0);
  assert.equal(woke,1);assert.equal(resumed,1);
  assert.deepEqual(fixture.calls.slice(0,2),['resume','lease']);
  assert.equal((await fixture.readState()).progress.slot,String(midnight));
});

test('a failed readback retries the same installed snapshot without a collector wake',async t=>{
  const fixture=await refreshFixture(t);
  assert.equal(await runRefresh({...fixture.options,request:async()=>Response.json({wrong:'snapshot'})}),75);
  const state=await fixture.readState();
  assert.equal(state.active.publication.sha256,fixture.receipt.sha256);
  assert.deepEqual(state.records,[]);
  const before=fixture.calls.filter(call=>call==='wake').length;
  assert.equal(await runRefresh({...fixture.options,now:state.infrastructureRetryAt}),0);
  assert.equal(fixture.calls.filter(call=>call==='wake').length,before);
  assert.equal((await fixture.readState()).records[0].sha256,fixture.receipt.sha256);
  assert.equal(fixture.snapshotPulls.length,1);
});

test('a completed wave is a successful no-op until next Beijing slot',async t=>{
  const fixture=await refreshFixture(t,{complete:true});
  await writeFile(fixture.stateFile,JSON.stringify({...fixture.legacy,
    dailyAttempt:{slot:String(midnight),count:2,status:'RESERVED'}}));
  assert.equal(await runRefresh(fixture.options),0);
  assert.equal((await fixture.readState()).progress.nextRetryAt,null);
  assert.equal(fixture.calls.filter(call=>call==='exec').length,1);
  const before=fixture.calls.length;
  assert.equal(await runRefresh(fixture.options),0);
  assert.equal(fixture.calls.length,before);
});

test('an invocation ID and an earlier timer tick do not qualify a manual wave',async t=>{
  const fixture=await refreshFixture(t,{complete:true});
  assert.equal(await runRefresh({...fixture.options,env:{...fixture.options.env,INVOCATION_ID:'manual-invocation'}}),0);
  assert.equal((await fixture.readState()).records[0].trigger,'manual');
});

test('manual launch after a failed timer wake marks the resumed round manual',async t=>{
  const fixture=await refreshFixture(t,{complete:true});
  const env={...fixture.options.env,INVOCATION_ID:'timer-invocation',JOBFINDER_REFRESH_ORIGIN:'timer'};
  const execute=async()=>{throw Error('SYNTHETIC_SLEEP');};
  assert.equal(await runRefresh({...fixture.options,env,execute}),75);
  const before=await fixture.readState();
  assert.equal(before.active.trigger,'timer');
  assert.equal(await runRefresh({...fixture.options,now:before.infrastructureRetryAt}),0);
  const after=await fixture.readState();
  assert.equal(fixture.jobs.values().next().value.roundId,before.active.roundId);
  assert.equal(after.records[0].trigger,'manual');
});

test('later timer waves retain an earlier manual intervention for the day',async t=>{
  const fixture=await refreshFixture(t);
  const env={...fixture.options.env,INVOCATION_ID:'timed-invocation',JOBFINDER_REFRESH_ORIGIN:'timer'};
  fixture.receipt.manualIntervention=true;
  assert.equal(await runRefresh({...fixture.options,env}),0);
  assert.equal((await fixture.readState()).records[0].trigger,'manual');
  const due=fixture.receipt.nextRetryAt;
  fixture.setComplete();
  delete fixture.receipt.manualIntervention;
  assert.equal(await runRefresh({...fixture.options,now:due,env}),0);
  const state=await fixture.readState();
  assert.equal(state.records[0].trigger,'manual');
  assert.equal(state.records[0].complete,true);
});

test('lost wait response rejects a stale receipt and resumes waiting for the same job',async t=>{
  const fixture=await refreshFixture(t);
  const execute=async(cli,args)=>{
    if(args[0]==='jobs'){
      const round=fixture.jobs.get(args[3]);
      fixture.receipts.set(round.roundId,{...round,roundId:'1'.repeat(32)});
      throw Error('SYNTHETIC_LOST_WAIT');
    }
    return fixture.options.execute(cli,args);
  };
  assert.equal(await runRefresh({...fixture.options,execute}),75);
  const state=await fixture.readState();
  assert.equal(state.active.jobId,'synthetic-job-1');
  assert.deepEqual(state.records,[]);
  assert.equal(await runRefresh({...fixture.options,now:state.infrastructureRetryAt}),0);
  assert.equal(fixture.calls.filter(call=>call==='exec').length,1);
});

test('lost dispatch response adopts the exact reserved round receipt without another dispatch',async t=>{
  const fixture=await refreshFixture(t);
  const execute=async(cli,args)=>{
    const response=await fixture.options.execute(cli,args);
    if(args[0]==='exec'){
      const result=fixture.jobs.get(JSON.parse(response.stdout).jobId);
      fixture.receipts.set(result.roundId,result);
      throw Error('SYNTHETIC_LOST_DISPATCH');
    }
    return response;
  };
  assert.equal(await runRefresh({...fixture.options,execute}),75);
  const state=await fixture.readState();
  assert.equal(state.active.jobId,undefined);
  assert.equal(await runRefresh({...fixture.options,now:state.infrastructureRetryAt}),0);
  assert.equal(fixture.calls.filter(call=>call==='exec').length,1);
  assert.equal(fixture.calls.filter(call=>call==='jobs').length,0);
});

test('the final periodic tick leaves room for the new daily slot',async t=>{
  const fixture=await refreshFixture(t);
  assert.equal(await runRefresh({...fixture.options,now:next-60_000}),0);
  assert.equal(fixture.calls.length,0);
  assert.equal(await runRefresh({...fixture.options,now:next}),0);
  assert.equal(fixture.jobs.values().next().value.slot,String(next));
});

test('an obsolete pending publication cannot block the next Beijing slot or be installed again',async t=>{
  const fixture=await refreshFixture(t,{complete:true});
  assert.equal(await runRefresh({...fixture.options,request:async()=>Response.json({wrong:'snapshot'})}),75);
  const state=await fixture.readState();
  assert.equal(state.active.publication.complete,true);
  assert.equal(await runRefresh({...fixture.options,now:next}),0);
  const record=(await fixture.readState()).records[0];
  assert.equal(record.slot,String(next));
  assert.equal(record.webReadback,true);
  assert.equal(fixture.jobs.size,2);
  assert.equal(fixture.snapshotPulls.length,1);
  assert.ok(fixture.reports.some(row=>row.status==='OBSOLETE_PUBLICATION_RELEASED'));
});

test('an unfinished old round is released without waiting for its old remote job',async t=>{
  const fixture=await refreshFixture(t,{complete:true});
  const oldRoundId='4'.repeat(32);
  await writeFile(fixture.stateFile,JSON.stringify({...fixture.legacy,
    active:{slot:String(midnight),roundId:oldRoundId,jobId:'yesterdays-job',trigger:'timer'},
    infrastructureRetryAt:next+60_000}));
  assert.equal(await runRefresh({...fixture.options,now:next}),0);
  assert.equal(fixture.jobs.size,1);
  assert.equal(fixture.jobs.values().next().value.slot,String(next));
  assert.notEqual(fixture.jobs.values().next().value.roundId,oldRoundId);
  assert.ok(fixture.reports.some(row=>row.status==='OBSOLETE_ROUND_RELEASED'));
});

test('the remote wait is bounded by the current slot end',async t=>{
  const fixture=await refreshFixture(t,{complete:true});
  const execute=async(cli,args,options)=>{
    if(args[0]==='jobs'){
      assert.equal(args[args.indexOf('--timeout')+1],'360s');
      assert.equal(options.timeout,361_000);
    }
    return fixture.options.execute(cli,args);
  };
  assert.equal(await runRefresh({...fixture.options,now:next-360_000,execute}),0);
});

test('a complete receipt with missing source identities cannot be published',async t=>{
  const fixture=await refreshFixture(t,{complete:true});
  fixture.receipt.capturedSources=[];
  assert.equal(await runRefresh(fixture.options),76);
  assert.equal(fixture.snapshotPulls.length,0);
  assert.deepEqual((await fixture.readState()).records,[]);
  assert.ok(fixture.reports.some(row=>row.status==='ROUND_RECEIPT_SOURCE_COVERAGE_MISMATCH'));
  const calls=fixture.calls.length;
  assert.equal(await runRefresh({...fixture.options,now:midnight+10*60_000}),76);
  assert.equal(fixture.calls.length,calls);
});

test('contradictory snapshot metadata is rejected before installation',async t=>{
  const fixture=await refreshFixture(t);
  fixture.receipt.totalJobs++;
  let installations=0;
  const installSnapshot=async()=>{installations++;};
  assert.equal(await runRefresh({...fixture.options,installSnapshot}),76);
  assert.equal(installations,0);
  assert.ok(fixture.reports.some(row=>row.status==='ROUND_RECEIPT_SNAPSHOT_METADATA_MISMATCH'));
});

test('unknown or corrupt schedule state fails closed without rewriting it or making requests',async t=>{
  const fixture=await refreshFixture(t);
  for(const value of [null,{}, {...fixture.legacy,dailyAttempt:null},
    ...[0,4,1.5,'2'].map(count=>({...fixture.legacy,dailyAttempt:{slot:String(midnight),count,status:'RESERVED'}})),
    {...fixture.legacy,dailyAttempt:{slot:String(midnight+1),count:1,status:'RESERVED'}},
    {...fixture.legacy,dailyAttempt:{slot:String(next),count:1,status:'RESERVED'}},
    {...fixture.legacy,dailyAttempt:{slot:String(midnight),count:3,status:'UNKNOWN'}},
    {...fixture.legacy,dailyAttempt:{slot:String(midnight),count:3,status:'VERIFIED'}},
    {...fixture.legacy,dailyAttempt:{slot:String(midnight),count:3,status:'VERIFIED',complete:false}},
    {timerSlots:[],records:[null]}]){
    const bytes=JSON.stringify(value);
    await writeFile(fixture.stateFile,bytes);
    assert.equal(await runRefresh(fixture.options),76);
    assert.equal(await readFile(fixture.stateFile,'utf8'),bytes);
  }
  await writeFile(fixture.stateFile,'{truncated');
  assert.equal(await runRefresh(fixture.options),76);
  assert.equal(fixture.calls.length,0);
});

test('a failed reservation write never wakes the collector',async t=>{
  const fixture=await refreshFixture(t);
  await mkdir(fixture.stateFile+'.tmp');
  assert.equal(await runRefresh(fixture.options),76);
  assert.equal(fixture.calls.length,0);
  assert.deepEqual(await fixture.readState(),fixture.legacy);
});

test('the service keeps its lock and retries infrastructure failures after five minutes',()=>{
  const service=readFileSync(new URL('./jobfinder-refresh.service',import.meta.url),'utf8');
  assert.match(service,/^ExecStart=\/usr\/bin\/flock -n /m);
  assert.match(service,/^RestartSec=5min$/m);
  assert.match(service,/^RefuseManualStart=yes$/m);
  assert.match(service,/^Environment=JOBFINDER_REFRESH_ORIGIN=timer$/m);
  assert.match(service,/^RestartPreventExitStatus=76$/m);
  assert.match(service,/^StartLimitIntervalSec=0$/m);
});

test('the executable returns the terminal exit code when state cannot be accounted for',()=>{
  const result=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('./refresh.ts',import.meta.url))],{
    encoding:'utf8',env:{...process.env,INSTABOX_API_KEY:'',JOBFINDER_PUBLIC_SNAPSHOT_FILE:'',JOBFINDER_VERIFY_BASE_URL:''}
  });
  assert.equal(result.status,76,result.stderr);
  assert.match(result.stderr,/SNAPSHOT_PATH_KEY_AND_VERIFY_URL_REQUIRED/);
});
