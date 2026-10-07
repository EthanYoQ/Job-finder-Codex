# Adapt only synthetic source/namespace fixture of unchanged original22 corpus.
from pathlib import Path
P=Path(__file__).resolve().parent
original=(P/'owner.test.mjs').read_text()
for key,source_id in [('novartis','source-novartis-social'),('boehringer-ingelheim','source-boehringer-ingelheim-china-social')]:
 text=original.replace('source-abbvie-china-social',source_id).replace('abbvie',key)
 old="runEntry:mode=>vm.compileFunction('return (async()=>{'+entryCode+'})()',['sourceKey','ownerMode'],{parsingContext:context})('"+key+"',mode)"
 new="runEntry:async mode=>{ const preloadCode=readFileSync(join(project,'preload-owner.exec.js'),'utf8'); const previousExec=tools.exec_command; tools.exec_command=async args=>{if(args.cmd.startsWith('python3 - ')&&args.cmd.includes('PY_OWNER_LOAD')){const {spawnSync}=await import('node:child_process');const p=spawnSync('/bin/bash',['-c',args.cmd],{encoding:'utf8',env:process.env,maxBuffer:2e6});return {exit_code:p.status,output:p.stdout+p.stderr};}return previousExec(args);};await vm.compileFunction('return (async()=>{'+preloadCode+'})()',['sourceKey'],{parsingContext:context})('"+key+"');return vm.compileFunction('return (async()=>{'+entryCode+'})()',['sourceKey','ownerMode'],{parsingContext:context})('"+key+"',mode);}"
 assert old in text,key
 (P/('generated-'+key+'-owner.test.mjs')).write_text(text.replace(old,new))
print('Generated two synthetic source variants; original22 source unchanged')
