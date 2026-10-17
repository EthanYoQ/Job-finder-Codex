// Load through the original Functions runtime, never a Node daemon.
async function runPfizerManagedDom({directory,browserSource,sampleOnly,deadline}) {
  const marker = 'PFIZER_DOM_RESULT:';
  const packets = [];
  const put = async (name,value) => {
    const result=await tools.apply_patch('*** Begin Patch\n*** Add File: '+directory+'/'+name+'\n'+JSON.stringify(value,null,2).split('\n').map(line=>'+'+line).join('\n')+'\n*** End Patch');
    if(result?.isError) throw Error('PFIZER_DOM_ARCHIVE_WRITE');
  };
  async function call(code) {
    const result = await tools.mcp__cua_repl__js({code,timeout_ms:120000,title:'读取辉瑞原中国招聘 DOM 证据'});
    if(result.isError) throw Error(result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'));
    const output=result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
    const offset=output.lastIndexOf(marker);
    if(offset<0) throw Error('PFIZER_DOM_RESULT_MISSING:'+output.slice(-1200));
    return JSON.parse(output.slice(offset+marker.length));
  }
  const emit = expression => "nodeRepl.write("+JSON.stringify(marker)+"+JSON.stringify("+expression+"));";
  await tools.mcp__cua_repl__js({code:'await cua.getState();',title:'检查 dot 云浏览器'});
  let started;
  try {
    started=await call(browserSource+'\n'+emit('await pfizerDomRuntime.start('+JSON.stringify(deadline ?? null)+')'));
    for(let page=1;page<=20;page++) {
      if(Date.now()>=started.deadline) throw Error('PFIZER_ORIGINAL_20_MINUTE_CAPTURE_DEADLINE');
      const packet=await call(emit('await pfizerDomRuntime.readPage('+sampleOnly+')'));
      await put('page-'+String(page).padStart(3,'0')+'.json',packet);
      packets.push(packet);
      if(sampleOnly || !packet.listPage.nextControlPresent) {
        const capture={captureKind:sampleOnly?'MANAGED_BROWSER_DOM_JSONLD_SAMPLE_ONLY':'MANAGED_BROWSER_DOM_JSONLD',
          observedAt:started.observedAt,packets,finishedAt:new Date().toISOString()};
        await put(sampleOnly?'sample-only.json':'managed-browser-capture.json',capture);
        return capture;
      }
      await call(emit('await pfizerDomRuntime.advance()'));
    }
    throw Error('PFIZER_DOM_ORIGINAL_20_PAGE_LIMIT');
  } finally {
    if(started) await call('await pfizerDomRuntime.close();'+emit('{closed:true}'));
  }
}
async function capturePfizerManagedDom(options) { return runPfizerManagedDom({...options,sampleOnly:false}); }
async function probePfizerManagedDom(options) { return runPfizerManagedDom({...options,sampleOnly:true}); }
return {capturePfizerManagedDom,probePfizerManagedDom};

