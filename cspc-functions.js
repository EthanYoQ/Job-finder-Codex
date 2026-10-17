// Invoked only by the existing serial Functions runtime. No daemon, HTTP substitute or writer.
async function runCspcDomObservation({directory,browserSource,runStartedAt,dispatchBefore,sampleOnly}) {
  const marker='CSPC_DOM_RESULT:';
  async function call(code) {
    const result=await tools.mcp__cua_repl__js({code,timeout_ms:120000,title:'读取石药原 D36 云浏览器 DOM'});
    const output=result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
    if(result.isError)throw Error(output);
    const offset=output.lastIndexOf(marker);
    if(offset<0)throw Error('CSPC_DOM_RESULT_MISSING:'+output.slice(-1200));
    return JSON.parse(output.slice(offset+marker.length));
  }
  const emit=expression=>'nodeRepl.write('+JSON.stringify(marker)+'+JSON.stringify('+expression+'));';
  async function put(name,value) {
    const result=await tools.apply_patch('*** Begin Patch\n*** Add File: '+directory+'/'+name+'\n'+JSON.stringify(value,null,2).split('\n').map(s=>'+'+s).join('\n')+'\n*** End Patch');
    if(result?.isError)throw Error('CSPC_DOM_ARCHIVE_WRITE');
  }
  await tools.mcp__cua_repl__js({code:'await cua.getState();',title:'检查 dot 云浏览器'});
  let initialized=false;
  try {
    initialized=true;
    const started=await call(browserSource+'\n'+emit('await cspcDomRuntime.start('+JSON.stringify({runStartedAt,dispatchBefore})+')'));
    await put('list-before.json',started.before);
    for(let index=0;index<(sampleOnly?1:started.rowCount);index++) {
      if(Date.now()>=Date.parse(dispatchBefore))throw Error('CSPC_CONTROL_WINDOW_EXPIRED');
      const observed=await call(emit('await cspcDomRuntime.readRow('+index+')'));
      await put('row-'+String(index+1).padStart(3,'0')+'.json',observed);
    }
    const result=await call(emit('await cspcDomRuntime.finish('+sampleOnly+')'));
    await put('navigation-evidence.json',result.dom);
    await put('application-observations.json',result.applications);
    return result;
  } finally {
    if(initialized)await call('await cspcDomRuntime.close();'+emit('{closed:true}'));
  }
}
async function captureCspcDomObservation(options){return runCspcDomObservation({...options,sampleOnly:false});}
async function probeCspcDomObservation(options){return runCspcDomObservation({...options,sampleOnly:true});}
return {captureCspcDomObservation,probeCspcDomObservation};

