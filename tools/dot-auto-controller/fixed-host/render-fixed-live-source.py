#!/usr/bin/python3
"""Deterministic source export only. Does not create or activate a LIVE deployment.
Commit these templates/generator first; render external artifacts after that commit.
No runtime identity, deployment digest or future commit is written into source.
"""
from pathlib import Path
import os,stat,hashlib,json,sys
HERE=Path(__file__).resolve().parent
LIVE_ROOT='/workspace/scratch/5e9614251709/job-finder-fixed-live-controller-v1'
EXPORT_ROOT=Path('/workspace/scratch/5e9614251709/job-finder-fixed-live-source-export-v1')
TOKEN=b'__JOBFINDER_FIXED_DEPLOYMENT_ROOT__'
TEMPLATES={
 'fixed-preimport-launch.py':'14c665ae66055f4f5f50b69d9d7badd34e989fac8d864ddbe4b31ed097ee064a',
 'fixed-preflight.mjs':'f09a93e82ce95b67ecbe34838fbe7c1690fee7543412163b7cbd2eff073290cf',
 'fixed-recovery-helper.mts':'e371efd86e1a0274c9aed0a58090c81a149c48747bebe84e2ad049f7bb350238'}
def require(ok,code):
 if not ok:raise RuntimeError(code)
def sha(data):return hashlib.sha256(data).hexdigest()
def render_bytes(templates):
 require(type(templates) is dict and set(templates)==set(TEMPLATES),'FIXED_TEMPLATE_SET')
 result={}
 for name,digest in TEMPLATES.items():
  data=templates[name];require(type(data) is bytes and sha(data)==digest and data.count(TOKEN)==1,'FIXED_TEMPLATE_PIN')
  result[name]=data.replace(TOKEN,LIVE_ROOT.encode())
 return result

def load_templates():
 out={}
 for name in TEMPLATES:
  p=HERE/'templates'/(name+'.in');st=p.lstat()
  require(stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid() and st.st_nlink==1 and not st.st_mode&0o022,'FIXED_TEMPLATE_FILE')
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
  try:
   original=(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)
   require(original==tuple(getattr(os.fstat(fd),k) for k in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns')),'FIXED_TEMPLATE_CHANGED')
   with os.fdopen(os.dup(fd),'rb') as f:out[name]=f.read()
   require(original==tuple(getattr(p.lstat(),k) for k in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns')),'FIXED_TEMPLATE_CHANGED')
  finally:os.close(fd)
 return out

def main():
 require(len(sys.argv)==2 and sys.argv[1] in ('check-live-source','emit-live-source'),'FIXED_EXPORT_OPERATION')
 result=render_bytes(load_templates())
 receipt={'schemaVersion':1,'kind':'FIXED_LIVE_SOURCE_EXPORT','targetRoot':LIVE_ROOT,'exportRoot':str(EXPORT_ROOT),'files':{n:{'sha256':sha(b),'bytes':len(b)} for n,b in result.items()},'createsLiveRoot':False,'activation':False,'productionQualified':False,'requiresNewRemoteAndImmutableDeployment':True}
 if sys.argv[1]=='emit-live-source':
  # One fixed artifact output directory. No caller path or deployment input.
  require(os.getuid()>0,'FIXED_EXPORT_OWNER')
  for p in EXPORT_ROOT.parents:
   st=p.lstat();require(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode) and not st.st_mode&0o022 and st.st_uid in (0,os.getuid()),'FIXED_EXPORT_PARENT')
  EXPORT_ROOT.mkdir(mode=0o700)
  for name,data in result.items():
   fd=os.open(EXPORT_ROOT/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
   with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  with (EXPORT_ROOT/'SOURCE_EXPORT_MANIFEST.json').open('x') as f:f.write(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps(receipt,separators=(',',':')))
if __name__=='__main__':main()
