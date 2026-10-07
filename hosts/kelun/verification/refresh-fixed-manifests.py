#!/usr/bin/env python3
"""Recompute only explicit fixed-file integrity records. Never establishes registration or launch authority."""
import hashlib,json
from pathlib import Path
UNIQUE_PUBLISHER_STATE_PATH = '/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z/PUBLISHER-ACTIVE-STATE.json'

def require_unique_publisher_state_path(source):
 expected='const statePath='+json.dumps(UNIQUE_PUBLISHER_STATE_PATH)+';'
 if source.count('PUBLISHER-ACTIVE-STATE.json') != 1 or expected not in source:
  raise ValueError('UNIQUE_PUBLISHER_STATE_PATH_REQUIRED')
 return UNIQUE_PUBLISHER_STATE_PATH

def rebase_completion_source(source, old_runtime_root, new_runtime_root):
 """Recovery recipe: rebind local host paths while preserving the externally owned global state."""
 require_unique_publisher_state_path(source)
 expected='const statePath='+json.dumps(UNIQUE_PUBLISHER_STATE_PATH)+';'
 marker='__PRESERVE_UNIQUE_OWNER_STATE_DECLARATION__'
 if marker in source:
  raise ValueError('UNIQUE_PUBLISHER_STATE_REBASE_MARKER')
 result=source.replace(expected,marker).replace(str(old_runtime_root),str(new_runtime_root)).replace(marker,expected)
 require_unique_publisher_state_path(result)
 return result

def main():
 root=Path(__file__).resolve().parents[1]
 base=json.loads((root/'verification/C51-BASE-SAFE-MANIFEST.json').read_text())
 safe=[item['path'].replace('start-monitor-kelun51-combined.js','start-monitor-kelun-next-combined.js') for item in base if item['path']!='verification/SAFE_SOURCE_ALLOWLIST.json']
 safe+=['host/runtime/prepare-owner-binding.mts','host/control-base.template.json','host/owner-binding-input.template.json','host/prepare-owner-binding.command.template.txt','verification/refresh-fixed-manifests.py','verification/C51-BASE-SAFE-MANIFEST.json']
 safe += ['host/runtime/load-host-state.unbound.template.js','supervision/start-monitor-kelun-next-combined.unbound.template.js']
 safe=sorted(set(safe))
 private=['host/host-config.json','host/control-base.json','host/activation.json','host/context-read.sql']
 for path in safe+private:
  p=root/path
  assert p.is_file() and not p.is_symlink(),path
 require_unique_publisher_state_path((root/'host/runtime/complete-reviewed-source-readback.js').read_text())
 activation=json.loads((root/'host/activation.json').read_text());control=json.loads((root/'host/control-base.json').read_text())
 assert control['build']['commitSha']=='239def3a29c9270d706425c810eb4a85d452fa1c'
 assert control['build']==activation['build']
 if activation['status']=='UNREGISTERED_NOT_ACTIVATED':
  assert activation['candidate'] is None and control['candidate'] is None
  assert activation['databaseIdentity'] is None and control['databaseIdentity'] is None
  phase='UNREGISTERED_TEMPLATE'
 else:
  assert activation['status']=='REGISTERED_VERIFIED'
  assert control['candidate']==activation['candidate'] and control['databaseIdentity']==activation['databaseIdentity']
  assert isinstance(control['candidate']['version'],int) and control['candidate']['version']>51
  phase='OWNER_INSTALLED_BINDING_INTEGRITY_ONLY'
 allow={'schemaVersion':1,'classification':'SAFE_SOURCE_AND_UNBOUND_TEMPLATES_ONLY','phase':phase,'safeFiles':safe,'privateBindingFiles':private,'exclusions':['run directories','relay/HTTP/DB payloads','actual owner registration inputs','synthetic test outputs'],'integrityIsNotRegistrationAuthority':True}
 (root/'verification/SAFE_SOURCE_ALLOWLIST.json').write_text(json.dumps(allow,indent=2)+'\n')
 safe.append('verification/SAFE_SOURCE_ALLOWLIST.json')
 def manifest(paths):
  return [{'path':path,'sha256':hashlib.sha256((root/path).read_bytes()).hexdigest(),'bytes':(root/path).stat().st_size} for path in sorted(paths)]
 for name,paths in [('SAFE_SOURCE_FILE_MANIFEST.json',safe),('PRIVATE_BINDING_FILE_MANIFEST.json',private),('HOST_FILE_MANIFEST.json',safe+private)]:
  (root/'verification'/name).write_text(json.dumps(manifest(paths),indent=2)+'\n')
 print(json.dumps({'phase':phase,'safeFiles':len(safe),'privateBindingFiles':len(private),'fixedFiles':len(safe)+len(private),'registrationAuthority':False}))

if __name__ == '__main__':
 main()
