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
 'fixed-preimport-launch.py':'d6506e2d46a2abea3236e2e7978bfbba5bdfeab2c6b3f48cba260dff3d392622',
 'fixed-preflight.mjs':'7d76d2955bea22d722c63aa83def6fcec866705bb4c0153bf504ab2ccfa80779',
 'fixed-recovery-helper.mts':'3cd5f0e627b07ac35d6d6aabb006bb234a186520ed098cd81772b3fcb6b29505'}
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
  p=HERE/(name+'.in');st=p.lstat()
  require(stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid() and st.st_nlink==1 and not st.st_mode&0o022,'FIXED_TEMPLATE_FILE')
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
  try:
   original=(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)
   require(original==tuple(getattr(os.fstat(fd),k) for k in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns')),'FIXED_TEMPLATE_CHANGED')
   with os.fdopen(os.dup(fd),'rb') as f:out[name]=f.read()
   require(original==tuple(getattr(p.lstat(),k) for k in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns')),'FIXED_TEMPLATE_CHANGED')
  finally:os.close(fd)
 return out


if __name__=='__main__':
 raise RuntimeError('HENGRUI_PROFILE_LIBRARY_ONLY_NO_EMIT')
