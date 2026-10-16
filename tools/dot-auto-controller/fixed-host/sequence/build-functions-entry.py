#!/usr/bin/python3
"""Closed Takeda -> Biogen -> Hengrui compilation, no execution or activation.

The original source-specific factories remain independent. Only fixed path
bindings and the private completion bridge are composed here. External values
cannot choose a source, path, SQL, callback or runtime profile.
"""
from pathlib import Path
import hashlib,json,re,sys,types,os,stat
HERE=Path(__file__).resolve().parent
HOST=HERE.parent
PACKAGE=HOST.parent
LIVE_ROOT='/workspace/scratch/5e9614251709/job-finder-fixed-live-controller-v1'
ORDER=('takeda','biogen','hengrui')
PROFILES={
 'takeda':{'sourceId':'source-takeda-china-social','companyId':'company-takeda-china','sourceConfigSha256':'048f616f00b5ed016f075f4204a2ad749457d68a3f078a9e7bde0fae2186b61f','builder':'fixed-host/scripts/build-functions-entry.py','body':'fixed-host/functions/body.template.js','templates':'fixed-host/templates/','renderer':'fixed-host/render-fixed-live-source.py'},
 'biogen':{'sourceId':'source-biogen-china-social','companyId':'company-biogen-china','sourceConfigSha256':'47107a3a1f9dbd3411a1f9244866be7c4bc52422b94a1c92204dc66ac4340348','builder':'fixed-host/biogen/build-functions-entry.py','body':'fixed-host/biogen/body.template.js','templates':'fixed-host/biogen/','renderer':'fixed-host/biogen/render-biogen-source.py'},
 'hengrui':{'sourceId':'source-hengrui-social','companyId':'company-hengrui','sourceConfigSha256':'93dcadb4a572da022694b3ab3040fad541fe674107e3dc66fd2323709e374b4e','builder':'fixed-host/hengrui/build-functions-entry.py','body':'fixed-host/hengrui/body.template.js','templates':'fixed-host/hengrui/','renderer':'fixed-host/hengrui/render-hengrui-source.py'}}
OWN_INPUTS=('fixed-host/sequence/build-functions-entry.py','fixed-host/sequence/coordinator.template.js','fixed-host/sequence/lifecycle-loader.template.js','fixed-host/sequence/holder.py.in','fixed-host/sequence/cli-entry.py.in','fixed-host/sequence/local-activation.py.in','fixed-host/sequence/activation-renderer.py','fixed-host/sequence/bound-artifacts.py.in','fixed-host/sequence/render-install.py','fixed-host/install/activation-renderer.py','fixed-host/install/install-holder.py.in','fixed-host/install/staging.py.in','fixed-host/install/reader-helper.mjs','fixed-host/install/facts.mjs','fixed-host/install/install.functions.template.js','fixed-host/install/post-retirement.sql','fixed-host/install/retired-candidate.json','config/reader-pins.json','config/reader-api-pins.json')
def require(ok,code):
 if not ok:raise RuntimeError(code)
def sha(b):return hashlib.sha256(b).hexdigest()
def encoded(x):return json.dumps(x,ensure_ascii=True,separators=(',',':'))
def replace_once(s,old,new):
 require(s.count(old)==1,'SEQUENCE_SOURCE_ANCHOR:'+old[:80]);return s.replace(old,new)
def module(relative,raw):
 m=types.ModuleType('sequence_'+relative.replace('/','_'));m.__file__=str(PACKAGE/relative)
 exec(compile(raw,m.__file__,'exec'),m.__dict__);return m
def read_regular(path):
 path=Path(path)
 for parent in path.parents:
  st=parent.lstat();require(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode),'SEQUENCE_SOURCE_PARENT')
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  st=os.fstat(fd);require(stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid() and st.st_nlink==1 and not st.st_mode&0o022,'SEQUENCE_SOURCE_FILE')
  with os.fdopen(os.dup(fd),'rb') as f:raw=f.read()
  ident=lambda x:(x.st_dev,x.st_ino,x.st_size,x.st_mtime_ns,x.st_ctime_ns)
  require(len(raw)==st.st_size and ident(st)==ident(os.fstat(fd))==ident(path.lstat()),'SEQUENCE_SOURCE_CHANGED');return raw
 finally:os.close(fd)
def load_source_inputs():
 pin=json.loads(read_regular(HERE/'source-pins.json'))
 require(set(pin)=={'schemaVersion','inputs'} and pin['schemaVersion']==1,'SEQUENCE_PINS_SCHEMA')
 expected=set(OWN_INPUTS)
 for profile in ORDER:
  path=PROFILES[profile]['builder'];raw=read_regular(PACKAGE/path);require(sha(raw)==pin['inputs'].get(path),'SEQUENCE_BUILDER_PIN');m=module(path,raw)
  expected.update(m.DEPENDENCIES+m.OWN_INPUTS)
 expected.add('vendor/c60-source/ops/cloud-pilot-host/connector-host-launch.py')
 require(set(pin['inputs'])==expected,'SEQUENCE_PINS_CLOSED_SET')
 out={}
 for name in sorted(expected):
  raw=read_regular(PACKAGE/name);require(sha(raw)==pin['inputs'][name],'SEQUENCE_SOURCE_PIN:'+name);out[name]=raw
 return out
def render_cli(inputs,profile):
 require(profile in ORDER,'SEQUENCE_COMPILE_PROFILE')
 p=PROFILES[profile];original=module(p['renderer'],inputs[p['renderer']])
 original.LIVE_ROOT=LIVE_ROOT
 files=original.render_bytes({n:inputs[p['templates']+n+'.in'] for n in original.TEMPLATES})
 out={}
 for name,raw in files.items():
  text=raw.decode()
  if name=='fixed-preimport-launch.py':
   text=replace_once(text,"CANDIDATE=BASE/'candidate';DEPLOYMENTS=BASE/'deployments';ROUNDS=BASE/'rounds'", "STATE=BASE/'sources'/"+repr(profile)+"\nCANDIDATE=BASE/'candidate';DEPLOYMENTS=BASE/'deployments';ROUNDS=STATE/'rounds'")
   text=replace_once(text,"BINDINGS=BASE/'connector-host-bindings'","BINDINGS=STATE/'connector-host-bindings'")
   text=text.replace("BASE/'active-round.json'","STATE/'active-round.json'")
   text=text.replace('directories(BASE/name)','directories(STATE/name)').replace('os.open(BASE/name,','os.open(STATE/name,')
   text=replace_once(text,'private=p in (BASE,DEPLOYMENTS,ROUNDS,',"private=p in (BASE,BASE/'sources',STATE,DEPLOYMENTS,ROUNDS,")
   text=replace_once(text,"'JOBFINDER_FIXED_DEPLOYMENT_SHA256':selector()}","'JOBFINDER_FIXED_DEPLOYMENT_SHA256':selector(),'JOBFINDER_FIXED_SEQUENCE_LAYOUT':'TAKEDA_BIOGEN_HENGRUI_V1'}")
   text=replace_once(text,'derived=preflight();fd=root_lock()',"derived=preflight()\n    for p in (BASE/'sources',STATE):\n        if not p.exists():p.mkdir(mode=0o700)\n        directories(p/'scope-check')\n    fd=root_lock()")
   # A close receipt must survive the directory entry, too. Recheck the same
   # named bytes and all ancestor identities; uncertain persistence stays HOLD.
   text=replace_once(text,'directories(file);data=data if isinstance(data,bytes) else encoded(data)','before_dirs=directories(file);data=data if isinstance(data,bytes) else encoded(data)')
   text=replace_once(text,"with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())","with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno());written_identity=identity(os.fstat(f.fileno()))")
   text=replace_once(text,"    return {'sha256':sha(data),'bytes':len(data)}", "    require(before_dirs==directories(file) and written_identity==identity(file.lstat()) and checked(file,mode)==data,'SEQUENCE_DURABLE_WRITE_CHANGED')\n    pfd=os.open(file.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)\n    try:os.fsync(pfd)\n    finally:os.close(pfd)\n    require(before_dirs==directories(file) and written_identity==identity(file.lstat()),'SEQUENCE_DURABLE_PARENT_CHANGED')\n    return {'sha256':sha(data),'bytes':len(data)}")
  elif name=='fixed-recovery-helper.mts':
   text=replace_once(text,"TASK_ROOT===BASE+'/rounds/'", "TASK_ROOT===BASE+'/sources/"+profile+"/rounds/'")
  for leaf in ('fixed-preimport-launch.py','fixed-preflight.mjs','fixed-recovery-helper.mts','fixed-source-fixture.cjs'):
   text=text.replace(leaf,'fixed-'+profile+'-'+leaf[len('fixed-'):])
  out['fixed-'+profile+'-'+name[len('fixed-'):]]=text.encode()
 return out
def profile_inputs(inputs,profile):
 p=PROFILES[profile];m=module(p['builder'],inputs[p['builder']]);m.LIVE_ROOT=Path(LIVE_ROOT)
 original_load=m.load_pinned_module
 def load(name,path,sources):
  value=original_load(name,path,sources)
  if str(path.relative_to(PACKAGE))==p['renderer']:
   value.LIVE_ROOT=LIVE_ROOT
   value.render_bytes=lambda ignored:{'fixed-'+n.split('-',2)[2]:v for n,v in render_cli(inputs,profile).items()}
  return value
 m.load_pinned_module=load
 source=dict(inputs)
 body=source[p['body']].decode()
 body=replace_once(body,"BASE+'/candidate/fixed-preimport-launch.py'","BASE+'/candidate/fixed-"+profile+"-preimport-launch.py'")
 body=replace_once(body,"+'.lifecycle-owner/cli-entry.py'","+'.lifecycle-owner/cli-"+profile+".py'")
 body=body.replace("BASE+'/rounds/'","BASE+'/sources/"+profile+"/rounds/'")
 body=replace_once(body,"const prefix='JOBFINDER_CONNECTOR_HOST_SHA256='","const prefix='JOBFINDER_FIXED_SEQUENCE_LAYOUT=TAKEDA_BIOGEN_HENGRUI_V1 JOBFINDER_CONNECTOR_HOST_SHA256='")
 source[p['body']]=body.encode()
 # These remain private, compile-fixed transport bytes. No cfg layout selector.
 helper=source['fixed-host/functions/host-helper.js'].decode()
 helper=replace_once(helper,'"JOBFINDER_CONNECTOR_HOST_SHA256="','"JOBFINDER_FIXED_SEQUENCE_LAYOUT=TAKEDA_BIOGEN_HENGRUI_V1 JOBFINDER_CONNECTOR_HOST_SHA256="')
 transport=source['fixed-host/functions/read-response-transport.js'].decode()
 transport=replace_once(transport,"base+'/rounds/'","base+'/sources/"+profile+"/rounds/'")
 transport=replace_once(transport,"env={**os.environ,'JOBFINDER_CONNECTOR_HOST_SHA256'","env={**os.environ,'JOBFINDER_FIXED_SEQUENCE_LAYOUT':'TAKEDA_BIOGEN_HENGRUI_V1','JOBFINDER_CONNECTOR_HOST_SHA256'")
 helper=replace_once(helper,sha(inputs['fixed-host/functions/read-response-transport.js']),sha(transport.encode()))
 source['fixed-host/functions/host-helper.js']=helper.encode()
 source['fixed-host/functions/read-response-transport.js']=transport.encode()
 source['fixed-host/lifecycle/cli-entry.py']=render_stable_cli(inputs,profile)
 return m,source
def render_stable_cli(inputs,profile):
 require(profile in ORDER,'SEQUENCE_COMPILE_PROFILE')
 return inputs['fixed-host/sequence/cli-entry.py.in'].replace(b'__SEQUENCE_PROFILE__',repr(profile).encode())
def validate_release(inputs,r):
 require(type(r) is dict and set(r)=={'schemaVersion','kind','projectId','order','profiles','artifacts'},'SEQUENCE_RELEASE_KEYS')
 require(r['schemaVersion']==1 and r['kind']=='CLOSED_THREE_SOURCE_RELEASE' and r['projectId']=='yiopvxysxrtrnvqxwgbx' and r['order']==list(ORDER) and set(r['profiles'])==set(ORDER),'SEQUENCE_RELEASE_SCOPE')
 common=('candidate','databaseIdentity','build','expectedRow','lockSha256','packageManifestSha256','kind','fixturePreloadSha256')
 artifacts={}
 for name in ORDER:
  d=r['profiles'][name];p=PROFILES[name];m,source=profile_inputs(inputs,name)
  cli=render_cli(inputs,name)
  original={'fixed-'+n.split('-',2)[2]:v for n,v in cli.items()}
  m.validate_deployment(d,original)
  require(d['sourceId']==p['sourceId'] and d['sourceConfigSha256']==p['sourceConfigSha256'],'SEQUENCE_SOURCE_CONFIG')
  require(all(d[k]==r['profiles']['takeda'][k] for k in common),'SEQUENCE_SHARED_RELEASE_IDENTITY')
  require(d['expectedRow']['minimumStableCompanyCount']==41 and d['expectedRow']['migrationVersion']=='20261014141000_v75_retired_candidate_fence' and d['expectedRow']['schemaHash']=='6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7','SEQUENCE_SCHEMA50_ROSTER')
  artifacts[name]={**{k:sha(v) for k,v in cli.items()},'stableCliSha256':sha(render_stable_cli(inputs,name))}
 require(r['artifacts']==artifacts,'SEQUENCE_ARTIFACT_CLOSED_SET')
 return r
def render_entry(inputs,release=None):
 if release is not None:validate_release(inputs,release)
 digest=sha(encoded(release).encode()) if release is not None else '0'*64
 out='const ACTIVATION=Object.freeze('+encoded({'enabled':False,'mode':'LIVE','deploymentSha256':digest})+');\n'
 out+='const SEQUENCE_RELEASE='+encoded(release)+';\n'
 out+=inputs['fixed-host/functions/sha256.js'].decode()+'\n'
 for profile in ORDER:
  m,source=profile_inputs(inputs,profile)
  deployment=release['profiles'][profile] if release else None
  raw=m.render_entry(source,deployment,sha(encoded(deployment).encode()) if deployment else None).decode()
  raw=raw[:raw.index('async function runLiveRound(){')]
  raw=raw.replace('ACTIVATION','PROFILE_ACTIVATION')
  raw+='return Object.freeze({run:runFixedRound,consume:consumeClosedSource});\n'
  out+='function create_'+profile+'(sourceCycle){\n'+raw+'}\n'
 out+=inputs['fixed-host/sequence/coordinator.template.js'].decode()+'\n'
 require(out.isascii(),'SEQUENCE_ASCII_SOURCE')
 return out.encode()
def render_defaults(inputs):
 lifecycle=module('fixed-host/scripts/build-lifecycle-artifacts.py',inputs['fixed-host/scripts/build-lifecycle-artifacts.py'])
 digest=inputs['fixed-host/functions/sha256.js'].decode()
 rows=next(line for line in inputs['fixed-host/functions/host-helper.js'].decode().splitlines() if line.startswith('function rows('))
 return {'functions-entry.js':render_entry(inputs),
  'functions-loader.js':lifecycle.render_loader(inputs['fixed-host/sequence/lifecycle-loader.template.js'].decode(),digest),
  'functions-activate.js':lifecycle.render_activation(inputs['fixed-host/functions/lifecycle-activation.template.js'].decode(),digest,rows)}
def main():
 require(sys.argv[1:] in (['check-default-source'],['write-default-source']),'SEQUENCE_BUILD_OPERATION')
 inputs=load_source_inputs();files=render_defaults(inputs);raw=files['functions-entry.js']
 for name,value in files.items():
  if sys.argv[1]=='write-default-source':
   with (HERE/name).open('xb') as f:f.write(value)
  else:require((HERE/name).read_bytes()==value,'SEQUENCE_GENERATED_BYTES')
 print(encoded({'kind':'CLOSED_THREE_SOURCE_DISABLED_BUILD','entrySha256':sha(raw),'bytes':len(raw),'order':ORDER,'activation':False,'productionQualified':False}))
if __name__=='__main__':main()
