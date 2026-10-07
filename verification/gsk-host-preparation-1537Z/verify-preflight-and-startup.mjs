import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import vm from 'node:vm';
const P=import.meta.dirname,N=resolve(P,'../..'),R=resolve(N,'..'),host=join(N,'hosts/gsk/host'),node=join(R,'runtime/node-v22.23.3-linux-x64/bin/node'),repo=join(N,'producer');
const sha=x=>createHash('sha256').update(x).digest('hex');
const base=mkdtempSync(join(P,'synthetic-startup-'));const controlPath=join(P,'synthetic-gsk/valid-prepared/host/control-base.json'),row=JSON.parse(readFileSync(join(P,'synthetic-gsk/valid-readback.json'))).candidateRow;
const bootstrapPath=join(base,'bootstrap.json'),bootstrap={schemaVersion:1,checkedAt:new Date().toISOString(),batchId:'synthetic-gsk-preflight',candidateRows:[row]};writeFileSync(bootstrapPath,JSON.stringify(bootstrap));
const bootHash=sha(readFileSync(bootstrapPath)),out=join(base,'preflight-run');
const env={PATH:join(R,'runtime/node-v22.23.3-linux-x64/bin')+':/usr/bin:/bin',TZ:'UTC',NODE_OPTIONS:'--require '+join(N,'no-network.cjs'),TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1',JOBFINDER_CLOUD_SOURCE_ID:'source-gsk-china-social'};
const run=(args)=>spawnSync(node,args,{cwd:repo,env,encoding:'utf8',timeout:45000,maxBuffer:200000});
const args=[join(host,'runtime/preflight/preflight-launch.mjs'),'check',join(host,'host-config.json'),controlPath,bootstrapPath,bootHash,out];
const checked=run(args);writeFileSync(join(base,'preflight-exec.json'),JSON.stringify({exitCode:checked.status,stdout:checked.stdout,stderr:checked.stderr},null,2));assert.equal(checked.status,0,checked.stderr);
const parsed=JSON.parse(checked.stdout),report=JSON.parse(readFileSync(parsed.reportPath));
assert.equal(report.localChecksPassed,true);assert.equal(report.runtime.heapProof.requiredOldSpaceMiB,384);assert(report.runtime.heapProof.execArgv.includes('--max-old-space-size=384'));assert(report.command.includes('--max-old-space-size=384'));assert(report.command.includes('--db-started-control'));assert(report.command.includes('1800000'));assert.equal(report.command[0],node);assert.equal(report.runtime.build.commitSha,'58aa0e413eec27813483996f5dea6c708a7757c4');
const legacy=run([...args.slice(0,1),'launch',...args.slice(2)]);assert.notEqual(legacy.status,0);assert(legacy.stderr.includes('PREFLIGHT_LEGACY_LAUNCH_DISABLED_USE_SUPERVISED_STARTER'));
const wrongHeap=run(['--max-old-space-size=256','--import',join(repo,'node_modules/tsx/dist/loader.mjs'),join(host,'runtime/preflight/runtime-check.mjs'),join(host,'host-config.json'),controlPath,bootstrapPath,join(base,'wrong-heap-smoke')]);assert.notEqual(wrongHeap.status,0);assert(wrongHeap.stderr.includes('PREFLIGHT_HEAP_384_REQUIRED'));
// Execute the actual supervisor -> diagnostic wrapper -> Node chain with an inert
// local probe. The original source acquisition entrypoint is never run here.
const source=readFileSync(join(N,'hosts/gsk/supervision/start-monitor-gsk-next-combined.unbound.template.js'),'utf8');
const functions=source.slice(source.indexOf('function buildObservedCommand'),source.indexOf('const combinedPaths='));
const buildCombined=new Function(functions+';return buildCombinedCommand;')();const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
const inert=join(base,'inert-probe.mjs');writeFileSync(inert,"import {getHeapStatistics} from 'node:v8';setTimeout(()=>console.log(JSON.stringify({purpose:'INERT_LOCAL_STARTUP_PROBE_NO_SOURCE_CAPTURE',execArgv:process.execArgv,heapLimit:getHeapStatistics().heap_size_limit})),1600);\n");
const diag=join(base,'inert-diagnostics');const command='env TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 JOBFINDER_CLOUD_SOURCE_ID=source-gsk-china-social '+node+' scripts/run-with-http-diagnostics.mjs '+q(diag)+' 1800000 -- '+node+' --max-old-space-size=384 '+q(inert);
const metadata={nodePath:node,supervisorPath:join(N,'hosts/gsk/supervision/supervise-cancel.mjs'),wrapperPath:join(repo,'scripts/run-with-http-diagnostics.mjs'),samplerPath:join(N,'hosts/gsk/supervision/sample_process_tree.py'),controlDirectory:join(base,'inert-control'),controlRunId:'jb-'+sha('synthetic-gsk-inert-combined'),outputDir:join(base,'inert-memory'),label:'SYNTHETIC_INERT_GSK_STARTUP'};
const combined=buildCombined(command,metadata,q);writeFileSync(join(base,'inert-reviewed-combined-command.txt'),combined.observedCommand);
const actual=spawnSync('/bin/bash',['-c',combined.observedCommand],{cwd:repo,env,encoding:'utf8',timeout:15000,maxBuffer:200000});writeFileSync(join(base,'inert-combined-exec.json'),JSON.stringify({exitCode:actual.status,stdout:actual.stdout,stderr:actual.stderr},null,2));assert.equal(actual.status,0,actual.stderr);assert(actual.stdout.includes('CAPTURE_EXIT=0'));assert(actual.stdout.includes('MEMORY_OBSERVER_EXIT=0'));
const inner=readFileSync(join(diag,'stdout.log'),'utf8').trim();const innerProof=JSON.parse(inner);assert(innerProof.execArgv.includes('--max-old-space-size=384'));
const terminal=JSON.parse(readFileSync(join(base,'inert-control/terminal.json')));assert.equal(terminal.code,0);assert.equal(terminal.supervisorExitCode,0);
// Verify parse failure preserves every stdout byte through the real host helper.
const parser=readFileSync(join(host,'machine-json.js'),'utf8'),parse=new Function('output','record',parser);const tests=[];
for(const value of ['{"broken":','(node:123) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental, expect them to change at any time.\n(Use `node --trace-warnings ...` to show where the warning was created)\n{"broken":','UNRECOGNIZED WARNING\n{"ok":true}','{"a":1}\n{"b":2}']){let retained;assert.throws(()=>parse(value,x=>retained=x));assert.equal(retained.rawOutput,value);tests.push({name:'invalid-json-keeps-full-stdout',passed:true});}
const raw='UNRECOGNIZED WARNING\n{"broken":';const state=new Map();const cfg=JSON.parse(readFileSync(join(host,'host-config.json')));const context=vm.createContext({load:key=>key.endsWith('cloudPilotHostConfig')?cfg:parser,store:(key,value)=>state.set(key,value),notify:()=>{},tools:{exec_command:async()=>({exit_code:0,output:raw})},Date});const helpers=await vm.compileFunction('return(async()=>{'+readFileSync(join(host,'host-helper-functions.js'),'utf8')+'})()',[],{parsingContext:context})();await assert.rejects(helpers.readFile('/tmp/synthetic-invalid-machine-json'));assert.equal(state.get('proxyNode22:gsk:lastMachineJsonDiagnostic').rawOutput,raw);
const result={classification:'ACTUAL_LOCAL_STARTUP_CHECK_WITH_SYNTHETIC_BINDING_AND_INERT_PROBE',actualSourceCapture:false,network:false,database:false,registration:false,hostRemainsUnbound:true,preflightPassed:true,heapProof:report.runtime.heapProof,reportedCommandOldSpaceMiB:384,sourceBudgetMs:1800000,directLaunchRejected:true,wrongHeapRejected:true,actualSupervisorWrapperSamplerChainPassed:true,inertInnerProof:innerProof,terminal,invalidJsonRawStdoutPreserved:true,parserCases:tests.length+1,privateDiagnosticRoot:base};writeFileSync(join(P,'PREFLIGHT_STARTUP_RESULTS.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
