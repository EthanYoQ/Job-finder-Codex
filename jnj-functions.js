// Existing Functions bridge only. The original prepare script must validate the complete archive.
async function runJnjManagedDom({directory,browserSource,deadline,sampleOnly}) {
  const marker='JNJ_DOM_RESULT:',quote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
  async function command(cmd) {
    let result=await tools.exec_command({cmd,max_output_tokens:2000}),output=result.output;
    while(result.session_id){result=await tools.write_stdin({session_id:result.session_id,chars:'',yield_time_ms:1000,max_output_tokens:2000});output+=result.output;}
    if(result.exit_code!==0) throw Error('JNJ_DOM_ARCHIVE:'+output);
    return output;
  }
  await command('python3 -c '+quote('import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.mkdir(parents=True,exist_ok=True); assert not any(p.iterdir()), "JNJ_FRESH_DIRECTORY_REQUIRED"')+' '+quote(directory));
  async function call(code) {
    const result=await tools.mcp__cua_repl__js({code,timeout_ms:120000,title:'读取强生中国原生 DOM 证据'});
    const output=result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
    if(result.isError) throw Error(output);
    const offset=output.lastIndexOf(marker);
    if(offset<0) throw Error('JNJ_DOM_RESULT_MISSING:'+output.slice(-1200));
    return JSON.parse(output.slice(offset+marker.length));
  }
  const emit=expression=>'nodeRepl.write('+JSON.stringify(marker)+'+JSON.stringify('+expression+'));';
  async function put({file,raw}) {
    if(!/^(?:jnj-list-page-[1-9]\d*|r-\d+)\.json$/.test(file) || !raw.endsWith('\n')) throw Error('JNJ_DOM_ARCHIVE_IDENTITY');
    const result=await tools.apply_patch('*** Begin Patch\n*** Add File: '+directory+'/'+file+'\n'+raw.slice(0,-1).split('\n').map(line=>'+'+line).join('\n')+'\n*** End Patch');
    if(result?.isError) throw Error('JNJ_DOM_ARCHIVE_WRITE');
  }
  await tools.mcp__cua_repl__js({code:'await cua.getState();',title:'检查 dot 云浏览器'});
  let initialized=false;
  try {
    initialized=true;
    const started=await call(browserSource+'\n'+emit('await jnjDomRuntime.start('+JSON.stringify(deadline ?? null)+')'));
    for(let page=1;page<=20;page++) {
      if(Date.now()>=started.deadline) throw Error('JNJ_ORIGINAL_30_MINUTE_CAPTURE_DEADLINE');
      const list=await call(emit('await jnjDomRuntime.readList()'));await put(list);
      if(list.failure) throw Error(list.failure);
      if(sampleOnly || !list.next) {
        // Samples have no manifest and cannot enter the original prepare/currentCapture path.
        if(sampleOnly) {
          await put(await call(emit('await jnjDomRuntime.readDetail(0)')));
          return {sampleOnly:true,total:list.total,listCount:1,detailCount:1,directory};
        }
        // Finish the original list traversal before details can widen the pagination window.
        for(let index=0;index<list.total;index++) await put(await call(emit('await jnjDomRuntime.readDetail('+index+')')));
        const script='import pathlib,hashlib,json,sys; p=pathlib.Path(sys.argv[1]); files=[{"file":f.name,"bytes":len(f.read_bytes()),"sha256":hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(p.glob("*.json"))]; raw=json.dumps({"kind":"BROWSER_UI_DOM_EVIDENCE_NOT_HTTP","files":files},indent=2)+"\\n"; f=p/"manifest.json"; f.write_text(raw); print(json.dumps({"path":str(f),"sha256":hashlib.sha256(f.read_bytes()).hexdigest()}))';
        return {sampleOnly:false,total:list.total,listCount:page,detailCount:list.total,directory,manifest:JSON.parse(await command('python3 -c '+quote(script)+' '+quote(directory)))};
      }
      await call(emit('await jnjDomRuntime.advance()'));
    }
    throw Error('JNJ_ORIGINAL_20_PAGE_LIMIT');
  } finally { if(initialized) await call('await jnjDomRuntime.close();'+emit('{closed:true}')); }
}
async function captureJnjManagedDom(options){return runJnjManagedDom({...options,sampleOnly:false});}
async function probeJnjManagedDom(options){return runJnjManagedDom({...options,sampleOnly:true});}
return {captureJnjManagedDom,probeJnjManagedDom};
