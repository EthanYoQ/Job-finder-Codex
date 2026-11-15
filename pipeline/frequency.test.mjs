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

test('the timer and retry slots both use Beijing 00:01', () => {
  const timer = readFileSync(new URL('./jobfinder-refresh.timer', import.meta.url), 'utf8');
  assert.deepEqual(timer.match(/^OnCalendar=.*$/gm), ['OnCalendar=*-*-* 16:01:00 UTC']);
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

async function refreshFixture(t,{complete=false}={}) {
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
    generatedAt:snapshot.generatedAt,lastUpdatedAt:null,totalJobs:0,capturedSources:[],unresolvedCoverage:!complete};
  const calls=[],reports=[],snapshotPulls=[];
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
      assert.equal((await readState()).dailyAttempt.status,'RESERVED');
      assert.ok((await readState()).dailyAttempt.count<=3);
      if(args[0]==='pull'){
        const latest=args[2].endsWith('/latest.json');
        if(!latest)snapshotPulls.push(args[2]);
        await writeFile(args[3],latest?JSON.stringify(receipt):bytes);
      }
      else assert.ok(['wake','exec','jobs'].includes(args[0]));
      return {stdout:args[0]==='exec'?JSON.stringify({jobId:'synthetic-job'}):'',stderr:''};
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
  return {target,stateFile,legacy,options,calls,reports,readState,snapshotPulls};
}

test('three partial publications retain the verified receipt and stop without a fourth wake',async t=>{
  const fixture=await refreshFixture(t);
  const codes=[];
  for(let i=0;i<3;i++)codes.push(await runRefresh(fixture.options));
  assert.deepEqual(codes,[75,75,0],JSON.stringify(fixture.reports));
  assert.equal(fixture.calls.filter(call=>call==='exec').length,3);
  assert.equal(fixture.calls.filter(call=>call==='readback').length,6);
  assert.equal(fixture.snapshotPulls.length,1);
  const state=await fixture.readState();
  assert.deepEqual(state.dailyAttempt,{slot:String(midnight),count:3,status:'VERIFIED',complete:false});
  assert.equal(state.records.length,1);
  assert.equal(state.records[0].complete,false);
  assert.equal(state.records[0].webReadback,true);
  assert.equal(state.records[0].unresolvedCoverage,true);
  assert.equal(state.dailySince,fixture.legacy.dailySince);
  assert.ok(fixture.reports.some(row=>row.status==='DAILY_REFRESH_DEGRADED'&&row.complete===false));
  const before=fixture.calls.length;
  assert.equal(await runRefresh(fixture.options),0);
  assert.equal(fixture.calls.length,before);
  assert.deepEqual(await fixture.readState(),state);
  const publicStatus=await createRefreshStatusReader(fixture.target)();
  assert.equal(publicStatus.status,'AVAILABLE');
  assert.equal(publicStatus.records[0].complete,false);
  assert.equal('dailyAttempt' in publicStatus,false);
});

test('failed attempts are consumed before wake and reset at the next Beijing slot, not after 24 hours',async t=>{
  const fixture=await refreshFixture(t);
  let wakes=0;
  const execute=async(_cli,args)=>{
    assert.equal(args[0],'wake');wakes++;
    assert.equal((await fixture.readState()).dailyAttempt.status,'RESERVED');
    throw Error('SYNTHETIC_WAKE_FAILED');
  };
  const codes=[];
  for(const now of [next-1200000,next-600000,next-1])codes.push(await runRefresh({...fixture.options,now,execute}));
  assert.deepEqual(codes,[75,75,76]);
  assert.equal(wakes,3);
  assert.equal(await runRefresh({...fixture.options,now:next-1,execute}),76);
  assert.equal(wakes,3);
  assert.equal(await runRefresh({...fixture.options,now:next,execute}),75);
  assert.equal(wakes,4);
  assert.deepEqual((await fixture.readState()).dailyAttempt,{slot:String(next),count:1,status:'RESERVED'});
});

test('a last readback failure stays terminal even with an earlier verified partial receipt',async t=>{
  const fixture=await refreshFixture(t);
  assert.equal(await runRefresh(fixture.options),75);
  assert.equal(await runRefresh(fixture.options),75);
  const previous=(await fixture.readState()).records;
  assert.equal(await runRefresh({...fixture.options,request:async()=>Response.json({wrong:'snapshot'})}),76);
  const state=await fixture.readState();
  assert.equal(state.dailyAttempt.status,'RESERVED');
  assert.deepEqual(state.records,previous);
  const before=fixture.calls.length;
  assert.equal(await runRefresh(fixture.options),76);
  assert.equal(fixture.calls.length,before);
  assert.ok(fixture.reports.some(row=>row.status==='WEBSITE_READBACK_MISMATCH'&&row.exitCode===76));
});

test('a verified complete third attempt is also a successful no-op on restart',async t=>{
  const fixture=await refreshFixture(t,{complete:true});
  await writeFile(fixture.stateFile,JSON.stringify({...fixture.legacy,
    dailyAttempt:{slot:String(midnight),count:2,status:'RESERVED'}}));
  assert.equal(await runRefresh(fixture.options),0);
  assert.equal((await fixture.readState()).dailyAttempt.complete,true);
  assert.equal(fixture.calls.includes('exec'),false);
  const before=fixture.calls.length;
  assert.equal(await runRefresh(fixture.options),0);
  assert.equal(fixture.calls.length,before);
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

test('the service keeps its lock and ten minute delay while terminal failures cannot restart',()=>{
  const service=readFileSync(new URL('./jobfinder-refresh.service',import.meta.url),'utf8');
  assert.match(service,/^ExecStart=\/usr\/bin\/flock -n /m);
  assert.match(service,/^RestartSec=10min$/m);
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
