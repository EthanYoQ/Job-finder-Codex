# All owner calls in each generated source suite pass the actual preload and reviewed entry.
from pathlib import Path
P=Path(__file__).resolve().parent
original=(P/'owner.test.mjs').read_text()
for key in ['astra','amgen']:
 text=original.replace('source-abbvie-china-social',('source-astrazeneca-social' if key=='astra' else 'source-amgen-china-social')).replace('abbvie',key)
 text=text.replace("sourceConfigSha256:'a'.repeat(64)","sourceConfigSha256:JSON.parse(readFileSync(root+'/host-config.template.json','utf8')).sourceConfigSha256")
 old="const owner=await vm.compileFunction('return (async()=>{'+factoryCode+'})()',['env'],{parsingContext:context})(env);"
 new="""const directOwner=await vm.compileFunction('return (async()=>{'+factoryCode+'})()',['env'],{parsingContext:context})(env);
 const previousExec=tools.exec_command;
 tools.exec_command=async args=>{if(args.cmd.startsWith('python3 - ')&&args.cmd.includes('PY_OWNER_LOAD')){const {spawnSync}=await import('node:child_process');const p=spawnSync('/bin/bash',['-c',args.cmd],{encoding:'utf8',env:process.env,maxBuffer:2e6});return {exit_code:p.status,output:p.stdout+p.stderr};}return previousExec(args);};
 const runFullEntry=async mode=>{
  const preloadCode=readFileSync(join(project,'preload-owner.exec.js'),'utf8');
  await vm.compileFunction('return (async()=>{'+preloadCode+'})()',['sourceKey'],{parsingContext:context})(SOURCE_KEY);
  events.push({event:'ACTUAL_PRELOAD_COMPLETE',at:clock.now});
  await vm.compileFunction('return (async()=>{'+entryCode+'})()',['sourceKey','ownerMode'],{parsingContext:context})(SOURCE_KEY,mode);
  events.push({event:'ACTUAL_ENTRY_OWNER_COMPLETE',at:clock.now});
  const result=state.get(ns+'publishMonitorOwner:'+request.requestId)?.result;if(result){assert.equal(result.noWriteEstablished,false);assert.equal(result.retryAuthorized,false);}return result;
 };
 const owner=async input=>{assert.equal(input.sourceKey,SOURCE_KEY);return runFullEntry(input.mode??'publish');};""".replace('SOURCE_KEY',repr(key))
 assert old in text;text=text.replace(old,new)
 old="runEntry:mode=>vm.compileFunction('return (async()=>{'+entryCode+'})()',['sourceKey','ownerMode'],{parsingContext:context})('"+key+"',mode)"
 assert old in text;text=text.replace(old,"runEntry:runFullEntry")
 text=text.replace("assert.equal(f.publishCalls,1);assert.equal(f.readServed,true);assert.equal(externalFinished,false);", "assert.equal(f.publishCalls,1);assert.equal(f.readServed,true);assert.equal(externalFinished,false);assert(f.events.some(x=>x.event==='ACTUAL_PRELOAD_COMPLETE'));assert(f.events.some(x=>x.event==='ACTUAL_ENTRY_OWNER_COMPLETE'));")
 (P/('generated-'+key+'-full-chain.test.mjs')).write_text(text)
print('Generated two full-chain source suites; every owner call uses actual preload and reviewed entry')
