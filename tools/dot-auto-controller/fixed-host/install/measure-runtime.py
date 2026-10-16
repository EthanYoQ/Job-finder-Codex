"""Measure an already committed local source and its actual runtime for offline tests.
Never creates a Git identity, deploys, registers or changes production paths.
"""
from pathlib import Path
import hashlib,json,os,subprocess,sys
HERE=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def run(args,cwd):return subprocess.check_output(args,cwd=cwd).decode().strip()
def require(ok,code):
 if not ok:raise RuntimeError(code)
def inventory(root):
 out=[]
 for parent,ds,fs in os.walk(root,followlinks=False):
  for n in ds:require(not (Path(parent)/n).is_symlink(),'DIRECTORY_LINK')
  for n in fs:
   p=Path(parent)/n;name=p.relative_to(root).as_posix()
   if p.is_symlink():require(p.resolve().is_relative_to(root.resolve()),'SYMLINK_ESCAPE');out.append({'path':name,'kind':'symlink','target':os.readlink(p)})
   else:
    b=p.read_bytes();out.append({'path':name,'kind':'file','bytes':len(b),'sha256':sha(b)})
 return sorted(out,key=lambda e:e['path'])
def main():
 require(len(sys.argv)==5,'USAGE_SOURCE_RUNTIME_NODE_EVIDENCE')
 source,runtime,node,evidence=map(lambda s:Path(s).resolve(),sys.argv[1:]);evidence.mkdir(exist_ok=True)
 head=run(['git','rev-parse','HEAD'],source);require(len(head)==40,'REAL_HEAD');require(run(['git','status','--porcelain'],source)=='','SOURCE_DIRTY');require(run(['git','rev-parse','HEAD'],runtime)==head,'RUNTIME_HEAD');require(run(['git','status','--porcelain'],runtime)=='','RUNTIME_DIRTY')
 entries=[]
 raw=subprocess.check_output(['git','ls-tree','-rz','--full-tree','HEAD','--','tools/dot-auto-controller/'],cwd=source)
 for line in raw.split(b'\0'):
  if not line:continue
  meta,name=line.split(b'\t');mode,kind,oid=meta.decode().split();p=source/name.decode();data=p.read_bytes();blob=b'blob '+str(len(data)).encode()+b'\0'+data
  require(kind=='blob' and hashlib.sha1(blob).hexdigest()==oid,'SOURCE_GIT_BLOB');require((runtime/name.decode()).read_bytes()==data,'RUNTIME_SOURCE_MISMATCH')
  entries.append({'path':name.decode(),'mode':mode,'bytes':len(data),'sha256':sha(data),'gitBlobSha1':oid,'gitBlobSha256':sha(blob)})
 manifest=json.loads(run([str(node),str(source/'tools/dot-auto-controller/scripts/package-manifest.mjs')],source))
 require(manifest['files']==len(entries),'ORIGINAL_MANIFEST_COUNT')
 native={e['path']:e for e in manifest['entries']}
 for entry in entries:
  require(all(native[entry['path']][k]==v for k,v in entry.items()),'ORIGINAL_MANIFEST_GIT_MISMATCH')
 def emit(name,value):
  p=evidence/name;require(not p.exists(),'EVIDENCE_ALREADY_EXISTS');p.write_text(json.dumps(value,indent=2)+'\n');return sha(p.read_bytes())
 source_pin=emit('package-source-manifest.json',manifest);package=runtime/'tools/dot-auto-controller';vendor=package/'vendor/c60-source'
 dep_pin=emit('dependencies-manifest.json',{'entries':inventory(vendor/'node_modules')});dist_pin=emit('dist-manifest.json',{'entries':inventory(vendor/'dist')})
 code='import {resolveCurrentBuildIdentity} from '+json.dumps((vendor/'src/readiness/buildIdentity.ts').as_uri())+'; console.log(JSON.stringify(resolveCurrentBuildIdentity()));'
 build=json.loads(run([str(node),'--require',str(package/'test/no-network.cjs'),'--import',str(vendor/'node_modules/tsx/dist/loader.mjs'),'--input-type=module','-e',code],vendor));require(build['commitSha']==head,'NATIVE_BUILD_HEAD')
 renderer_path=package/'fixed-host/scripts/build-lifecycle-artifacts.py';ns={'__name__':'measured_fixed_renderer','__file__':str(renderer_path)};exec(compile(renderer_path.read_bytes(),str(renderer_path),'exec'),ns)
 lifecycle=ns['render_fixed_module']((package/'fixed-host/lifecycle/lifecycle_lock.py').read_text())
 pins={'sourceRoot':str(source),'builtRoot':str(vendor),'evidenceRoot':str(evidence),'sourceManifestPath':str(evidence/'package-source-manifest.json'),'nodePath':str(node),'commitSha':head,'sourceManifestSha256':source_pin,'sourceFiles':len(entries),'nodeSha256':sha(node.read_bytes()),'dependencyManifestSha256':dep_pin,'distManifestSha256':dist_pin,'buildIdentity':build,'lockSha256':sha((vendor/'package-lock.json').read_bytes()),'lifecycleModuleSha256':sha(lifecycle),'runtimeVerifierSha256':sha((package/'transport/runtime-integrity.mjs').read_bytes()),'sourceVerifierSha256':sha((package/'connector-gate/package-preimport-pin.mjs').read_bytes()),'scope':'ACTUAL_COMMITTED_SOURCE_RUNTIME_MEASUREMENT','productionQualified':False}
 p=evidence/'INSTALL_MEASURED_PINS.json';require(not p.exists(),'INSTALL_PINS_EXISTS');p.write_text(json.dumps(pins,indent=2)+'\n')
 print(json.dumps({'commit':head,'sourceFiles':len(entries),'installPinSha256':sha(p.read_bytes()),'productionQualified':False}))
if __name__=='__main__':main()
